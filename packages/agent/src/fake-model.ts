import type {
  ContentBlock,
  Model,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StopReason,
  ToolUseContentBlock,
} from '@harness/model';

export type ResponseGenerator =
  | ModelResponse
  | string
  | ContentBlock[]
  | ((request: ModelRequest) => ModelResponse | string | ContentBlock[]);

export interface FakeModelOptions {
  provider?: string;
  defaultModel?: string;
  responses?: ResponseGenerator[];
}

export class FakeModel implements Model {
  public readonly provider: string;
  public readonly defaultModel: string;
  private readonly responses: ResponseGenerator[] = [];
  private readonly requestHistory: ModelRequest[] = [];
  private responseIndex = 0;

  constructor(options: FakeModelOptions = {}) {
    this.provider = options.provider ?? 'fake';
    this.defaultModel = options.defaultModel ?? 'fake-model';
    if (options.responses) {
      this.responses.push(...options.responses);
    }
  }

  public enqueueResponse(response: ResponseGenerator): void {
    this.responses.push(response);
  }

  public setResponses(responses: ResponseGenerator[]): void {
    this.responses.length = 0;
    this.responses.push(...responses);
    this.responseIndex = 0;
  }

  public getRequests(): ModelRequest[] {
    return [...this.requestHistory];
  }

  public getLastRequest(): ModelRequest | undefined {
    return this.requestHistory[this.requestHistory.length - 1];
  }

  public clearRequests(): void {
    this.requestHistory.length = 0;
  }

  public async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requestHistory.push(request);

    let rawResp: ResponseGenerator;
    if (this.responseIndex < this.responses.length) {
      rawResp = this.responses[this.responseIndex];
      this.responseIndex++;
    } else {
      rawResp = `Fake response ${this.requestHistory.length} for ${request.messages.length} messages`;
    }

    if (typeof rawResp === 'function') {
      rawResp = rawResp(request);
    }

    return this.normalizeResponse(rawResp, request);
  }

  public async *completeStream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const response = await this.complete(request);
    yield {
      type: 'message_start',
      id: response.id,
      model: response.model,
      role: response.role,
    };

    if (response.text) {
      yield {
        type: 'text_delta',
        text: response.text,
      };
    }

    yield {
      type: 'message_delta',
      stopReason: response.stopReason,
      usage: response.usage,
    };

    yield {
      type: 'message_stop',
    };
  }

  private normalizeResponse(
    resp: ModelResponse | string | ContentBlock[],
    request: ModelRequest
  ): ModelResponse {
    if (
      typeof resp === 'object' &&
      resp !== null &&
      'id' in resp &&
      'content' in resp &&
      'stopReason' in resp
    ) {
      return resp as ModelResponse;
    }

    const id = `msg_fake_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const model = request.model ?? this.defaultModel;

    let content: ContentBlock[];
    let text = '';
    let stopReason: StopReason = 'end_turn';

    if (typeof resp === 'string') {
      content = [{ type: 'text', text: resp }];
      text = resp;
    } else if (Array.isArray(resp)) {
      content = resp;
      const textBlocks = content.filter((b): b is { type: 'text'; text: string } => b.type === 'text');
      let combinedText = textBlocks.map((b) => b.text).join('\n');
      
      const toolBlocks = content.filter((b): b is any => b.type === 'tool_use');
      if (toolBlocks.length > 0) {
        stopReason = 'tool_use';
        const toolStr = toolBlocks.map(t => JSON.stringify({ tool: t.name, input: t.input })).join('\n');
        combinedText = combinedText ? combinedText + '\n' + toolStr : toolStr;
      }
      
      text = combinedText;
    } else {
      content = [{ type: 'text', text: String(resp) }];
      text = String(resp);
    }

    return {
      id,
      model,
      role: 'assistant',
      content,
      text,
      stopReason,
      usage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
      },
    };
  }
}
