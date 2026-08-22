export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryError';
  }
}

export class ValidationError extends MemoryError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
