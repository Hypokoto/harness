export interface ToolErrorOptions extends ErrorOptions {
  toolName?: string;
  cause?: unknown;
}

export class ToolError extends Error {
  public readonly toolName?: string;

  constructor(message: string, options?: ToolErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = 'ToolError';
    this.toolName = options?.toolName;
  }
}

export class DuplicateToolError extends ToolError {
  constructor(toolName: string, options?: ToolErrorOptions) {
    super(`Tool with name "${toolName}" is already registered.`, {
      toolName,
      ...options,
    });
    this.name = 'DuplicateToolError';
  }
}

export class UnknownToolError extends ToolError {
  constructor(toolName: string, options?: ToolErrorOptions) {
    super(`Tool "${toolName}" is not registered.`, {
      toolName,
      ...options,
    });
    this.name = 'UnknownToolError';
  }
}

export class InvalidInputError extends ToolError {
  public readonly validationErrors?: string[];

  constructor(message: string, options?: ToolErrorOptions & { validationErrors?: string[] }) {
    super(message, options);
    this.name = 'InvalidInputError';
    this.validationErrors = options?.validationErrors;
  }
}

export class ToolExecutionError extends ToolError {
  constructor(message: string, options?: ToolErrorOptions) {
    super(message, options);
    this.name = 'ToolExecutionError';
  }
}
