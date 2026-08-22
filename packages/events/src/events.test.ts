import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  EventBus,
  EventBusError,
  EventCorruptedError,
  EventNotFoundError,
  EventStore,
  EventValidationError,
  SequenceError,
  replay,
  validateEventEnvelope,
  type EventEnvelope,
} from './index.js';

test('1. EventBus - sequential listener execution order and exception propagation', async () => {
  const bus = new EventBus();
  const order: number[] = [];

  bus.on('test:event', async () => {
    order.push(1);
  });

  bus.on('test:event', async () => {
    order.push(2);
    throw new Error('Listener 2 failed');
  });

  bus.on('test:event', async () => {
    order.push(3);
  });

  const envelope: EventEnvelope = {
    id: 'e1',
    sessionId: 's1',
    type: 'test:event',
    sequence: 0,
    timestamp: new Date().toISOString(),
    payload: {},
  };

  await assert.rejects(async () => bus.emit(envelope), /Listener 2 failed/);
  assert.deepEqual(order, [1, 2]); // Stopped after exception
});

test('2. EventBus - on, onAny, once, off, removeAllListeners, listenerCount', async () => {
  const bus = new EventBus();
  const received: string[] = [];

  const unsub1 = bus.on('evt', () => { received.push('on'); });
  const unsubAny = bus.onAny(() => { received.push('any'); });
  bus.once('evt', () => { received.push('once'); });

  assert.equal(bus.listenerCount('evt'), 2);
  assert.equal(bus.listenerCount(), 3);

  const env1: EventEnvelope = {
    id: '1',
    sessionId: 's1',
    type: 'evt',
    sequence: 0,
    timestamp: new Date().toISOString(),
    payload: null,
  };

  await bus.emit(env1);
  assert.deepEqual(received, ['on', 'once', 'any']);

  // once listener should have auto-removed
  received.length = 0;
  await bus.emit({ ...env1, sequence: 1 });
  assert.deepEqual(received, ['on', 'any']);

  unsub1();
  assert.equal(bus.listenerCount('evt'), 0);

  unsubAny();
  assert.equal(bus.listenerCount(), 0);

  bus.on('other', () => {});
  bus.removeAllListeners('other');
  assert.equal(bus.listenerCount('other'), 0);
});

test('3. EventEnvelope - validation of required fields throws EventValidationError', () => {
  assert.throws(() => validateEventEnvelope(null), EventValidationError);
  assert.throws(() => validateEventEnvelope({}), EventValidationError);
  assert.throws(
    () => validateEventEnvelope({ id: '', sessionId: 's', type: 't', sequence: 0, timestamp: '1' }),
    EventValidationError
  );
  assert.throws(
    () => validateEventEnvelope({ id: 'i', sessionId: '', type: 't', sequence: 0, timestamp: '1' }),
    EventValidationError
  );
  assert.throws(
    () => validateEventEnvelope({ id: 'i', sessionId: 's', type: '', sequence: 0, timestamp: '1' }),
    EventValidationError
  );
  assert.throws(
    () => validateEventEnvelope({ id: 'i', sessionId: 's', type: 't', sequence: -1, timestamp: '1' }),
    EventValidationError
  );
  assert.throws(
    () => validateEventEnvelope({ id: 'i', sessionId: 's', type: 't', sequence: 1.5, timestamp: '1' }),
    EventValidationError
  );

  const valid = validateEventEnvelope({
    id: 'id1',
    sessionId: 'sess1',
    type: 'type1',
    sequence: 0,
    timestamp: '2026-01-01T00:00:00Z',
    payload: { ok: true },
  });
  assert.equal(valid.id, 'id1');
  assert.equal(valid.sequence, 0);
});

