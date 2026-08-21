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
