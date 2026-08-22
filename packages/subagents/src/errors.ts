export class SubagentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubagentError';
  }
}

export class SubagentLimitExceededError extends SubagentError {
  constructor(message: string) {
    super(message);
    this.name = 'SubagentLimitExceededError';
  }
}
