import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { EventNotFoundError, EventStoreError } from './errors.js';
import type { EventBus } from './event-bus.js';
import type { Event, EventFilter } from './types.js';

export class EventStore {
  constructor(public readonly filePath: string) {}

  /**
   * Append a single event to the JSONL store file.
   */
  async append(event: Event): Promise<void> {
    await this.appendBatch([event]);
  }

  /**
   * Append multiple events to the JSONL store file.
   */
  async appendBatch(events: Event[]): Promise<void> {
    if (events.length === 0) return;

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(this.filePath, lines, 'utf-8');
    } catch (err) {
      throw new EventStoreError(`Failed to append to event store at "${this.filePath}"`, { cause: err });
    }
  }

  /**
   * Stream events matching the given filter.
   */
  async *stream(filter?: EventFilter): AsyncIterable<Event> {
    let exists = false;
    try {
      await fs.access(this.filePath);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) return;

    const fileStream = createReadStream(this.filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let foundSinceId = filter?.sinceId ? false : true;
    let count = 0;

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: Event;
      try {
        event = JSON.parse(trimmed) as Event;
      } catch {
        continue; // Skip corrupted lines
      }

      if (filter?.sinceId && !foundSinceId) {
        if (event.id === filter.sinceId) {
          foundSinceId = true;
        }
        continue;
      }

      if (this.matchesFilter(event, filter)) {
        yield event;
        count++;
        if (filter?.limit !== undefined && count >= filter.limit) {
          rl.close();
          fileStream.destroy();
          break;
        }
      }
    }
  }

  /**
   * Read all events matching the given filter into an array.
   */
  async read(filter?: EventFilter): Promise<Event[]> {
    const events: Event[] = [];
    for await (const event of this.stream(filter)) {
      events.push(event);
    }
    return events;
  }

  /**
   * Replay matching events by emitting them sequentially to an EventBus.
   */
  async replay(bus: EventBus, filter?: EventFilter): Promise<number> {
    let replayedCount = 0;
    for await (const event of this.stream(filter)) {
      await bus.emit(event);
      replayedCount++;
    }
    return replayedCount;
  }

  /**
   * Resume streaming from after lastEventId (or from beginning if lastEventId is not provided).
   */
  async resume(
    bus: EventBus,
    lastEventId?: string,
  ): Promise<{ replayedCount: number; lastEventId: string | null }> {
    if (lastEventId) {
      const allEvents = await this.read();
      const targetIndex = allEvents.findIndex((e) => e.id === lastEventId);
      if (targetIndex === -1) {
        throw new EventNotFoundError(lastEventId);
      }
    }

    const filter: EventFilter | undefined = lastEventId ? { sinceId: lastEventId } : undefined;
    let replayedCount = 0;
    let newestId: string | null = lastEventId ?? null;

    for await (const event of this.stream(filter)) {
      await bus.emit(event);
      replayedCount++;
      newestId = event.id;
    }

    return { replayedCount, lastEventId: newestId };
  }

  /**
   * Fork the event store to a new JSONL file, optionally capping up to upToEventId.
   */
  async fork(newFilePath: string, upToEventId?: string): Promise<EventStore> {
    const eventsToCopy: Event[] = [];
    let foundCap = false;

    for await (const event of this.stream()) {
      eventsToCopy.push(event);
      if (upToEventId && event.id === upToEventId) {
        foundCap = true;
        break;
      }
    }

    if (upToEventId && !foundCap) {
      throw new EventNotFoundError(upToEventId);
    }

    const forkedStore = new EventStore(newFilePath);
    await forkedStore.appendBatch(eventsToCopy);
    return forkedStore;
  }

  private matchesFilter(event: Event, filter?: EventFilter): boolean {
    if (!filter) return true;

    if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) {
      return false;
    }

    if (filter.sinceTimestamp !== undefined && event.timestamp < filter.sinceTimestamp) {
      return false;
    }

    if (filter.untilTimestamp !== undefined && event.timestamp > filter.untilTimestamp) {
      return false;
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
