export class EventsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EventsError';
  }
}

export class EventBusError extends EventsError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EventBusError';
  }
}

export class EventStoreError extends EventsError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EventStoreError';
  }
}

export class EventNotFoundError extends EventStoreError {
  constructor(public readonly eventId: string) {
    super(`Event with id "${eventId}" was not found.`);
    this.name = 'EventNotFoundError';
  }
}

export class EventValidationError extends EventsError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EventValidationError';
  }
}

export class EventCorruptedError extends EventStoreError {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly lineNumber: number,
    options?: ErrorOptions
  ) {
    super(`Corrupted event store in "${filePath}" at line ${lineNumber}: ${message}`, options);
    this.name = 'EventCorruptedError';
  }
}

export class SequenceError extends EventStoreError {
  constructor(
    message: string,
    public readonly expectedSequence: number,
    public readonly actualSequence: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SequenceError';
  }
}
