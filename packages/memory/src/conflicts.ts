import type { MemoryRecord } from './types.js';
import { calculateCosineSimilarity } from './dedup.js';

export function detectConflicts(newMemory: MemoryRecord, existingMemories: MemoryRecord[], contradictionThreshold = 0.85): MemoryRecord[] {
  // If the new memory has high similarity but different content, it might be a contradiction or update
  const conflicts: MemoryRecord[] = [];
  
  for (const existing of existingMemories) {
    // Only active memories can be in conflict
    if (existing.state !== 'active') continue;

    if (newMemory.vector && existing.vector) {
      const similarity = calculateCosineSimilarity(newMemory.vector, existing.vector);
      if (similarity >= contradictionThreshold && newMemory.content !== existing.content) {
        conflicts.push(existing);
      }
    }
  }
  return conflicts;
}

export function applySupersession(store: Map<string, MemoryRecord>, newMemoryId: string, supersededIds: string[]) {
  for (const id of supersededIds) {
    const memory = store.get(id);
    if (memory && memory.state === 'active') {
      memory.state = 'stale';
      if (!memory.provenance) memory.provenance = {};
      memory.provenance.superseded_by = newMemoryId;
    }
  }
}
