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

export type ToolUseContentBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultContentBlock = {
  type: 'tool_result';
  toolUseId: string;
  content: string | ContentBlock[];
  isError?: boolean;
};

export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

export type ModelMessage = Message;

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'unknown';

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
  tools?: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
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
