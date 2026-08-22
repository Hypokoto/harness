import type { EventBus } from '@harness/events';
import { DefaultDenyPolicy } from './default-policy.js';
import {
  DuplicateToolError,
  InvalidInputError,
  ToolExecutionError,
  UnknownToolError,
} from './errors.js';
import { PermissionDeniedError } from './permission-errors.js';
import {
  parseCapability,
  type Capability,
  type PermissionDecision,
  type PermissionPolicy,
} from './permission-types.js';
import type { Tool, ToolContext, ToolMetadata } from './types.js';

export interface ToolRegistryOptions {
  /**
   * The permission policy used to authorize tool execution.
   *
   * If not provided, a DefaultDenyPolicy is used:
   * - Tools with zero requiredCapabilities: ALLOWED
   * - Tools with any requiredCapabilities: DENIED
   *
   * Supply a StaticCapabilityPolicy (or other PermissionPolicy) to grant
   * capabilities explicitly.
   */
  policy?: PermissionPolicy;

  /**
   * Optional EventBus for emitting permission.allowed / permission.denied events.
   * If not provided, no permission events are emitted.
   */
  eventBus?: EventBus;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<any, any>>();
  private policy: PermissionPolicy;
  private readonly eventBus?: EventBus;

  constructor(options: ToolRegistryOptions = {}) {
    this.policy = options.policy ?? new DefaultDenyPolicy();
    this.eventBus = options.eventBus;
  }

  /**
   * Replace the active permission policy.
   * Does not affect tools already registered or currently executing.
   */
  public setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  public register(tool: Tool<any, any>): void {
    if (!tool || typeof tool.name !== 'string' || !tool.name.trim()) {
      throw new InvalidInputError('Tool must have a valid non-empty name.');
    }
    if (typeof tool.execute !== 'function') {
      throw new InvalidInputError(`Tool "${tool.name}" must provide an execute method.`);
    }
    if (this.tools.has(tool.name)) {
      throw new DuplicateToolError(tool.name);
    }
    this.tools.set(tool.name, tool);
  }

  public get(name: string): Tool<any, any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new UnknownToolError(name);
    }
    return tool;
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  public list(): ToolMetadata[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      requiredCapabilities: tool.requiredCapabilities,
    }));
  }

  public async execute(
    name: string,
    input: unknown,
    context: ToolContext = {}
  ): Promise<unknown> {
    const tool = this.get(name);

    // ── PERMISSION ENFORCEMENT ────────────────────────────────────────────────
    // This is the mandatory gate. Every execution path through ToolRegistry
    // must pass this check. The tool is NEVER called if the check fails.
    const requiredRaw = tool.requiredCapabilities ?? [];
    const required: Capability[] = requiredRaw.map(parseCapability);
    const granted = this.getGrantedSet();

    const decision: PermissionDecision = this.policy.check({
      toolName: name,
      requiredCapabilities: required,
      grantedCapabilities: granted,
    });

    if (!decision.allowed) {
      const missing = decision.missingCapabilities ?? required;

      // Emit permission.denied event (safe payload — no secrets, no raw inputs)
      await this.emitPermissionEvent('permission.denied', {
        toolName: name,
        allowed: false,
        requiredCapabilities: required,
        missingCapabilities: missing,
      });

      // Hard deny — tool.execute() is NOT called.
      throw new PermissionDeniedError(name, missing);
    }

    // Emit permission.allowed event before executing
    await this.emitPermissionEvent('permission.allowed', {
      toolName: name,
      allowed: true,
      requiredCapabilities: required,
      missingCapabilities: [],
    });
    // ── END PERMISSION ENFORCEMENT ────────────────────────────────────────────

    let validatedInput = input;
    if (typeof tool.validateInput === 'function') {
      try {
        validatedInput = tool.validateInput(input);
      } catch (error) {
        if (error instanceof InvalidInputError) {
          throw error;
        }
        throw new InvalidInputError(
          `Input validation failed for tool "${name}": ${error instanceof Error ? error.message : String(error)}`,
          { toolName: name, cause: error }
        );
      }
    }

    try {
      // Step 29: Tool Output Limits
      // Add bounded output handling and timeout for potentially blocking tools
      const MAX_OUTPUT_SIZE = 100 * 1024; // 100KB is reasonable for LLM context
      
      const executePromise = tool.execute(validatedInput, context);
      
      // Step 10: Timeout Audit
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Tool execution timeout (30s)')), 30000);
      });
      
      let rawResult = await Promise.race([executePromise, timeoutPromise]);
      
      // Verify size
      const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      if (resultStr && resultStr.length > MAX_OUTPUT_SIZE) {
        // Truncate to prevent context destruction
        if (typeof rawResult === 'string') {
          return rawResult.substring(0, MAX_OUTPUT_SIZE) + '... [TRUNCATED]';
        }
        return `[TRUNCATED: Output size exceeded ${MAX_OUTPUT_SIZE} bytes]`;
      }
      return rawResult;
      
    } catch (error) {
      if (error instanceof InvalidInputError) {
        throw error;
      }
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(
        `Execution failed for tool "${name}": ${error instanceof Error ? error.message : String(error)}`,
        { toolName: name, cause: error }
      );
    }
  }

  /**
   * Retrieve the granted capability set from the active policy.
   * Falls back to an empty set if the policy does not expose grants.
   */
  private getGrantedSet(): ReadonlySet<Capability> {
    const p = this.policy as PermissionPolicy & {
      getGranted?: () => ReadonlySet<Capability>;
    };
    if (typeof p.getGranted === 'function') {
      return p.getGranted();
    }
    return new Set<Capability>();
  }

  /**
   * Emit a permission event to the EventBus if one is configured.
   * Payload is conservative — no raw tool inputs, no secrets.
   */
  private async emitPermissionEvent(
    type: 'permission.allowed' | 'permission.denied',
    payload: {
      toolName: string;
      allowed: boolean;
      requiredCapabilities: readonly Capability[];
      missingCapabilities: readonly Capability[];
    }
  ): Promise<void> {
    if (!this.eventBus) return;

    try {
      await this.eventBus.emit({
        id: crypto.randomUUID(),
        sessionId: 'permission',
        type,
        sequence: 0,
        timestamp: new Date().toISOString(),
        payload,
      });
    } catch {
      // Event emission failure must never block tool execution or permission denial.
    }
  }
}