test('4. EventStore - append event creates valid EventEnvelope starting at sequence 0', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const store = new EventStore(path.join(tmpDir, 'events.jsonl'));

  const appended = await store.append({
    type: 'user:action',
    payload: { action: 'click' },
  });

  assert.equal(appended.sequence, 0);
  assert.ok(appended.id);
  assert.ok(appended.timestamp);
  assert.equal(appended.sessionId, 'default');
  assert.equal(appended.type, 'user:action');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('5. EventStore - append event sequence increments monotonically', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const store = new EventStore(path.join(tmpDir, 'session1.jsonl'));

  const e0 = await store.append({ type: 'start', payload: {} });
  const e1 = await store.append({ type: 'step', payload: {} });
  const e2 = await store.append({ type: 'end', payload: {} });

  assert.equal(e0.sequence, 0);
  assert.equal(e1.sequence, 1);
  assert.equal(e2.sequence, 2);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('6. EventStore - sequence collision or gap throws SequenceError', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const store = new EventStore(path.join(tmpDir, 'events.jsonl'));

  await store.append({ type: 'e0', payload: {} }); // sequence 0

  // Gap: trying to append sequence 5
  await assert.rejects(
    async () => store.append({ type: 'e1', sequence: 5, payload: {} }),
    SequenceError
  );

  // Collision: trying to append sequence 0 again
  await assert.rejects(
    async () => store.append({ type: 'e1', sequence: 0, payload: {} }),
    SequenceError
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('7. EventStore - per-session JSONL storage layout (dir vs file mode)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));

  // Directory mode
  const dirStore = new EventStore(tmpDir);
  await dirStore.append({ sessionId: 'sessA', type: 'a', payload: {} });
  await dirStore.append({ sessionId: 'sessB', type: 'b', payload: {} });

  assert.equal(dirStore.getFilePath('sessA'), path.join(tmpDir, 'sessA.jsonl'));
  assert.equal(dirStore.getFilePath('sessB'), path.join(tmpDir, 'sessB.jsonl'));

  const fileAExists = await fs.stat(path.join(tmpDir, 'sessA.jsonl')).then(() => true).catch(() => false);
  const fileBExists = await fs.stat(path.join(tmpDir, 'sessB.jsonl')).then(() => true).catch(() => false);
  assert.ok(fileAExists);
  assert.ok(fileBExists);

  // File mode
  const filePath = path.join(tmpDir, 'single.jsonl');
  const fileStore = new EventStore(filePath);
  assert.equal(fileStore.getFilePath('sessA'), filePath);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('8. EventStore - per-session concurrency serialization', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const store = new EventStore(path.join(tmpDir, 'concurrent.jsonl'));

  // Append 50 events concurrently without awaiting each
  const promises = Array.from({ length: 50 }, (_, i) =>
    store.append({ type: 'concurrent', payload: { index: i } })
  );

  const results = await Promise.all(promises);
  assert.equal(results.length, 50);

  const stored = await store.read();
  assert.equal(stored.length, 50);

  // Verify sequences 0..49 strictly preserved with no duplicates or collisions
  const seqs = stored.map((e) => e.sequence);
  assert.deepEqual(seqs, Array.from({ length: 50 }, (_, i) => i));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('9. EventStore - corrupted JSONL lines throw EventCorruptedError with line details', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));

  const validLine1 = JSON.stringify({
    id: '00000000-0000-0000-0000-000000000001',
    sessionId: 'default',
    type: 'test.event',
    sequence: 0,
    timestamp: new Date().toISOString(),
    payload: {},
  });
  const validLine2 = JSON.stringify({
    id: '00000000-0000-0000-0000-000000000002',
    sessionId: 'default',
    type: 'test.event',
    sequence: 1,
    timestamp: new Date().toISOString(),
    payload: {},
  });

  // Test invalid JSON line
  const invalidJsonFile = path.join(tmpDir, 'invalid-json.jsonl');
  await fs.writeFile(invalidJsonFile, `${validLine1}\nNOT_VALID_JSON\n`, 'utf-8');
  const store1 = new EventStore(invalidJsonFile);

  try {
    await store1.read();
    assert.fail('Expected EventCorruptedError for invalid JSON');
  } catch (err) {
    assert.ok(err instanceof EventCorruptedError);
    assert.equal(err.lineNumber, 2);
    assert.equal(err.filePath, invalidJsonFile);
  }

  // Test unexpected empty line
  const emptyLineFile = path.join(tmpDir, 'empty-line.jsonl');
  await fs.writeFile(emptyLineFile, `${validLine1}\n\n${validLine2}\n`, 'utf-8');
  const store2 = new EventStore(emptyLineFile);

  try {
    await store2.read();
    assert.fail('Expected EventCorruptedError for empty line');
  } catch (err) {
    assert.ok(err instanceof EventCorruptedError);
    assert.equal(err.lineNumber, 2);
  }

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('10. EventStore - streaming and reading events with filtering', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const store = new EventStore(path.join(tmpDir, 'filter.jsonl'));

  await store.appendBatch([
    { id: 'e1', type: 'login', payload: { user: 'a' }, metadata: { region: 'us' } },
    { id: 'e2', type: 'click', payload: { btn: 'x' }, metadata: { region: 'eu' } },
    { id: 'e3', type: 'logout', payload: { user: 'a' }, metadata: { region: 'us' } },
    { id: 'e4', type: 'login', payload: { user: 'b' }, metadata: { region: 'us' } },
  ]);

  // Filter by types
  const logins = await store.read({ types: ['login'] });
  assert.equal(logins.length, 2);

  // Filter by sequence range
  const seqRange = await store.read({ sinceSequence: 1, untilSequence: 2 });
  assert.equal(seqRange.length, 2);
  assert.equal(seqRange[0].id, 'e2');
  assert.equal(seqRange[1].id, 'e3');

  // Filter by metadata match
  const usEvents = await store.read({ metadataMatch: { region: 'us' } });
  assert.equal(usEvents.length, 3);

  // Filter with limit
  const limited = await store.read({ limit: 2 });
  assert.equal(limited.length, 2);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('11. EventStore - replay deterministically reconstructs state using reducer', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const store = new EventStore(path.join(tmpDir, 'replay.jsonl'));

  await store.appendBatch([
    { type: 'counter:add', payload: 5 },
    { type: 'counter:sub', payload: 2 },
    { type: 'counter:add', payload: 10 },
  ]);

  type State = { count: number };
  const initialState: State = { count: 0 };

  const finalState = await store.replay('default', initialState, (state, event) => {
    if (event.type === 'counter:add') return { count: state.count + (event.payload as number) };
    if (event.type === 'counter:sub') return { count: state.count - (event.payload as number) };
    return state;
  });

  assert.equal(finalState.count, 13);

  // Standalone replay utility test
  const events = await store.read();
  const standaloneState = await replay(events, 0, (count, event) => {
    return event.type === 'counter:add' ? count + (event.payload as number) : count - (event.payload as number);
  });
  assert.equal(standaloneState, 13);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('12. EventStore - replay to EventBus', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const store = new EventStore(path.join(tmpDir, 'bus-replay.jsonl'));

  await store.appendBatch([
    { type: 'event:one', payload: 1 },
    { type: 'event:two', payload: 2 },
  ]);

  const bus = new EventBus();
  const received: EventEnvelope[] = [];
  bus.onAny((e) => { received.push(e); });

  const count = await store.replay(bus);
  assert.equal(count, 2);
  assert.equal(received.length, 2);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('13. EventStore - resume streams events after lastEventId', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const store = new EventStore(path.join(tmpDir, 'resume.jsonl'));

  await store.appendBatch([
    { id: 'id-1', type: 't1', payload: {} },
    { id: 'id-2', type: 't2', payload: {} },
    { id: 'id-3', type: 't3', payload: {} },
  ]);

  const bus = new EventBus();
  const resumed: EventEnvelope[] = [];
  bus.onAny((e) => { resumed.push(e); });

  const result = await store.resume(bus, 'id-1');
  assert.equal(result.replayedCount, 2);
  assert.equal(resumed.length, 2);
  assert.equal(resumed[0].id, 'id-2');
  assert.equal(resumed[1].id, 'id-3');
  assert.equal(result.lastEventId, 'id-3');

  // Resume with non-existent ID throws EventNotFoundError
  await assert.rejects(
    async () => store.resume(bus, 'non-existent-id'),
    EventNotFoundError
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('14. EventStore - fork creates a new store copy up to specified upToEventId', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const sourcePath = path.join(tmpDir, 'source.jsonl');
  const store = new EventStore(sourcePath);

  await store.appendBatch([
    { id: 'step-1', type: 'init', payload: {} },
    { id: 'step-2', type: 'process', payload: {} },
    { id: 'step-3', type: 'complete', payload: {} },
  ]);

  const forkPath = path.join(tmpDir, 'forked.jsonl');
  const forkedStore = await store.fork(forkPath, 'step-2');

  const forkedEvents = await forkedStore.read();
  assert.equal(forkedEvents.length, 2);
  assert.equal(forkedEvents[0].id, 'step-1');
  assert.equal(forkedEvents[1].id, 'step-2');

  // Fork with missing upToEventId throws EventNotFoundError
  await assert.rejects(
    async () => store.fork(path.join(tmpDir, 'invalid.jsonl'), 'missing-id'),
    EventNotFoundError
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});
