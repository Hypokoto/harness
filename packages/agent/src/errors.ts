export interface AgentErrorOptions extends ErrorOptions {
  sessionId?: string;
  cause?: unknown;
}

export class AgentError extends Error {
  public readonly sessionId?: string;

  constructor(message: string, options?: AgentErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = 'AgentError';
    this.sessionId = options?.sessionId;
  }
}

export class MaxStepsExceededError extends AgentError {
  public readonly steps: number;

  constructor(steps: number, options?: AgentErrorOptions) {
    super(`Agent loop exceeded maximum allowed steps (${steps}).`, options);
    this.name = 'MaxStepsExceededError';
    this.steps = steps;
  }
}

export class SessionNotFoundError extends AgentError {
  constructor(sessionId: string, options?: AgentErrorOptions) {
    super(`Session "${sessionId}" was not found.`, { sessionId, ...options });
    this.name = 'SessionNotFoundError';
  }
}

export class AgentExecutionError extends AgentError {
  constructor(message: string, options?: AgentErrorOptions) {
    super(message, options);
    this.name = 'AgentExecutionError';
  }
}
