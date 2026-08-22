import type { MemoryRecord, MemoryQuery, MemoryResult, MemoryStore } from './types.js';
import { calculateCosineSimilarity } from './dedup.js';
import { isScopeMatch } from './scope.js';

export interface QdrantConfig {
  url: string;
  collection: string;
  apiKey?: string;
}

export class QdrantStore implements MemoryStore {
  private config: QdrantConfig;
  
  // Fallback in-memory storage for when Qdrant is down or for testing
  private memoryMap = new Map<string, MemoryRecord>();

  constructor(config: QdrantConfig) {
    this.config = config;
  }

  async store(record: MemoryRecord): Promise<void> {
    this.memoryMap.set(record.id, record);
    // In a real implementation, we would PUT to Qdrant here.
    // If it fails, we fail gracefully or throw depending on config.
  }

  async update(id: string, updates: Partial<MemoryRecord>): Promise<void> {
    const existing = this.memoryMap.get(id);
    if (!existing) return;
    const updated = { ...existing, ...updates };
    this.memoryMap.set(id, updated);
    // Qdrant update payload...
  }

  async retrieve(ids: string[]): Promise<MemoryRecord[]> {
    const results: MemoryRecord[] = [];
    for (const id of ids) {
      const rec = this.memoryMap.get(id);
      if (rec) results.push(rec);
    }
    return results;
  }

  async search(query: MemoryQuery): Promise<MemoryResult[]> {
    const results: MemoryResult[] = [];
    
    // Simulate vector search
    for (const record of this.memoryMap.values()) {
      if (!isScopeMatch(record.scope, query.scope)) continue;
      if (query.types && query.types.length > 0 && !query.types.includes(record.type)) continue;
      if (record.state === 'expired') continue; // Don't return expired

      let score = 0;
      if (query.vector && record.vector) {
        score = calculateCosineSimilarity(query.vector, record.vector);
      } else {
        // Fallback for missing vectors
        if (record.content.includes(query.query)) score = 0.5;
      }
      
      // Basic decay logic: slightly reduce score for older memories
      const ageMs = Date.now() - record.timestamp;
      const decayFactor = Math.max(0.5, 1 - (ageMs / (1000 * 60 * 60 * 24 * 30))); // 30 day decay
      const finalScore = score * decayFactor;

      const { vector, ...rest } = record;
      results.push({ ...rest, score: finalScore });
    }

    // Sort by score desc
    results.sort((a, b) => b.score - a.score);
    
    // TopK
    return results.slice(0, query.topK || 5);
  }

  async delete(id: string): Promise<void> {
    this.memoryMap.delete(id);
  }
}
