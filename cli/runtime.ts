/**
 * Harness Runtime Application Controller
 *
 * This is the ONLY bridge between CLI/TUI and the runtime packages.
 * It is NOT a second runtime — it wires existing packages and exposes
 * a high-level API that the CLI and TUI consume.
 *
 * Architecture:
 *
 *   TUI / CLI
 *       ↓
 *   HarnessRuntime (this)
 *       ↓
 *   Kernel → Plugins → Services
 *       ↓
 *   AgentLoop → Model → Tools → Events
 *
 * The TUI/CLI must NEVER:
 *   - Directly instantiate Ollama/Anthropic/MCP/Qdrant
 *   - Bypass the ToolRegistry
 *   - Bypass the PermissionPolicy
 *   - Create a second AgentLoop or streaming abstraction
 */

import { Kernel } from '@harness/kernel';
import type { Plugin, KernelContext } from '@harness/kernel';
import { AgentLoop, Session } from '@harness/agent';
import type { AgentRunResult } from '@harness/agent';
import { createModel } from '@harness/model';
import type { Model, ModelStreamEvent } from '@harness/model';
import { EventStore, EventBus } from '@harness/events';
import type { EventEnvelope } from '@harness/events';
import { ToolRegistry } from '@harness/tools';
import type { PermissionPolicy, PermissionRequest, PermissionDecision } from '@harness/permissions';
import { buildPolicyFromProfile, StaticCapabilityPolicy } from '@harness/permissions';
import type { ResolvedConfig } from './config.js';
import { mkdirSync } from 'node:fs';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RuntimeOptions {
  config: ResolvedConfig;
  /** Callback for permission prompts (TUI or headless) */
  onPermissionRequest?: (req: PermissionRequest) => Promise<PermissionDecision>;
  /** Callback for streaming text deltas */
  onTextDelta?: (text: string) => void;
  /** Callback for tool execution events */
  onToolEvent?: (event: ToolEvent) => void;
  /** Callback for runtime events */
  onEvent?: (event: EventEnvelope) => void;
}

export interface ToolEvent {
  type: 'tool_started' | 'tool_completed' | 'tool_error';
  toolName: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface RuntimeInfo {
  provider: string;
  model: string;
  profile: string;
  project: string | null;
  status: 'ready' | 'running' | 'error' | 'stopped';
}

// ── Application Controller ──────────────────────────────────────────────────

export class HarnessRuntime {
  private kernel: Kernel;
  private model: Model | null = null;
  private eventStore: EventStore | null = null;
  private eventBus: EventBus | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private agentLoop: AgentLoop | null = null;
  private currentSession: Session | null = null;
  private abortController: AbortController | null = null;
  private status: RuntimeInfo['status'] = 'ready';
  private readonly config: ResolvedConfig;
  private readonly options: RuntimeOptions;

