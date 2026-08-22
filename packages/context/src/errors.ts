export class ContextError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ContextError';
  }
}

export class ContextProviderError extends ContextError {
  constructor(public readonly providerName: string, message: string, options?: { cause?: unknown }) {
    super(`ContextProvider "${providerName}" failed: ${message}`, options);
    this.name = 'ContextProviderError';
  }
}

export class ToolNotFoundError extends ContextError {
  constructor(public readonly toolName: string, message?: string) {
    super(message ?? `Tool "${toolName}" not found in context tool index.`);
    this.name = 'ToolNotFoundError';
  }
}

export class ContextCompositionError extends ContextError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Context composition error: ${message}`, options);
    this.name = 'ContextCompositionError';
  }
}
