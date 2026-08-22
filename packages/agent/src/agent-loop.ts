import type { Model, ModelRequest, ModelResponse, ToolResultContentBlock, ToolUseContentBlock } from '@harness/model';
import type { ToolRegistry } from '@harness/tools';
import { AgentExecutionError, MaxStepsExceededError } from './errors.js';
import type { Session } from './session.js';

export interface AgentLoopOptions {
  model: Model;
  toolRegistry?: ToolRegistry;
  maxSteps?: number;
}

export interface AgentRunOptions {
  maxSteps?: number;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  sessionId: string;
  steps: number;
  completed: boolean;
  finalResponse?: ModelResponse;
}

export interface AgentStepOptions {
  signal?: AbortSignal;
}

export interface AgentStepResult {
  sessionId: string;
  response: ModelResponse;
  hasToolCalls: boolean;
  toolCallsExecuted: number;
}

interface ParsedToolCall {
  id: string;
  name: string;
  input: unknown;
}

export class AgentLoop {
  public readonly model: Model;
  public readonly toolRegistry?: ToolRegistry;
  public readonly maxSteps: number;

  constructor(options: AgentLoopOptions) {
    this.model = options.model;
    this.toolRegistry = options.toolRegistry;
    this.maxSteps = options.maxSteps ?? 10;
  }

  public async run(session: Session, options?: AgentRunOptions): Promise<AgentRunResult> {
    const limit = options?.maxSteps ?? this.maxSteps;
    let steps = 0;

    while (steps < limit) {
      if (options?.signal?.aborted) {
        throw new AgentExecutionError('Agent run was aborted.', { sessionId: session.id });
      }

      steps++;
      const stepResult = await this.step(session, options);

      if (!stepResult.hasToolCalls) {
        return {
          sessionId: session.id,
          steps,
          completed: true,
          finalResponse: stepResult.response,
        };
      }
    }

    throw new MaxStepsExceededError(limit, { sessionId: session.id });
  }

  public async step(session: Session, options?: AgentStepOptions): Promise<AgentStepResult> {
    if (options?.signal?.aborted) {
      throw new AgentExecutionError('Agent step was aborted.', { sessionId: session.id });
    }

    const messages = session.getMessages();
    const eventStore = session.getEventStore();

    if (eventStore) {
      await eventStore.append({
        sessionId: session.id,
        type: 'agent_turn_started',
        payload: {
          sessionId: session.id,
          messagesCount: messages.length,
        },
      });
    }

    const toolsList = this.toolRegistry?.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    const request: ModelRequest = {
      model: session.model,
      system: session.systemPrompt,
      messages,
      tools: toolsList && toolsList.length > 0 ? toolsList : undefined,
    };

    let response: ModelResponse;
    try {
      response = await this.model.complete(request);
    } catch (err) {
      throw new AgentExecutionError(
        `Model execution failed: ${err instanceof Error ? err.message : String(err)}`,
        { sessionId: session.id, cause: err }
      );
    }

    // Add assistant response to session
    session.addMessage({
      role: 'assistant',
      content: response.content.length > 0 ? response.content : response.text,
    });

    if (eventStore) {
      await eventStore.append({
        sessionId: session.id,
        type: 'agent_turn_completed',
        payload: {
          sessionId: session.id,
          text: response.text,
          stopReason: response.stopReason,
        },
      });
    }

    const toolCalls = this.extractToolCalls(response);

    if (toolCalls.length === 0) {
      return {
        sessionId: session.id,
        response,
        hasToolCalls: false,
        toolCallsExecuted: 0,
      };
    }

    const toolResultBlocks: ToolResultContentBlock[] = [];

    for (const call of toolCalls) {
      if (options?.signal?.aborted) {
        throw new AgentExecutionError('Agent step aborted during tool execution.', {
          sessionId: session.id,
        });
      }

      if (eventStore) {
        await eventStore.append({
          sessionId: session.id,
          type: 'tool_call_requested',
          payload: {
            sessionId: session.id,
            toolName: call.name,
            input: call.input,
            toolCallId: call.id,
          },
        });
      }

      let result: unknown;
      let toolError: string | undefined;

      if (this.toolRegistry && this.toolRegistry.has(call.name)) {
        try {
          result = await this.toolRegistry.execute(call.name, call.input, {
            sessionId: session.id,
            signal: options?.signal,
          });
        } catch (err) {
          toolError = err instanceof Error ? err.message : String(err);
        }
      } else {
        toolError = `Tool "${call.name}" not found in registry.`;
      }

      if (eventStore) {
        await eventStore.append({
          sessionId: session.id,
          type: 'tool_call_completed',
          payload: {
            sessionId: session.id,
            toolName: call.name,
            result,
            error: toolError,
            toolCallId: call.id,
          },
        });
      }

      const formattedContent = toolError
        ? `Error: ${toolError}`
        : typeof result === 'string'
          ? result
          : JSON.stringify(result);

      toolResultBlocks.push({
        type: 'tool_result',
        toolUseId: call.id,
        content: formattedContent,
        isError: !!toolError,
      });
    }

    session.addMessage({
      role: 'user',
      content: toolResultBlocks,
    });

    return {
      sessionId: session.id,
      response,
      hasToolCalls: true,
      toolCallsExecuted: toolCalls.length,
    };
  }

  private extractToolCalls(response: ModelResponse): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseContentBlock;
        calls.push({
          id: toolBlock.id,
          name: toolBlock.name,
          input: toolBlock.input,
        });
      }
    }

    if (calls.length === 0 && response.text.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(response.text.trim());
        const toolName = parsed.tool || parsed.name || parsed.tool_name;
        if (toolName && typeof toolName === 'string' && this.toolRegistry?.has(toolName)) {
          calls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: toolName,
            input: parsed.input ?? parsed.arguments ?? parsed.args ?? {},
          });
        }
      } catch {
        // Not valid JSON tool call
      }
    }

    return calls;
  }
}
