import type { MemoryRecord } from './types.js';

export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function isDuplicate(newMemory: MemoryRecord, existingMemories: MemoryRecord[], threshold = 0.95): boolean {
  for (const existing of existingMemories) {
    if (existing.content === newMemory.content) {
      return true;
    }
    if (newMemory.vector && existing.vector) {
      const similarity = calculateCosineSimilarity(newMemory.vector, existing.vector);
      if (similarity >= threshold) {
        return true;
      }
    }
  }
  return false;
}
