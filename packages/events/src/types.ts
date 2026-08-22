export interface EventEnvelope<TPayload = unknown> {
  id: string;
  sessionId: string;
  type: string;
  sequence: number;
  timestamp: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}

export type Event<TPayload = unknown> = EventEnvelope<TPayload>;

export interface EventFilter {
  types?: string[];
  sinceSequence?: number;
  untilSequence?: number;
  sinceTimestamp?: number | string;
  untilTimestamp?: number | string;
  sinceId?: string;
  limit?: number;
  metadataMatch?: Record<string, unknown>;
}

export type EventListener<T = unknown> = (event: EventEnvelope<T>) => void | Promise<void>;

export type Reducer<TState, TPayload = unknown> = (
  state: TState,
  event: EventEnvelope<TPayload>
) => TState;
