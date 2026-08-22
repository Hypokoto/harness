import Anthropic from '@anthropic-ai/sdk';
import {
  AuthenticationError,
  InvalidRequestError,
  ModelError,
  NetworkError,
  ProviderError,
  RateLimitError,
  UnknownModelError,
} from './errors.js';
import type {
  ContentBlock,
  ImageContentBlock,
  Message,
  Model,
  ModelOptions,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StopReason,
  TextContentBlock,
} from './types.js';

export interface AnthropicModelOptions extends ModelOptions {
  client?: Anthropic;
}

export class AnthropicModel implements Model {
  public readonly provider = 'anthropic';
  public readonly defaultModel: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicModelOptions = {}) {
    this.defaultModel = options.model ?? 'claude-3-5-sonnet-20241022';
    if (options.client) {
      this.client = options.client;
    } else {
      this.client = new Anthropic({
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
        baseURL: options.baseUrl,
        maxRetries: options.maxRetries ?? 2,
        timeout: options.timeout,
      });
    }
  }

  public async complete(request: ModelRequest): Promise<ModelResponse> {
    try {
      const params = this.buildCreateParams(request);
      const response = await this.client.messages.create(params);
      return this.mapResponse(response);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  public async *completeStream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    try {
      const params = this.buildCreateParams(request);
      const stream = this.client.messages.stream(params);

      for await (const event of stream) {
        if (event.type === 'message_start') {
          yield {
            type: 'message_start',
            id: event.message.id,
            model: event.message.model,
            role: 'assistant',
          };
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield {
              type: 'text_delta',
              text: event.delta.text,
            };
          }
        } else if (event.type === 'message_delta') {
          yield {
            type: 'message_delta',
            stopReason: this.mapStopReason(event.delta.stop_reason),
            usage: event.usage
              ? {
                  inputTokens: 0,
                  outputTokens: event.usage.output_tokens,
                  totalTokens: event.usage.output_tokens,
                }
              : undefined,
          };
        } else if (event.type === 'message_stop') {
          yield {
            type: 'message_stop',
          };
        }
      }
    } catch (error) {
      const normalized = this.normalizeError(error);
      yield { type: 'error', error: normalized };
      throw normalized;
    }
  }

  public normalizeError(error: unknown): ModelError {
    if (error instanceof ModelError) {
      return error;
    }

    if (error instanceof Anthropic.APIConnectionError) {
      return new NetworkError(error.message || 'Network connection failed', {
        provider: this.provider,
        rawError: error,
        cause: error,
      });
    }

    if (error instanceof Anthropic.APIError) {
      const status = error.status;
      const message = error.message || 'Anthropic API Error';

      if (error instanceof Anthropic.AuthenticationError || status === 401 || status === 403) {
        return new AuthenticationError(message, {
          statusCode: status,
          provider: this.provider,
          rawError: error,
          cause: error,
        });
      }

      if (error instanceof Anthropic.RateLimitError || status === 429) {
        let retryAfterMs: number | undefined;
        if (error.headers) {
          const retryAfterHeader =
            error.headers['retry-after'] || error.headers['retry-after-ms'];
          if (retryAfterHeader) {
            const parsed = Number.parseInt(retryAfterHeader, 10);
            if (!Number.isNaN(parsed)) {
              retryAfterMs = retryAfterHeader.includes('-ms') ? parsed : parsed * 1000;
            }
          }
        }
        return new RateLimitError(message, {
          statusCode: status,
          provider: this.provider,
          retryAfterMs,
          rawError: error,
          cause: error,
        });
      }

      if (
        error instanceof Anthropic.BadRequestError ||
        error instanceof Anthropic.UnprocessableEntityError ||
        status === 400 ||
        status === 422
      ) {
        return new InvalidRequestError(message, {
          statusCode: status,
          provider: this.provider,
          rawError: error,
          cause: error,
        });
      }

      if (error instanceof Anthropic.InternalServerError || (status && status >= 500)) {
        return new ProviderError(message, {
          statusCode: status,
          provider: this.provider,
          retryable: true,
          rawError: error,
          cause: error,
        });
      }

      return new ProviderError(message, {
        statusCode: status,
        provider: this.provider,
        rawError: error,
        cause: error,
      });
    }

    if (error instanceof Anthropic.APIConnectionError) {
      return new NetworkError(error.message || 'Network connection failed', {
        provider: this.provider,
        rawError: error,
        cause: error,
      });
    }

    if (error && typeof error === 'object' && 'status' in error) {
      const errObj = error as { status?: number; message?: string };
      const status = errObj.status;
      const msg = errObj.message || 'Anthropic SDK Error';

      if (status === 401 || status === 403) {
        return new AuthenticationError(msg, { statusCode: status, provider: this.provider, rawError: error });
      }
      if (status === 429) {
        return new RateLimitError(msg, { statusCode: status, provider: this.provider, rawError: error });
      }
      if (status === 400 || status === 422) {
        return new InvalidRequestError(msg, { statusCode: status, provider: this.provider, rawError: error });
      }
      if (status && status >= 500) {
        return new ProviderError(msg, { statusCode: status, provider: this.provider, rawError: error });
      }
    }

    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred';

    return new UnknownModelError(message, {
      provider: this.provider,
      rawError: error,
      cause: error instanceof Error ? error : undefined,
    });
  }

  private buildCreateParams(request: ModelRequest): Anthropic.MessageCreateParamsNonStreaming {
    const model = request.model ?? this.defaultModel;
    const max_tokens = request.maxTokens ?? 4096;

    // Handle system prompt & system messages
    let systemParam: Anthropic.MessageCreateParamsNonStreaming['system'] = undefined;
    const messages: Anthropic.MessageParam[] = [];

    const systemParts: string[] = [];
    if (typeof request.system === 'string') {
      systemParts.push(request.system);
    } else if (Array.isArray(request.system)) {
      for (const block of request.system) {
        if (block.type === 'text') {
          systemParts.push(block.text);
        }
      }
    }

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        const textContent = typeof msg.content === 'string'
          ? msg.content
          : msg.content.filter((b): b is TextContentBlock => b.type === 'text').map((b) => b.text).join('\n');
        systemParts.push(textContent);
      } else {
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: this.formatMessageContent(msg.content),
        });
      }
    }

    if (systemParts.length > 0) {
      systemParam = systemParts.join('\n\n');
    }

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens,
      messages,
    };

    if (systemParam) {
      params.system = systemParam;
    }
    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }
    if (request.topP !== undefined) {
      params.top_p = request.topP;
    }
    if (request.topK !== undefined) {
      params.top_k = request.topK;
    }
    if (request.stopSequences && request.stopSequences.length > 0) {
      params.stop_sequences = request.stopSequences;
    }

    return params;
  }

  private formatMessageContent(
    content: string | ContentBlock[]
  ): string | Anthropic.ContentBlockParam[] {
    if (typeof content === 'string') {
      return content;
    }

    return content.map((block): Anthropic.ContentBlockParam => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      }
      if (block.type === 'image') {
        const imgBlock = block as ImageContentBlock;
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imgBlock.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: imgBlock.data,
          },
        };
      }
      throw new InvalidRequestError(`Unsupported content block type: ${(block as { type: string }).type}`);
    });
  }

  private mapResponse(response: Anthropic.Message): ModelResponse {
    const content: ContentBlock[] = [];
    const textParts: string[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
        textParts.push(block.text);
      }
    }

    return {
      id: response.id,
      model: response.model,
      role: 'assistant',
      content,
      text: textParts.join(''),
      stopReason: this.mapStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      rawResponse: response,
    };
  }

  private mapStopReason(stopReason: string | null): StopReason {
    if (!stopReason) return 'unknown';
    switch (stopReason) {
      case 'end_turn':
        return 'end_turn';
      case 'max_tokens':
        return 'max_tokens';
      case 'stop_sequence':
        return 'stop_sequence';
      default:
        return 'unknown';
    }
  }
}
