export interface ToolContext {
  sessionId?: string;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface ToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
  /**
   * Capabilities this tool requires in order to execute.
   * The PermissionPolicy evaluates these requirements — the tool itself
   * does NOT perform enforcement.
   *
   * Empty or absent means the tool requires no capabilities and will always
   * be permitted to execute by the DefaultDenyPolicy.
   */
  readonly requiredCapabilities?: readonly string[];
}

export interface Tool<TInput = unknown, TResult = unknown> extends ToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly requiredCapabilities?: readonly string[];
  validateInput?(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<TResult>;
}
