import type { EventStore } from '@harness/events';
import type { ModelMessage } from '@harness/model';

export interface SessionOptions {
  id?: string;
  systemPrompt?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  eventStore?: EventStore;
  initialMessages?: ModelMessage[];
}

export class Session {
  public readonly id: string;
  public systemPrompt?: string;
  public model?: string;
  public readonly metadata: Record<string, unknown>;
  private readonly messages: ModelMessage[] = [];
  private eventStore?: EventStore;

  private pendingEvents: Promise<unknown> = Promise.resolve();

  constructor(options: SessionOptions = {}) {
    this.id =
      options.id ||
      `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.systemPrompt = options.systemPrompt;
    this.model = options.model;
    this.metadata = options.metadata ? { ...options.metadata } : {};
    this.eventStore = options.eventStore;

    if (options.initialMessages && options.initialMessages.length > 0) {
      this.messages.push(...options.initialMessages);
    }

    if (this.eventStore) {
      this.logEvent('session_created', {
        sessionId: this.id,
        systemPrompt: this.systemPrompt,
        model: this.model,
        metadata: this.metadata,
      });
    }
  }

  public addMessage(message: ModelMessage): void {
    this.messages.push(message);
    this.logEvent('message_added', {
      sessionId: this.id,
      role: message.role,
      content: message.content,
    });
  }

  public addMessages(messages: ModelMessage[]): void {
    for (const msg of messages) {
      this.addMessage(msg);
    }
  }

  public getMessages(): ModelMessage[] {
    return [...this.messages];
  }

  public clearHistory(): void {
    this.messages.length = 0;
    this.logEvent('history_cleared', {
      sessionId: this.id,
    });
  }

  public setEventStore(store?: EventStore): void {
    this.eventStore = store;
  }

  public getEventStore(): EventStore | undefined {
    return this.eventStore;
  }

  public async flushEvents(): Promise<void> {
    await this.pendingEvents;
  }

  private logEvent(type: string, payload: Record<string, unknown>): void {
    if (!this.eventStore) return;
    const store = this.eventStore;
    this.pendingEvents = this.pendingEvents
      .then(() =>
        store.append({
          sessionId: this.id,
          type,
          payload,
        })
      )
      .then(() => {})
      .catch(() => {
        // Ignore logging failures to avoid crashing session operations
      });
  }
}
