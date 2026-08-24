import type { Model, ModelRequest, ModelResponse, ToolResultContentBlock, ToolUseContentBlock } from '@harness/model';
import type { ToolRegistry } from '@harness/tools';
import { AgentExecutionError, MaxStepsExceededError } from './errors.js';
import type { Session } from './session.js';
import { ContextComposer, type ContextComposerOptions } from './context.js';

export interface AgentLoopOptions {
  model: Model;
  toolRegistry?: ToolRegistry;
  maxSteps?: number;
  contextOptions?: ContextComposerOptions;
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
  private readonly contextComposer: ContextComposer;

  constructor(options: AgentLoopOptions) {
    this.model = options.model;
    this.toolRegistry = options.toolRegistry;
    this.maxSteps = options.maxSteps ?? 10;
    this.contextComposer = new ContextComposer(options.contextOptions);
  }

  public async run(session: Session, options?: AgentRunOptions): Promise<AgentRunResult> {
    const limit = options?.maxSteps ?? this.maxSteps;
    let steps = 0;

    session.acquireLock();
    try {
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
    } finally {
      session.releaseLock();
    }
  }

  public async step(session: Session, options?: AgentStepOptions): Promise<AgentStepResult> {
    if (options?.signal?.aborted) {
      throw new AgentExecutionError('Agent step was aborted.', { sessionId: session.id });
    }

    const messages = session.getMessages();

    session.startTurn();

    const toolsList = this.toolRegistry?.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    const rawRequest: ModelRequest = {
      model: session.model,
      system: session.systemPrompt,
      messages,
      tools: toolsList && toolsList.length > 0 ? toolsList : undefined,
      signal: options?.signal,
    };

    const request = this.contextComposer.compose(rawRequest);

    let responseText = '';
    const responseContent: any[] = [];
    let responseId = '';
    let responseModel = '';
    let responseRole: any = 'assistant';
    let stopReason: any = 'unknown';
    let usage: any = { inputTokens: 0, outputTokens: 0 };
    
    session.startGeneration({ model: session.model });

    try {
      for await (const event of this.model.completeStream(request)) {
        if (options?.signal?.aborted) {
          throw new AgentExecutionError('Agent step was aborted.', { sessionId: session.id });
        }
        
        switch (event.type) {
          case 'message_start':
            responseId = event.id;
            responseModel = event.model;
            responseRole = event.role;
            break;
          case 'text_delta':
            responseText += event.text;
            session.logGenerationChunk(event.text);
            break;
          case 'message_delta':
            if (event.stopReason) stopReason = event.stopReason;
            if (event.usage) usage = event.usage;
            break;
          case 'error':
            throw new Error(`Stream error: ${String(event.error)}`);
        }
      }
    } catch (err) {
      if (options?.signal?.aborted && err instanceof Error && err.message === 'AbortError') {
        session.abortGeneration();
        throw new AgentExecutionError('Agent step was aborted.', { sessionId: session.id, cause: err });
      }

      session.failGeneration({ error: err instanceof Error ? err.message : String(err) });

      if (err instanceof AgentExecutionError) {
        throw err;
      }
      throw new AgentExecutionError(
        `Model execution failed: ${err instanceof Error ? err.message : String(err)}`,
        { sessionId: session.id, cause: err }
      );
    }

    const response: ModelResponse = {
      id: responseId || `gen_${Date.now()}`,
      model: responseModel || session.model || 'unknown',
      role: responseRole,
      content: responseContent.length > 0 ? responseContent : [{ type: 'text', text: responseText }],
      text: responseText,
      stopReason,
      usage,
    };

    // Add assistant response to session
    session.addMessage({
      role: 'assistant',
      content: response.content.length > 0 ? response.content : response.text,
    });

    session.completeGeneration({
      response: response.text,
      stopReason: response.stopReason,
    });
    
    session.completeTurn({
      text: response.text,
      stopReason: response.stopReason,
    });

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

      session.startToolCall({
        toolCallId: call.id,
        toolName: call.name,
        input: call.input,
      });

      let result: unknown;
      let toolError: string | undefined;
      let formattedContent: string = '';

      if (this.toolRegistry && this.toolRegistry.has(call.name)) {
        try {
          result = await this.toolRegistry.execute(call.name, call.input, {
            sessionId: session.id,
            signal: options?.signal,
          });
          
          // Must serialize inside try/catch so malformed results become tool errors
          formattedContent = typeof result === 'string' ? result : JSON.stringify(result);
        } catch (err) {
          toolError = err instanceof Error ? err.message : String(err);
          // Distinguish abort cascade vs normal tool error
          if (options?.signal?.aborted && err instanceof Error && (err.name === 'AbortError' || err.message.includes('Abort'))) {
            // Re-throw so the agent loop cancels instead of feeding the error back to the model
            throw new AgentExecutionError('Agent step aborted during tool execution.', {
              sessionId: session.id,
              cause: err,
            });
          }
        }
      } else {
        toolError = `Tool "${call.name}" not found in registry.`;
      }

      if (toolError) {
        formattedContent = `Error: ${toolError}`;
        session.failToolCall({
          toolCallId: call.id,
          toolName: call.name,
          error: toolError,
        });
      } else {
        session.completeToolCall({
          toolCallId: call.id,
          toolName: call.name,
          result: result,
        });
      }

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
        if (!toolName || typeof toolName !== 'string') {
          // Missing tool name
          calls.push({
            id: `call_${Date.now()}_invalid`,
            name: '', // Invalid tool name
            input: parsed,
          });
        } else {
          calls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: toolName,
            input: parsed.input ?? parsed.arguments ?? parsed.args ?? {},
          });
        }
      } catch (err) {
        // Not valid JSON tool call, but it was formatted as an object block.
        // We want this to fail as a structured tool error rather than silently becoming a text response.
        calls.push({
          id: `call_${Date.now()}_malformed`,
          name: 'malformed_tool',
          input: { error: 'Invalid JSON' },
        });
      }
    }

    return calls;
  }
}
