export type MemoryType = 'memory' | 'knowledge' | 'decision';
export type MemoryState = 'active' | 'stale' | 'expired';

export interface Provenance {
  source?: string;
  derived_from?: string[]; // IDs of knowledge/memory this was derived from
  based_on?: string[];     // IDs of information this decision was based on
  superseded_by?: string;  // ID of the memory that supersedes this
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  scope: string;
  provenance?: Provenance;
  timestamp: number;
  state: MemoryState;
  vector?: number[];
}

export interface MemoryResult extends Omit<MemoryRecord, 'vector'> {
  score: number;
}

export interface MemoryQuery {
  query: string;
  scope: string;
  topK?: number;
  vector?: number[];
  types?: MemoryType[];
}

export interface MemoryStore {
  store(record: MemoryRecord): Promise<void>;
  update(id: string, updates: Partial<MemoryRecord>): Promise<void>;
  retrieve(ids: string[]): Promise<MemoryRecord[]>;
  search(query: MemoryQuery): Promise<MemoryResult[]>;
  delete(id: string): Promise<void>;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
}