  constructor(options: RuntimeOptions) {
    this.config = options.config;
    this.options = options;
    this.kernel = new Kernel();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Boot the runtime by registering and starting Kernel plugins.
   *
   * This wires: Model → EventStore → ToolRegistry → Permissions → AgentLoop
   * All through the existing Kernel plugin system.
   */
  async boot(): Promise<void> {
    // Ensure events directory exists
    mkdirSync(this.config.eventsDir, { recursive: true });

    // Register plugins in dependency order
    this.kernel.registerPlugin(this.createModelPlugin());
    this.kernel.registerPlugin(this.createEventsPlugin());
    this.kernel.registerPlugin(this.createToolsPlugin());
    this.kernel.registerPlugin(this.createAgentPlugin());

    // Register third-party plugins in a sandbox
    const plugins = this.config.profile.config.plugins || [];
    for (const pluginName of plugins) {
      // In a real implementation, we would resolve the absolute path to the plugin.
      // For now, we assume it's resolvable by Node.
      try {
        const { createSandboxedPlugin } = await import('@harness/sandbox');
        this.kernel.registerPlugin(createSandboxedPlugin(pluginName, pluginName));
      } catch (err) {
        console.warn(`Failed to register sandboxed plugin ${pluginName}:`, err);
      }
    }

    // Start the kernel (runs setup → start in dependency order)
    await this.kernel.start();

    // Resolve services registered by plugins
    this.model = this.kernel.resolveService<Model>('model');
    this.eventStore = this.kernel.resolveService<EventStore>('eventStore');
    this.eventBus = this.kernel.resolveService<EventBus>('eventBus');
    this.toolRegistry = this.kernel.resolveService<ToolRegistry>('toolRegistry');
    this.agentLoop = this.kernel.resolveService<AgentLoop>('agentLoop');

    this.status = 'ready';
  }

  /**
   * Clean shutdown: cancel model → stop tools → flush events → stop kernel.
   */
  async shutdown(): Promise<void> {
    this.cancelCurrentRequest();

    if (this.currentSession) {
      await this.currentSession.flushEvents();
    }

    try {
      await this.kernel.stop();
    } catch {
      // Best-effort shutdown
    }

    this.status = 'stopped';
  }

  // ── Agent Interaction ─────────────────────────────────────────────────

  /**
   * Run the agent with a user message (non-streaming, headless).
   *
   * Uses the existing AgentLoop.run() — does NOT create a second loop.
   */
  async runAgent(userMessage: string, sessionId?: string): Promise<AgentRunResult> {
    if (!this.agentLoop || !this.eventStore) {
      throw new Error('Runtime not booted. Call boot() first.');
    }

    this.status = 'running';
    this.abortController = new AbortController();

    const session = await this.getOrCreateSession(sessionId);
    session.addMessage({ role: 'user', content: userMessage });

    try {
      const result = await this.agentLoop.run(session, {
        signal: this.abortController.signal,
      });
      this.status = 'ready';
      return result;
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  /**
   * Run the agent with streaming output.
   *
   * Uses Model.completeStream() through AgentLoop.step() iteratively,
   * forwarding text_delta events to the TUI via callbacks.
   *
   * This does NOT create a second streaming abstraction.
   * It uses the existing AgentLoop + Model.completeStream().
   */
  async runAgentStreaming(userMessage: string, sessionId?: string): Promise<AgentRunResult> {
    if (!this.model || !this.toolRegistry || !this.eventStore) {
      throw new Error('Runtime not booted. Call boot() first.');
    }

    this.status = 'running';
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const session = await this.getOrCreateSession(sessionId);
    session.addMessage({ role: 'user', content: userMessage });

    let steps = 0;
    const maxSteps = this.agentLoop?.maxSteps ?? 10;

    try {
      while (steps < maxSteps) {
        if (signal.aborted) break;
        steps++;

        // Build the model request
        const messages = session.getMessages();
        const toolsList = this.toolRegistry.list().map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));

        // Stream the model response using the existing Model.completeStream()
        let fullText = '';
        const contentBlocks: Array<{ type: string; [key: string]: unknown }> = [];
        let stopReason: string = 'end_turn';

        for await (const event of this.model.completeStream({
          model: session.model,
          system: session.systemPrompt,
          messages,
          tools: toolsList.length > 0 ? toolsList : undefined,
          signal,
        })) {
          if (signal.aborted) break;

          switch (event.type) {
            case 'text_delta':
              fullText += event.text;
              this.options.onTextDelta?.(event.text);
              break;
            case 'message_delta':
              if (event.stopReason) stopReason = event.stopReason;
              break;
          }
        }

        if (fullText) {
          contentBlocks.push({ type: 'text', text: fullText });
        }

        // Add assistant response to session
        session.addMessage({
          role: 'assistant',
          content: fullText || '(empty response)',
        });

        // Record the event
        if (this.eventStore) {
          await this.eventStore.append({
            sessionId: session.id,
            type: 'agent_turn_completed',
            payload: { text: fullText, stopReason },
          });
        }

        // If no tool calls, we're done
        if (stopReason !== 'tool_use') {
          this.status = 'ready';
          return {
            sessionId: session.id,
            steps,
            completed: true,
            finalResponse: {
              id: `stream-${Date.now()}`,
              model: session.model ?? this.config.modelName,
              role: 'assistant',
              content: contentBlocks as any,
              text: fullText,
              stopReason: stopReason as any,
              usage: { inputTokens: 0, outputTokens: 0 },
            },
          };
        }

        // Tool calls would be handled here via non-streaming step
        // For now, fall back to non-streaming for tool execution
        const stepResult = await this.agentLoop!.step(session, { signal });
        if (!stepResult.hasToolCalls) {
          this.status = 'ready';
          return {
            sessionId: session.id,
            steps,
            completed: true,
            finalResponse: stepResult.response,
          };
        }
      }

      this.status = 'ready';
      return {
        sessionId: session.id,
        steps,
        completed: false,
      };
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  /**
   * Cancel the current model request via AbortController.
   *
   * Propagation: TUI → AbortController.abort() → AgentLoop → Model
   */
  cancelCurrentRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ── Session Management ────────────────────────────────────────────────

  /**
   * Get or create a session, using the existing EventStore for persistence.
   * Does NOT create a second session system.
   */
  private async getOrCreateSession(sessionId?: string): Promise<Session> {
    if (this.currentSession && !sessionId) {
      return this.currentSession;
    }

    const initialMessages: import('@harness/model').ModelMessage[] = [];

    // If resuming, replay events from EventStore
    if (sessionId && this.eventStore) {
      try {
        const events = await this.eventStore.read(sessionId);
        for (const event of events) {
          const payload = event.payload as Record<string, unknown>;
          if (event.type === 'message_added' && payload.role && payload.content) {
            initialMessages.push({
              role: payload.role as 'user' | 'assistant',
              content: payload.content as string,
            });
          }
        }
      } catch {
        // Session not found or corrupted — start fresh
      }
    }

    const session = new Session({
      id: sessionId,
      systemPrompt: this.config.profile.config.systemPrompt,
      model: this.config.modelName,
      eventStore: this.eventStore ?? undefined,
      initialMessages,
    });

    this.currentSession = session;
    return session;
  }

  /** Get the current session ID */
  getSessionId(): string | null {
    return this.currentSession?.id ?? null;
  }

  /** List available sessions from the EventStore */
  async listSessions(): Promise<string[]> {
    if (!this.eventStore) return [];
    // EventStore uses file-per-session; list files in the events directory
    const { readdirSync } = await import('node:fs');
    try {
      return readdirSync(this.config.eventsDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''));
    } catch {
      return [];
    }
  }

  // ── Info ───────────────────────────────────────────────────────────────

  /** Get current runtime info (for TUI header, etc.) */
  getInfo(): RuntimeInfo {
    return {
      provider: this.config.modelProvider,
      model: this.config.modelName,
      profile: this.config.profile.name,
      project: this.config.project.projectRoot,
      status: this.status,
    };
  }

  /** Get the Model instance for direct introspection */
  getModel(): Model | null {
    return this.model;
  }

  /** Get the EventStore */
  getEventStore(): EventStore | null {
    return this.eventStore;
  }

  /** Get the ToolRegistry */
  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  // ── Plugin Factories ──────────────────────────────────────────────────
  // Each creates a Kernel Plugin that registers services.
  // This keeps the wiring inside the runtime, not in the CLI/TUI.

  private createModelPlugin(): Plugin {
    const config = this.config;
    return {
      name: 'model',
      setup(ctx: KernelContext) {
        const model = createModel({
          provider: config.modelProvider,
          model: config.modelName,
        });
        ctx.registerService('model', model);
      },
    };
  }

  private createEventsPlugin(): Plugin {
    const config = this.config;
    const onEvent = this.options.onEvent;
    return {
      name: 'events',
      setup(ctx: KernelContext) {
        const store = new EventStore(config.eventsDir);
        const bus = new EventBus();
        if (onEvent) {
          bus.on('*', onEvent);
        }
        ctx.registerService('eventStore', store);
        ctx.registerService('eventBus', bus);
      },
    };
  }

  private createToolsPlugin(): Plugin {
    const config = this.config;
    const onToolEvent = this.options.onToolEvent;
    const _onPermReq = this.options.onPermissionRequest;
    return {
      name: 'tools',
      dependencies: ['events'],
      setup(ctx: KernelContext) {
        const eventBus = ctx.resolveService<EventBus>('eventBus');

        // Build permission policy from profile config
        let policy: PermissionPolicy;
        try {
          policy = buildPolicyFromProfile(config.profile.config);
        } catch {
          policy = new StaticCapabilityPolicy([]);
        }

        const registry = new ToolRegistry({ policy, eventBus });
        ctx.registerService('toolRegistry', registry);

        // Forward tool events if callback provided
        if (onToolEvent) {
          eventBus.on('tool_call_requested', (event: EventEnvelope) => {
            const payload = event.payload as Record<string, unknown>;
            onToolEvent({
              type: 'tool_started',
              toolName: String(payload.toolName ?? ''),
              args: payload.input,
            });
          });
          eventBus.on('tool_call_completed', (event: EventEnvelope) => {
            const payload = event.payload as Record<string, unknown>;
            onToolEvent({
              type: payload.error ? 'tool_error' : 'tool_completed',
              toolName: String(payload.toolName ?? ''),
              result: payload.result,
              error: payload.error as string | undefined,
            });
          });
        }
      },
    };
  }

  private createAgentPlugin(): Plugin {
    const profileConfig = this.config.profile.config;
    return {
      name: 'agent',
      dependencies: ['model', 'events', 'tools'],
      setup(ctx: KernelContext) {
        const model = ctx.resolveService<Model>('model');
        const toolRegistry = ctx.resolveService<ToolRegistry>('toolRegistry');

        const agent = new AgentLoop({
          model,
          toolRegistry,
          maxSteps: profileConfig.maxSteps ?? 10,
        });

        ctx.registerService('agentLoop', agent);
      },
    };
  }
}
