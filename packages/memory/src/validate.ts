import type { MemoryRecord, MemoryType, MemoryState } from './types.js';

export function validateMemory(record: Partial<MemoryRecord>): void {
  if (!record.id || typeof record.id !== 'string') {
    throw new Error('Invalid memory: missing or invalid id');
  }
  if (!['memory', 'knowledge', 'decision'].includes(record.type as any)) {
    throw new Error('Invalid memory: invalid type');
  }
  if (!record.content || typeof record.content !== 'string') {
    throw new Error('Invalid memory: missing or invalid content');
  }
  if (!record.scope || typeof record.scope !== 'string') {
    throw new Error('Invalid memory: missing or invalid scope');
  }
  if (!record.timestamp || typeof record.timestamp !== 'number') {
    throw new Error('Invalid memory: missing or invalid timestamp');
  }
  if (!['active', 'stale', 'expired'].includes(record.state as any)) {
    throw new Error('Invalid memory: invalid state');
  }

  if (record.provenance) {
    if (record.provenance.source !== undefined && typeof record.provenance.source !== 'string') {
      throw new Error('Invalid memory: invalid provenance source');
    }
    if (record.provenance.derived_from !== undefined && !Array.isArray(record.provenance.derived_from)) {
      throw new Error('Invalid memory: invalid provenance derived_from');
    }
    if (record.provenance.based_on !== undefined && !Array.isArray(record.provenance.based_on)) {
      throw new Error('Invalid memory: invalid provenance based_on');
    }
    if (record.provenance.superseded_by !== undefined && typeof record.provenance.superseded_by !== 'string') {
      throw new Error('Invalid memory: invalid provenance superseded_by');
    }

    if (record.type === 'knowledge' && !record.provenance.derived_from) {
      throw new Error('Invalid knowledge: must have derived_from provenance');
    }
    if (record.type === 'decision' && !record.provenance.based_on) {
      throw new Error('Invalid decision: must have based_on provenance');
    }
  } else {
    if (record.type === 'knowledge') {
      throw new Error('Invalid knowledge: must have derived_from provenance');
    }
    if (record.type === 'decision') {
      throw new Error('Invalid decision: must have based_on provenance');
    }
  }
}
