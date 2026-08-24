import type { ModelMessage, ModelRequest, ContentBlock, ToolResultContentBlock, ToolUseContentBlock } from '@harness/model';

export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

export interface ContextComposerOptions {
  maxTokens?: number;
  charsPerToken?: number;
}

export class ContextComposer {
  private maxTokens: number;
  private charsPerToken: number;

  constructor(options?: ContextComposerOptions) {
    this.maxTokens = options?.maxTokens ?? 128000;
    this.charsPerToken = options?.charsPerToken ?? 4;
  }

  public estimateTokens(text: string): number {
    // Basic heuristic: string length / charsPerToken
    // Using Array.from to correctly count unicode code points
    const length = Array.from(text).length;
    return Math.ceil(length / this.charsPerToken);
  }

  public estimateMessageTokens(message: ModelMessage): number {
    if (typeof message.content === 'string') {
      return this.estimateTokens(message.content);
    }
    
    let tokens = 0;
    for (const block of message.content) {
      if (block.type === 'text') {
        tokens += this.estimateTokens(block.text);
      } else if (block.type === 'tool_use') {
        tokens += this.estimateTokens(JSON.stringify(block.input));
      } else if (block.type === 'tool_result') {
        if (typeof block.content === 'string') {
          tokens += this.estimateTokens(block.content);
        } else {
          // nested content blocks in tool_result are rare in our current usage
          tokens += this.estimateTokens(JSON.stringify(block.content));
        }
      }
    }
    return tokens;
  }

  public compose(request: ModelRequest): ModelRequest {
    const budget = this.maxTokens;
    let remainingBudget = budget;

    // 1. Account for system prompt
    let systemText = '';
    if (typeof request.system === 'string') {
      systemText = request.system;
    } else if (Array.isArray(request.system)) {
      systemText = JSON.stringify(request.system);
    }

    if (systemText) {
      const systemTokens = this.estimateTokens(systemText);
      if (systemTokens > budget) {
        throw new ContextOverflowError(`System prompt exceeds context budget (${systemTokens} > ${budget} tokens)`);
      }
      remainingBudget -= systemTokens;
    }

    // 2. Account for tools
    let toolsTokens = 0;
    if (request.tools) {
      toolsTokens = this.estimateTokens(JSON.stringify(request.tools));
      if (toolsTokens > remainingBudget) {
        throw new ContextOverflowError(`Tool definitions exceed remaining context budget (${toolsTokens} > ${remainingBudget} tokens)`);
      }
      remainingBudget -= toolsTokens;
    }

    // 3. Process messages (from newest to oldest) to fit into remaining budget
    // But we must maintain conversational order (oldest to newest) when returning
    const composedMessages: ModelMessage[] = [];
    const reversedMessages = [...request.messages].reverse();

    let i = 0;
    while (i < reversedMessages.length) {
      const msg = reversedMessages[i];
      
      // Handle tool call and result pairs
      if (msg.role === 'user' && typeof msg.content !== 'string' && msg.content.some(b => b.type === 'tool_result')) {
        // This is a tool result message. It might be huge.
        // The preceding message in reversed list (so the one before it chronologically) should be the assistant's tool_use
        let assistantMsg: ModelMessage | undefined = undefined;
        let assistantMsgIndex = -1;
        
        if (i + 1 < reversedMessages.length && reversedMessages[i + 1].role === 'assistant') {
          assistantMsg = reversedMessages[i + 1];
          assistantMsgIndex = i + 1;
        }

        const msgTokens = this.estimateMessageTokens(msg);
        const assistantTokens = assistantMsg ? this.estimateMessageTokens(assistantMsg) : 0;
        
        if (msgTokens + assistantTokens <= remainingBudget) {
          // Fits fully
          composedMessages.unshift(msg);
          remainingBudget -= msgTokens;
          if (assistantMsg) {
            composedMessages.unshift(assistantMsg);
            remainingBudget -= assistantTokens;
            i++; // skip the assistant message since we processed it
          }
        } else if (i === 0) {
          // The VERY FIRST (most recent) message is a tool result and doesn't fit!
          // We MUST truncate it.
          const truncatedMsg = this.truncateToolResultMessage(msg, remainingBudget - assistantTokens);
          const newTokens = this.estimateMessageTokens(truncatedMsg);
          composedMessages.unshift(truncatedMsg);
          remainingBudget -= newTokens;
          
          if (assistantMsg) {
            composedMessages.unshift(assistantMsg);
            remainingBudget -= assistantTokens;
            i++;
          }
        } else {
          // Doesn't fit, and it's not the current turn. We drop it and stop accumulating history.
          break;
        }
      } else {
        // Normal message
        const msgTokens = this.estimateMessageTokens(msg);
        if (msgTokens <= remainingBudget) {
          composedMessages.unshift(msg);
          remainingBudget -= msgTokens;
        } else if (i === 0) {
          // The very first (current) user message exceeds remaining budget!
          // We truncate the user message if possible, or throw if it's not text.
          if (msg.role === 'user' && typeof msg.content === 'string') {
             // We can truncate the string
             const truncatedStr = this.truncateString(msg.content, remainingBudget);
             composedMessages.unshift({ ...msg, content: truncatedStr });
             break;
          } else {
            throw new ContextOverflowError('Current user message exceeds remaining context budget and cannot be truncated');
          }
        } else {
          // Out of budget, drop older messages
          break;
        }
      }
      i++;
    }

    return {
      ...request,
      messages: composedMessages
    };
  }

  private truncateToolResultMessage(msg: ModelMessage, availableTokens: number): ModelMessage {
    if (typeof msg.content === 'string') {
      return msg; // Shouldn't happen based on how we format tool results, but just in case
    }
    
    // We want to distribute availableTokens among the tool_result blocks
    const content = [...msg.content];
    
    for (let j = 0; j < content.length; j++) {
      const block = content[j];
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        const blockTokens = this.estimateTokens(block.content);
        // Approximate how many tokens we can give this block
        // In a real scenario we'd do a more complex distribution, but for now we just truncate if it's large
        // Give it whatever is available, minus some overhead
        const allowedTokens = Math.max(0, availableTokens - 100);
        
        if (blockTokens > allowedTokens) {
           const targetChars = allowedTokens * this.charsPerToken;
           // Truncate from the middle
           if (targetChars > 100) {
              const prefixLen = Math.floor(targetChars / 2) - 20;
              const suffixLen = Math.floor(targetChars / 2) - 20;
              
              const prefix = Array.from(block.content).slice(0, prefixLen).join('');
              const suffix = Array.from(block.content).slice(-suffixLen).join('');
              
              const truncatedContent = `${prefix}\\n...[TRUNCATED BY CONTEXT LIMIT]...\\n${suffix}`;
              
              content[j] = {
                 ...block,
                 content: truncatedContent
              };
           }
        }
      }
    }
    
    return {
      ...msg,
      content
    };
  }

  private truncateString(text: string, maxTokens: number): string {
    const targetChars = maxTokens * this.charsPerToken;
    if (targetChars < 10) return text;
    return Array.from(text).slice(0, targetChars - 10).join('') + '...';
  }
}
