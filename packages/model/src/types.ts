export type Role = 'user' | 'assistant' | 'system';

export type TextContentBlock = {
  type: 'text';
  text: string;
};

export type ImageContentBlock = {
  type: 'image';
  mimeType: string;
  data: string;
};

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'unknown';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export interface ModelRequest {
  model?: string;
  messages: Message[];
  system?: string | ContentBlock[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
}

export interface ModelResponse {
  id: string;
  model: string;
  role: Role;
  content: ContentBlock[];
  text: string;
  stopReason: StopReason;
  usage: TokenUsage;
  rawResponse?: unknown;
}

export type ModelStreamEvent =
  | { type: 'message_start'; id: string; model: string; role: Role }
  | { type: 'text_delta'; text: string }
  | { type: 'message_delta'; stopReason?: StopReason; usage?: TokenUsage }
  | { type: 'message_stop' }
  | { type: 'error'; error: unknown };

export interface ModelOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
  [key: string]: unknown;
}

export interface Model {
  readonly provider: string;
  readonly defaultModel: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
  completeStream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
