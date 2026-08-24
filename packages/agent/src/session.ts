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
  
  // Replay validation state
  private activeToolCalls = new Set<string>();
  private activeGeneration = false;

  private pendingEvents: Promise<unknown> = Promise.resolve();
  private isLocked = false;

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

  public acquireLock(): void {
    if (this.isLocked) {
      throw new Error('Session is already actively processing a request');
    }
    this.isLocked = true;
  }

  public releaseLock(): void {
    this.isLocked = false;
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

  public startTurn(): void {
    this.logEvent('agent_turn_started', {
      sessionId: this.id,
      messagesCount: this.messages.length,
    });
  }

  public completeTurn(options: { text: string; stopReason?: string }): void {
    this.logEvent('agent_turn_completed', {
      sessionId: this.id,
      text: options.text,
      stopReason: options.stopReason,
    });
  }

  public startGeneration(options: { model?: string } = {}): void {
    if (this.activeGeneration) {
      throw new Error('generation.started without completing previous generation');
    }
    this.activeGeneration = true;
    this.logEvent('generation.started', {
      sessionId: this.id,
      model: options.model || this.model,
    });
  }

  public completeGeneration(options: { response: string; stopReason?: string }): void {
    if (!this.activeGeneration) throw new Error('generation.completed without generation.started');
    this.activeGeneration = false;
    this.logEvent('generation.completed', {
      sessionId: this.id,
      response: options.response,
      stopReason: options.stopReason,
    });
  }

  public failGeneration(options: { error: string }): void {
    if (!this.activeGeneration) throw new Error('generation.failed without generation.started');
    this.activeGeneration = false;
    this.logEvent('generation.failed', {
      sessionId: this.id,
      error: options.error,
    });
  }

  public abortGeneration(): void {
    if (!this.activeGeneration) throw new Error('generation.aborted without generation.started');
    this.activeGeneration = false;
    this.logEvent('generation.aborted', {
      sessionId: this.id,
    });
  }

  public logGenerationChunk(text: string): void {
    if (!this.activeGeneration) throw new Error('generation.chunk without generation.started');
    this.logEvent('generation.chunk', {
      sessionId: this.id,
      text,
    });
  }

  public startToolCall(options: { toolCallId: string; toolName: string; input: unknown }): void {
    this.activeToolCalls.add(options.toolCallId);
    this.logEvent('tool.called', {
      sessionId: this.id,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      input: options.input,
    });
  }

  public completeToolCall(options: { toolCallId: string; toolName: string; result: unknown }): void {
    if (!this.activeToolCalls.has(options.toolCallId)) throw new Error('tool.completed without tool.called');
    this.activeToolCalls.delete(options.toolCallId);
    this.logEvent('tool.completed', {
      sessionId: this.id,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      result: options.result,
    });
  }

  public failToolCall(options: { toolCallId: string; toolName: string; error: string }): void {
    if (!this.activeToolCalls.has(options.toolCallId)) throw new Error('tool.failed without tool.called');
    this.activeToolCalls.delete(options.toolCallId);
    this.logEvent('tool.failed', {
      sessionId: this.id,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      error: options.error,
    });
  }

  public static async replay(id: string, eventStore: EventStore): Promise<Session> {
    const session = new Session({ id, eventStore });
    // Disable logging during replay
    session.setEventStore(undefined);

    const events = await eventStore.read(id);
    if (events.length === 0) {
      session.setEventStore(eventStore);
      return session;
    }

    for (const event of events) {
      const payload = event.payload as any;
      switch (event.type) {
        case 'session_created':
          session.systemPrompt = payload.systemPrompt as string | undefined;
          session.model = payload.model as string | undefined;
          Object.assign(session.metadata, payload.metadata || {});
          break;
        case 'message_added':
          session.messages.push({
            role: payload.role as 'user' | 'assistant',
            content: payload.content as string | any[],
          });
          break;
        case 'generation.started':
          if (session.activeGeneration) {
            throw new Error('generation.started without completing previous generation');
          }
          session.activeGeneration = true;
          break;
        case 'generation.completed':
        case 'generation.failed':
        case 'generation.aborted':
          if (!session.activeGeneration) {
            throw new Error(`${event.type} without generation.started`);
          }
          session.activeGeneration = false;
          break;
        case 'generation.chunk':
          if (!session.activeGeneration) {
            throw new Error(`generation.chunk without generation.started`);
          }
          break;
        case 'agent_turn_started':
        case 'agent_turn_completed':
          // Just organizational events, no state validation needed for now
          break;
        case 'tool.called':
          session.activeToolCalls.add(payload.toolCallId as string);
          break;
        case 'tool.completed':
        case 'tool.failed':
          if (!session.activeToolCalls.has(payload.toolCallId as string)) {
            throw new Error(`${event.type} without tool.called`);
          }
          session.activeToolCalls.delete(payload.toolCallId as string);
          break;
        case 'history_cleared':
          session.messages.length = 0;
          break;
        default:
          throw new Error(`Unknown event type during replay: ${event.type}`);
      }
    }

    session.setEventStore(eventStore);
    return session;
  }
}
