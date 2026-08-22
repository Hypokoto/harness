import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  EventCorruptedError,
  EventNotFoundError,
  EventStoreError,
  SequenceError,
} from './errors.js';
import type { EventBus } from './event-bus.js';
import { replay } from './replay.js';
import type { EventEnvelope, EventFilter, Reducer } from './types.js';
import { validateEventEnvelope } from './validation.js';

export type EventInput<T = unknown> = {
  id?: string;
  sessionId?: string;
  type: string;
  sequence?: number;
  timestamp?: string;
  payload: T;
  metadata?: Record<string, unknown>;
};

export class EventStore {
  private readonly sessionLocks = new Map<string, Promise<void>>();

  constructor(public readonly location: string) {}

  /**
   * Determine file path for a session.
   */
  getFilePath(sessionId?: string): string {
    if (this.location.endsWith('.jsonl') || this.location.endsWith('.json')) {
      return this.location;
    }
    if (!sessionId) {
      return path.join(this.location, 'default.jsonl');
    }
    return path.join(this.location, `${sessionId}.jsonl`);
  }

  private async withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    let release: () => void;
    const newLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sessionLocks.set(
      sessionId,
      currentLock.then(() => newLock)
    );

    try {
      await currentLock;
      return await fn();
    } finally {
      release!();
      if (this.sessionLocks.get(sessionId) === newLock) {
        this.sessionLocks.delete(sessionId);
      }
    }
  }

  /**
   * Append a single event to the store.
   */
  async append<T = unknown>(eventInput: EventInput<T>): Promise<EventEnvelope<T>> {
    const [appended] = await this.appendBatch([eventInput]);
    return appended as EventEnvelope<T>;
  }

  /**
   * Append a batch of events to the store.
   */
  async appendBatch(eventsInput: EventInput[]): Promise<EventEnvelope[]> {
    if (eventsInput.length === 0) return [];

    const defaultSessionId = eventsInput[0].sessionId || 'default';

    return this.withSessionLock(defaultSessionId, async () => {
      const filePath = this.getFilePath(defaultSessionId);
      let lastSeq = await this.getLastSequenceForSession(defaultSessionId, filePath);

      const validatedEvents: EventEnvelope[] = [];

      for (const input of eventsInput) {
        const sessionId = input.sessionId || defaultSessionId;

        const expectedSeq = lastSeq + 1;

        if (input.sequence !== undefined && input.sequence !== expectedSeq) {
          throw new SequenceError(
            `Sequence mismatch for session "${sessionId}": expected ${expectedSeq}, got ${input.sequence}`,
            expectedSeq,
            input.sequence
          );
        }

        const fullEvent: EventEnvelope = {
          id: input.id || crypto.randomUUID(),
          sessionId,
          type: input.type,
          sequence: expectedSeq,
          timestamp: input.timestamp || new Date().toISOString(),
          payload: input.payload,
          metadata: input.metadata,
        };

        const validated = validateEventEnvelope(fullEvent);
        validatedEvents.push(validated);
        lastSeq = expectedSeq;
      }

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const lines = validatedEvents.map((e) => JSON.stringify(e)).join('\n') + '\n';
        await fs.appendFile(filePath, lines, 'utf-8');
      } catch (err) {
        if (err instanceof EventStoreError) throw err;
        throw new EventStoreError(`Failed to append events to file "${filePath}"`, { cause: err });
      }

      return validatedEvents;
    });
  }

  private async getLastSequenceForSession(sessionId: string, filePath: string): Promise<number> {
    const events = await this.readFromFile(filePath, sessionId, { validateSequences: true });
    if (events.length === 0) return -1;
    return events[events.length - 1].sequence;
  }

  /**
   * Stream events matching session and filter.
   */
  stream(sessionId: string, filter?: EventFilter): AsyncIterable<EventEnvelope>;
  stream(filter?: EventFilter): AsyncIterable<EventEnvelope>;
  async *stream(
    sessionIdOrFilter?: string | EventFilter,
    filter?: EventFilter
  ): AsyncIterable<EventEnvelope> {
    let sessionId: string | undefined;
    let effectiveFilter: EventFilter | undefined;

    if (typeof sessionIdOrFilter === 'string') {
      sessionId = sessionIdOrFilter;
      effectiveFilter = filter;
    } else if (typeof sessionIdOrFilter === 'object' && sessionIdOrFilter !== null) {
      effectiveFilter = sessionIdOrFilter;
      sessionId = undefined;
    } else {
      sessionId = undefined;
      effectiveFilter = filter;
    }

    const filePath = this.getFilePath(sessionId);
    const events = await this.readFromFile(filePath, sessionId, {
      validateSequences: true,
      filter: effectiveFilter,
    });

    for (const event of events) {
      yield event;
    }
  }

  /**
   * Read events into an array.
   */
  read(sessionId: string, filter?: EventFilter): Promise<EventEnvelope[]>;
  read(filter?: EventFilter): Promise<EventEnvelope[]>;
  async read(
    sessionIdOrFilter?: string | EventFilter,
    filter?: EventFilter
  ): Promise<EventEnvelope[]> {
    const events: EventEnvelope[] = [];
    for await (const event of this.stream(sessionIdOrFilter as any, filter)) {
      events.push(event);
    }
    return events;
  }

  /**
   * Replay events through a state reducer.
   */
  async replay<TState>(
    sessionId: string,
    initialState: TState,
    reducer: Reducer<TState>,
    filter?: EventFilter
  ): Promise<TState>;
  /**
   * Replay events to an EventBus.
   */
  async replay(bus: EventBus, filter?: EventFilter): Promise<number>;
  async replay<TState>(
    sessionIdOrBus: string | EventBus,
    stateOrFilter?: TState | EventFilter,
    reducer?: Reducer<TState>,
    filter?: EventFilter
  ): Promise<TState | number> {
    if (typeof sessionIdOrBus === 'string' && reducer) {
      const sessionId = sessionIdOrBus;
      const initialState = stateOrFilter as TState;
      const events = await this.read(sessionId, filter);
      return replay(events, initialState, reducer);
    } else if (typeof sessionIdOrBus === 'object') {
      const bus = sessionIdOrBus as EventBus;
      const effectiveFilter = stateOrFilter as EventFilter | undefined;
      let count = 0;
      for await (const event of this.stream(effectiveFilter)) {
        await bus.emit(event);
        count++;
      }
      return count;
    } else {
      throw new EventStoreError('Invalid arguments to replay');
    }
  }

  /**
   * Resume event streaming to an EventBus from after lastEventId.
   */
  async resume(
    sessionId: string,
    bus: EventBus,
    lastEventId?: string
  ): Promise<{ replayedCount: number; lastEventId: string | null }>;
  async resume(
    bus: EventBus,
    lastEventId?: string
  ): Promise<{ replayedCount: number; lastEventId: string | null }>;
  async resume(
    sessionIdOrBus: string | EventBus,
    busOrLastEventId?: EventBus | string,
    lastEventId?: string
  ): Promise<{ replayedCount: number; lastEventId: string | null }> {
    let sessionId: string | undefined;
    let bus: EventBus;
    let targetLastEventId: string | undefined;

    if (typeof sessionIdOrBus === 'string') {
      sessionId = sessionIdOrBus;
      bus = busOrLastEventId as EventBus;
      targetLastEventId = lastEventId;
    } else {
      bus = sessionIdOrBus as EventBus;
      targetLastEventId = busOrLastEventId as string | undefined;
    }

    const allEvents = await this.read(sessionId as any);

    if (targetLastEventId) {
      const idx = allEvents.findIndex((e) => e.id === targetLastEventId);
      if (idx === -1) {
        throw new EventNotFoundError(targetLastEventId);
      }
    }

    const filter: EventFilter | undefined = targetLastEventId
      ? { sinceId: targetLastEventId }
      : undefined;

    let replayedCount = 0;
    let newestId: string | null = targetLastEventId ?? null;

    for await (const event of this.stream(sessionId as any, filter)) {
      await bus.emit(event);
      replayedCount++;
      newestId = event.id;
    }

    return { replayedCount, lastEventId: newestId };
  }

  /**
   * Fork an existing store/session to a new target location.
   */
  async fork(
    sourceSessionId: string,
    newSessionIdOrLocation: string,
    upToEventId?: string
  ): Promise<EventStore>;
  async fork(
    newFilePathOrLocation: string,
    upToEventId?: string
  ): Promise<EventStore>;
  async fork(
    targetOrSessionId: string,
    newLocationOrUpToId?: string,
    upToEventId?: string
  ): Promise<EventStore> {
    let sourceSessionId: string | undefined;
    let newLocation: string;
    let targetUpToId: string | undefined;

    if (this.location.endsWith('.jsonl') || this.location.endsWith('.json')) {
      // Single file mode: fork(newFilePath, upToEventId)
      sourceSessionId = undefined;
      newLocation = targetOrSessionId;
      targetUpToId = newLocationOrUpToId;
    } else if (upToEventId !== undefined) {
      // 3 args: fork(sourceSessionId, newSessionIdOrLocation, upToEventId)
      sourceSessionId = targetOrSessionId;
      newLocation = newLocationOrUpToId!;
      targetUpToId = upToEventId;
    } else if (
      newLocationOrUpToId &&
      (newLocationOrUpToId.endsWith('.jsonl') ||
        newLocationOrUpToId.includes('/') ||
        newLocationOrUpToId.includes('\\'))
    ) {
      // 2 args where 2nd is path/dir: fork(sourceSessionId, newLocation)
      sourceSessionId = targetOrSessionId;
      newLocation = newLocationOrUpToId;
      targetUpToId = undefined;
    } else {
      // 2 args where 1st is target path: fork(newFilePath, upToEventId)
      sourceSessionId = undefined;
      newLocation = targetOrSessionId;
      targetUpToId = newLocationOrUpToId;
    }

    const eventsToCopy: EventEnvelope[] = [];
    let foundCap = false;

    const allEvents = await this.read(sourceSessionId as any);

    for (const event of allEvents) {
      eventsToCopy.push(event);
      if (targetUpToId && event.id === targetUpToId) {
        foundCap = true;
        break;
      }
    }

    if (targetUpToId && !foundCap) {
      throw new EventNotFoundError(targetUpToId);
    }

    const forkedStore = new EventStore(newLocation.endsWith('.jsonl') ? newLocation : this.location);
    const targetSessionId = newLocation.endsWith('.jsonl') ? (eventsToCopy[0]?.sessionId || 'default') : newLocation;

    // Prepare events for forking with targetSessionId
    const prepareEvents: EventInput[] = eventsToCopy.map((e) => ({
      id: e.id,
      sessionId: targetSessionId,
      type: e.type,
      sequence: e.sequence,
      timestamp: e.timestamp,
      payload: e.payload,
      metadata: e.metadata,
    }));

    await forkedStore.appendBatch(prepareEvents);
    return forkedStore;
  }

  private async readFromFile(
    filePath: string,
    targetSessionId?: string,
    options?: { validateSequences?: boolean; filter?: EventFilter }
  ): Promise<EventEnvelope[]> {
    let exists = false;
    try {
      await fs.access(filePath);
      exists = true;
    } catch {
      return [];
    }

    const fileContent = await fs.readFile(filePath, 'utf-8');
    const lines = fileContent.split(/\r?\n/);
    const events: EventEnvelope[] = [];
    let expectedSeq = 0;
    let count = 0;
    let foundSinceId = options?.filter?.sinceId ? false : true;

    for (let i = 0; i < lines.length; i++) {
      const lineNumber = i + 1;
      const line = lines[i].trim();

      if (!line && i === lines.length - 1) continue;
      if (!line) {
        throw new EventCorruptedError('Unexpected empty line in JSONL event file', filePath, lineNumber);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new EventCorruptedError(
          `Invalid JSON syntax: ${(err as Error).message}`,
          filePath,
          lineNumber,
          { cause: err }
        );
      }

      let event: EventEnvelope;
      try {
        event = validateEventEnvelope(parsed);
      } catch (err) {
        throw new EventCorruptedError(
          `Invalid event structure: ${(err as Error).message}`,
          filePath,
          lineNumber,
          { cause: err }
        );
      }

      if (targetSessionId && event.sessionId !== targetSessionId && !this.location.endsWith('.jsonl')) {
        throw new EventCorruptedError(
          `Session mismatch: expected "${targetSessionId}", found "${event.sessionId}"`,
          filePath,
          lineNumber
        );
      }

      if (options?.validateSequences) {
        if (event.sequence !== expectedSeq) {
          throw new EventCorruptedError(
            `Sequence corruption: expected ${expectedSeq}, found ${event.sequence}`,
            filePath,
            lineNumber
          );
        }
        expectedSeq++;
      }

      if (options?.filter?.sinceId && !foundSinceId) {
        if (event.id === options.filter.sinceId) {
          foundSinceId = true;
        }
        continue;
      }

      if (this.matchesFilter(event, options?.filter)) {
        events.push(event);
        count++;
        if (options?.filter?.limit !== undefined && count >= options.filter.limit) {
          break;
        }
      }
    }

    return events;
  }

  private matchesFilter(event: EventEnvelope, filter?: EventFilter): boolean {
    if (!filter) return true;

    if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) {
      return false;
    }

    if (filter.sinceSequence !== undefined && event.sequence < filter.sinceSequence) {
      return false;
    }

    if (filter.untilSequence !== undefined && event.sequence > filter.untilSequence) {
      return false;
    }

    if (filter.sinceTimestamp !== undefined) {
      const eventTs = typeof filter.sinceTimestamp === 'number' ? new Date(event.timestamp).getTime() : event.timestamp;
      if (eventTs < filter.sinceTimestamp) return false;
    }

    if (filter.untilTimestamp !== undefined) {
      const eventTs = typeof filter.untilTimestamp === 'number' ? new Date(event.timestamp).getTime() : event.timestamp;
      if (eventTs > filter.untilTimestamp) return false;
    }

    if (filter.metadataMatch) {
      if (!event.metadata) return false;
      for (const [key, val] of Object.entries(filter.metadataMatch)) {
        if (event.metadata[key] !== val) return false;
      }
    }

    return true;
  }
}
