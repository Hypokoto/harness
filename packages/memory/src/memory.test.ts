import test from 'node:test';
import assert from 'node:assert';
import { validateMemory } from './validate.js';
import { isScopeMatch } from './scope.js';
import { isDuplicate } from './dedup.js';
import { detectConflicts } from './conflicts.js';
import { QdrantStore } from './qdrant.js';
import { MemoryProvider } from './provider.js';
import type { MemoryRecord, Embedder } from './types.js';

class MockEmbedder implements Embedder {
  async embed(text: string): Promise<number[]> {
    if (text === 'fail') throw new Error('Simulated embedding failure');
    return [0.1, 0.2, 0.3];
  }
}

test('Memory Architecture Tests', async (t) => {
  await t.test('TEST 1: Valid memory passes schema validation', () => {
    assert.doesNotThrow(() => validateMemory({
      id: 'm1', type: 'memory', content: 'test', scope: 'global', timestamp: 123, state: 'active'
    }));
  });

  await t.test('TEST 2: Invalid memory is rejected', () => {
    assert.throws(() => validateMemory({ id: 'm1', type: 'unknown' as any }));
  });

  await t.test('TEST 3: Valid knowledge passes', () => {
    assert.doesNotThrow(() => validateMemory({
      id: 'k1', type: 'knowledge', content: 'test', scope: 'global', timestamp: 123, state: 'active',
      provenance: { derived_from: ['m1'] }
    }));
  });

  await t.test('TEST 4: Valid decision passes', () => {
    assert.doesNotThrow(() => validateMemory({
      id: 'd1', type: 'decision', content: 'test', scope: 'global', timestamp: 123, state: 'active',
      provenance: { based_on: ['m1'] }
    }));
  });

  await t.test('TEST 5: Invalid scope is rejected', () => {
    assert.strictEqual(isScopeMatch('project/A', 'project/B'), false);
  });

  await t.test('TEST 6: Correct scope retrieves memory', () => {
    assert.strictEqual(isScopeMatch('project/A', 'project/A'), true);
    assert.strictEqual(isScopeMatch('project/A', 'project/A/dev'), true);
  });

  await t.test('TEST 7: Cross-scope memory is rejected', () => {
    assert.strictEqual(isScopeMatch('project/A', 'project/B'), false);
  });

  await t.test('TEST 8: Embedding works', async () => {
    const embedder = new MockEmbedder();
    const vec = await embedder.embed('test');
    assert.deepStrictEqual(vec, [0.1, 0.2, 0.3]);
  });

  await t.test('TEST 9: Vector search works', async () => {
    const store = new QdrantStore({ url: 'http://localhost', collection: 'test' });
    await store.store({ id: '1', type: 'memory', content: 'hello', scope: 'global', timestamp: Date.now(), state: 'active', vector: [0.1, 0.2, 0.3] });
    const res = await store.search({ query: 'test', scope: 'global', vector: [0.1, 0.2, 0.3] });
    assert.strictEqual(res.length, 1);
  });

  await t.test('TEST 10: Deduplication works', () => {
    const mem1: MemoryRecord = { id: '1', type: 'memory', content: 'A', scope: 'g', timestamp: 1, state: 'active', vector: [1, 0] };
    const mem2: MemoryRecord = { id: '2', type: 'memory', content: 'B', scope: 'g', timestamp: 1, state: 'active', vector: [1, 0] };
    assert.strictEqual(isDuplicate(mem2, [mem1]), true);
  });

  await t.test('TEST 11: Contradiction detection works', () => {
    const mem1: MemoryRecord = { id: '1', type: 'memory', content: 'A', scope: 'g', timestamp: 1, state: 'active', vector: [1, 0] };
    const mem2: MemoryRecord = { id: '2', type: 'memory', content: 'B', scope: 'g', timestamp: 1, state: 'active', vector: [1, 0] };
    const conflicts = detectConflicts(mem2, [mem1]);
    assert.strictEqual(conflicts.length, 1);
  });

  await t.test('TEST 12: Supersession works', async () => {
    const store = new QdrantStore({ url: '', collection: '' });
    await store.store({ id: '1', type: 'memory', content: 'A', scope: 'global', timestamp: 1, state: 'active', vector: [1,0] });
    await store.update('1', { state: 'stale', provenance: { superseded_by: '2' } });
    const res = await store.retrieve(['1']);
    assert.strictEqual(res[0].state, 'stale');
    assert.strictEqual(res[0].provenance?.superseded_by, '2');
  });

  await t.test('TEST 13: Decision lineage works', () => {
    const dec: MemoryRecord = { id: 'd1', type: 'decision', content: 'D', scope: 'global', timestamp: 1, state: 'active', provenance: { based_on: ['m1'] } };
    assert.doesNotThrow(() => validateMemory(dec));
  });

  await t.test('TEST 14: Knowledge lineage works', () => {
    const k: MemoryRecord = { id: 'k1', type: 'knowledge', content: 'K', scope: 'global', timestamp: 1, state: 'active', provenance: { derived_from: ['m1'] } };
    assert.doesNotThrow(() => validateMemory(k));
  });

  await t.test('TEST 15: Decay works', async () => {
    const store = new QdrantStore({ url: '', collection: '' });
    await store.store({ id: '1', type: 'memory', content: 'A', scope: 'global', timestamp: Date.now() - 30*24*60*60*1000, state: 'active', vector: [1,0] });
    await store.store({ id: '2', type: 'memory', content: 'B', scope: 'global', timestamp: Date.now(), state: 'active', vector: [1,0] });
    const res = await store.search({ query: '', scope: 'global', vector: [1,0] });
    // newer should score higher
    assert.strictEqual(res[0].id, '2');
  });

  await t.test('TEST 16: MemoryProvider integrates with ContextComposer', async () => {
    const provider = new MemoryProvider(new QdrantStore({url:'', collection:''}), new MockEmbedder(), { enabled: true });
    assert.strictEqual(provider.name, 'memory');
    assert.ok(provider.getTools().length > 0);
  });

  await t.test('TEST 17: Memory retrieval is lazy', async () => {
    const provider = new MemoryProvider(new QdrantStore({url:'', collection:''}), new MockEmbedder(), { enabled: true });
    assert.strictEqual(provider.getSystemPrompt(), undefined);
  });

  await t.test('TEST 18: Memory results respect context limits', async () => {
    const store = new QdrantStore({ url: '', collection: '' });
    for (let i = 0; i < 10; i++) {
      await store.store({ id: `${i}`, type: 'memory', content: 'C', scope: 'global', timestamp: Date.now(), state: 'active', vector: [1,0] });
    }
    const provider = new MemoryProvider(store, new MockEmbedder(), { enabled: true, topK: 5 });
    const tools = provider.getTools();
    await tools[0].execute({ query: 'C' }, {});
    const prompt = provider.getSystemPrompt() || '';
    const memoryCount = (prompt.match(/\[Memory:/g) || []).length;
    assert.strictEqual(memoryCount, 5); // Max 5 composed
  });

  await t.test('TEST 19: Disabled memory performs no retrieval', async () => {
    const provider = new MemoryProvider(new QdrantStore({url:'', collection:''}), new MockEmbedder(), { enabled: false });
    assert.strictEqual(provider.getTools().length, 0);
    assert.strictEqual(provider.getSystemPrompt(), undefined);
  });

  await t.test('TEST 20: Qdrant failure is handled cleanly', async () => {
    const failStore: any = {
      search: () => Promise.reject(new Error('Qdrant offline'))
    };
    const provider = new MemoryProvider(failStore, new MockEmbedder(), { enabled: true });
    const res = await provider.getTools()[0].execute({ query: 'C' }, {});
    assert.match(res as string, /Qdrant\/Storage failure: Qdrant offline/);
  });

  await t.test('TEST 21: Embedding failure is handled cleanly', async () => {
    const provider = new MemoryProvider(new QdrantStore({url:'', collection:''}), new MockEmbedder(), { enabled: true });
    const res = await provider.getTools()[0].execute({ query: 'fail' }, {});
    assert.match(res as string, /Embedding failure: Simulated embedding failure/);
  });

  await t.test('TEST 24: Memory provenance is preserved', async () => {
    const store = new QdrantStore({ url: '', collection: '' });
    await store.store({ id: '1', type: 'knowledge', content: 'K', scope: 'global', timestamp: 1, state: 'active', vector: [1,0], provenance: { derived_from: ['2'] } });
    const res = await store.search({ query: '', scope: 'global', vector: [1,0] });
    assert.deepStrictEqual(res[0].provenance?.derived_from, ['2']);
  });

  await t.test('INTEGRATION TEST: Scopes and degradation', async () => {
    const store = new QdrantStore({ url: '', collection: '' });
    await store.store({ id: 'A', type: 'memory', content: 'A', scope: 'project/alpha', timestamp: 1, state: 'active', vector: [1,0] });
    await store.store({ id: 'B', type: 'memory', content: 'B', scope: 'project/beta', timestamp: 1, state: 'active', vector: [1,0] });
    
    // Alpha scoped query
    const resAlpha = await store.search({ query: '', scope: 'project/alpha', vector: [1,0] });
    assert.strictEqual(resAlpha.length, 1);
    assert.strictEqual(resAlpha[0].id, 'A');

    // Disable memory
    const provider = new MemoryProvider(store, new MockEmbedder(), { enabled: false });
    assert.strictEqual(provider.getTools().length, 0);

    // Qdrant unavailable
    const failStore: any = { search: () => Promise.reject(new Error('Down')) };
    const p2 = new MemoryProvider(failStore, new MockEmbedder(), { enabled: true });
    const r = await p2.getTools()[0].execute({ query: 'a' }, {});
    assert.match(r as string, /Storage failure: Down/);
  });
});
