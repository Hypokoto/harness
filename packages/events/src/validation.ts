import { EventValidationError } from './errors.js';
import type { EventEnvelope } from './types.js';

export function validateEventEnvelope(data: unknown): EventEnvelope {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new EventValidationError('Event must be a non-null object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.trim() === '') {
    throw new EventValidationError('Event id must be a non-empty string');
  }

  if (typeof obj.sessionId !== 'string' || obj.sessionId.trim() === '') {
    throw new EventValidationError('Event sessionId must be a non-empty string');
  }

  if (typeof obj.type !== 'string' || obj.type.trim() === '') {
    throw new EventValidationError('Event type must be a non-empty string');
  }

  if (typeof obj.sequence !== 'number' || !Number.isInteger(obj.sequence) || obj.sequence < 0) {
    throw new EventValidationError('Event sequence must be a non-negative integer');
  }

  if (typeof obj.timestamp !== 'string' && typeof obj.timestamp !== 'number') {
    throw new EventValidationError('Event timestamp must be a valid timestamp string or number');
  }

  if (typeof obj.timestamp === 'string' && obj.timestamp.trim() === '') {
    throw new EventValidationError('Event timestamp string must not be empty');
  }

  if (obj.payload === undefined) {
    throw new EventValidationError('Event payload must be defined');
  }

  if (obj.metadata !== undefined && (typeof obj.metadata !== 'object' || obj.metadata === null || Array.isArray(obj.metadata))) {
    throw new EventValidationError('Event metadata must be an object if provided');
  }

  return {
    id: obj.id,
    sessionId: obj.sessionId,
    type: obj.type,
    sequence: obj.sequence,
    timestamp: String(obj.timestamp),
    payload: obj.payload,
    metadata: obj.metadata as Record<string, unknown> | undefined,
  };
}
