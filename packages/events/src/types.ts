export interface Event<T = unknown> {
  id: string;
  type: string;
  timestamp: number;
  payload: T;
  metadata?: Record<string, unknown>;
}

export interface EventFilter {
  types?: string[];
  sinceTimestamp?: number;
  untilTimestamp?: number;
  sinceId?: string;
  limit?: number;
  metadataMatch?: Record<string, unknown>;
}

export type EventListener<T = unknown> = (event: Event<T>) => void | Promise<void>;
