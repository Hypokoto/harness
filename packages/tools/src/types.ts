export interface ToolContext {
  sessionId?: string;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface ToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface Tool<TInput = unknown, TResult = unknown> extends ToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
  validateInput?(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<TResult>;
}
