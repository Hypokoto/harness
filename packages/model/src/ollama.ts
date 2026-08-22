import {
  Model,
  ModelOptions,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StopReason,
} from './types.js';
import { ModelError, ProviderError, NetworkError } from './errors.js';

export class OllamaModel implements Model {
  public provider = 'ollama';
  public defaultModel: string;
  private endpoint: string;

  constructor(config: ModelOptions) {
    this.defaultModel = config.model || 'qwen2.5:0.5b';
    this.endpoint = config.baseUrl || 'http://127.0.0.1:11434';
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const model = request.model || this.defaultModel;
    
    const messages = request.messages.map((msg) => {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((b) => (b.type === 'text' ? b.text : JSON.stringify(b)))
          .join('\n');
      }
      return { role: msg.role, content };
    });

    const body: any = {
      model,
      messages,
      stream: false,
    };

    if (request.system) {
      body.messages.unshift({ 
        role: 'system', 
        content: typeof request.system === 'string' 
          ? request.system 
          : request.system.map(b => (b as any).text).join('\n') 
      });
    }
    
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        }
      }));
    }

    try {
      const controller = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;
      
      if (request.timeoutMs) {
        timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);
      }
      if (request.signal) {
        request.signal.addEventListener('abort', () => controller.abort());
      }

      const res = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!res.ok) {
        throw new ProviderError(`Ollama API error: ${res.statusText}`, { provider: 'ollama', statusCode: res.status });
      }

      const data = await res.json() as any;

      let stopReason: StopReason = 'end_turn';
      if (data.done_reason === 'stop') stopReason = 'end_turn';
      else if (data.done_reason === 'length') stopReason = 'max_tokens';
      
      const response: ModelResponse = {
        id: 'ollama-' + Math.random().toString(36).substr(2, 9),
        model,
        role: 'assistant',
        content: [],
        text: '',
        stopReason,
        usage: {
          inputTokens: data.prompt_eval_count || 0,
          outputTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        rawResponse: data,
      };

      if (data.message) {
        if (data.message.tool_calls && data.message.tool_calls.length > 0) {
          response.stopReason = 'tool_use';
          for (const tc of data.message.tool_calls) {
            response.content.push({
              type: 'tool_use',
              id: tc.function.name + '_' + Math.random().toString(36).substr(2, 9),
              name: tc.function.name,
              input: tc.function.arguments,
            });
          }
        }
        
        if (data.message.content) {
          response.content.push({ type: 'text', text: data.message.content });
          response.text = data.message.content;
        }
      }

      return response;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new NetworkError('Request timeout or cancelled', { provider: 'ollama' });
      }
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new ProviderError('Ollama is unavailable at ' + this.endpoint, { provider: 'ollama' });
      }
      throw new ProviderError(`Ollama request failed: ${err.message}`, { provider: 'ollama' });
    }
  }

  async *completeStream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const model = request.model || this.defaultModel;

    const messages = request.messages.map((msg) => {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((b) => (b.type === 'text' ? b.text : JSON.stringify(b)))
          .join('\n');
      }
      return { role: msg.role, content };
    });

    const body: any = {
      model,
      messages,
      stream: true,
    };

    if (request.system) {
      body.messages.unshift({
        role: 'system',
        content: typeof request.system === 'string'
          ? request.system
          : request.system.map((b) => (b as any).text).join('\n'),
      });
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        },
      }));
    }

    try {
      const controller = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;

      if (request.timeoutMs) {
        timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);
      }
      if (request.signal) {
        request.signal.addEventListener('abort', () => controller.abort());
      }

      const res = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!res.ok) {
        throw new ProviderError(`Ollama API error: ${res.statusText}`, { provider: 'ollama', statusCode: res.status });
      }

      if (!res.body) {
        throw new ProviderError('Ollama returned no response body for streaming', { provider: 'ollama' });
      }

      yield { type: 'message_start', id: 'ollama-stream-' + Date.now(), model, role: 'assistant' } as ModelStreamEvent;

      const decoder = new TextDecoder();
      let buffer = '';

      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let data: any;
          try {
            data = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (data.message?.content) {
            yield { type: 'text_delta', text: data.message.content } as ModelStreamEvent;
          }

          if (data.done) {
            yield {
              type: 'message_delta',
              stopReason: 'end_turn' as const,
              usage: {
                inputTokens: data.prompt_eval_count || 0,
                outputTokens: data.eval_count || 0,
                totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
              },
            } as ModelStreamEvent;
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.trim());
          if (data.message?.content) {
            yield { type: 'text_delta', text: data.message.content } as ModelStreamEvent;
          }
          if (data.done) {
            yield {
              type: 'message_delta',
              stopReason: 'end_turn' as const,
              usage: {
                inputTokens: data.prompt_eval_count || 0,
                outputTokens: data.eval_count || 0,
                totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
              },
            } as ModelStreamEvent;
          }
        } catch {
          // ignore trailing garbage
        }
      }

      yield { type: 'message_stop' } as ModelStreamEvent;
    } catch (err: any) {
      if (err instanceof ModelError) throw err;
      if (err.name === 'AbortError') {
        throw new NetworkError('Streaming request timeout or cancelled', { provider: 'ollama' });
      }
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new ProviderError('Ollama is unavailable at ' + this.endpoint, { provider: 'ollama' });
      }
      throw new ProviderError(`Ollama streaming failed: ${err.message}`, { provider: 'ollama' });
    }
  }
}
