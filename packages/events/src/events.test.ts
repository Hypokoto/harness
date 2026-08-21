import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EventBus } from './event-bus.js';
import { EventStore } from './event-store.js';
import { EventNotFoundError } from './errors.js';
import type { Event } from './types.js';

test('EventBus - subscribe, emit, once, wildcard, unsubscribe', async () => {
  const bus = new EventBus();
  const received: Event[] = [];
  const wildcardReceived: Event[] = [];

  const unsubOn = bus.on<string>('user:login', (event) => {
    received.push(event);
  });

  const unsubAny = bus.onAny((event) => {
    wildcardReceived.push(event);
  });

  const onceReceived: Event[] = [];
  bus.once<string>('user:login', (event) => {
    onceReceived.push(event);
  });

  assert.equal(bus.listenerCount('user:login'), 2);

  const event1: Event<string> = {
    id: 'evt-1',
    type: 'user:login',
    timestamp: 1000,
    payload: 'Alice',
  };

  await bus.emit(event1);

  assert.equal(received.length, 1);
  assert.equal(wildcardReceived.length, 1);
  assert.equal(onceReceived.length, 1);

  // Emit second event - once listener should not trigger again
  const event2: Event<string> = {
    id: 'evt-2',
    type: 'user:login',
    timestamp: 2000,
    payload: 'Bob',
  };

  await bus.emit(event2);

  assert.equal(received.length, 2);
  assert.equal(wildcardReceived.length, 2);
  assert.equal(onceReceived.length, 1);

  // Unsubscribe main listener
  unsubOn();
  assert.equal(bus.listenerCount('user:login'), 0);

  const event3: Event<string> = {
    id: 'evt-3',
    type: 'user:login',
    timestamp: 3000,
    payload: 'Charlie',
  };

  await bus.emit(event3);
  assert.equal(received.length, 2); // Unchanged
  assert.equal(wildcardReceived.length, 3); // Wildcard still received it

  unsubAny();
  assert.equal(bus.listenerCount(), 0);
});

test('EventStore - append, read, and filtering', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const filePath = path.join(tmpDir, 'events.jsonl');
  const store = new EventStore(filePath);

  const events: Event[] = [
    { id: '1', type: 'agent:start', timestamp: 100, payload: { name: 'AgentA' }, metadata: { env: 'test' } },
    { id: '2', type: 'tool:call', timestamp: 200, payload: { tool: 'search' }, metadata: { env: 'test' } },
    { id: '3', type: 'agent:end', timestamp: 300, payload: { status: 'success' }, metadata: { env: 'prod' } },
  ];

  await store.appendBatch(events);

  // Read all events
  const all = await store.read();
  assert.equal(all.length, 3);
  assert.equal(all[0].id, '1');
  assert.equal(all[2].id, '3');

  // Filter by types
  const agentEvents = await store.read({ types: ['agent:start', 'agent:end'] });
  assert.equal(agentEvents.length, 2);

  // Filter by timestamp range
  const rangeEvents = await store.read({ sinceTimestamp: 150, untilTimestamp: 250 });
  assert.equal(rangeEvents.length, 1);
  assert.equal(rangeEvents[0].id, '2');

  // Filter by metadata match
  const testEnvEvents = await store.read({ metadataMatch: { env: 'test' } });
  assert.equal(testEnvEvents.length, 2);

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('EventStore - replay, resume, and fork', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-events-test-'));
  const filePath = path.join(tmpDir, 'main.jsonl');
  const store = new EventStore(filePath);

  const events: Event[] = [
    { id: 'evt-1', type: 'task:created', timestamp: 10, payload: { task: 'task1' } },
    { id: 'evt-2', type: 'task:started', timestamp: 20, payload: { task: 'task1' } },
    { id: 'evt-3', type: 'task:completed', timestamp: 30, payload: { task: 'task1' } },
  ];

  await store.appendBatch(events);

  // Test replay
  const bus = new EventBus();
  const replayed: Event[] = [];
  bus.onAny((e) => {
    replayed.push(e);
  });

  const replayedCount = await store.replay(bus);
  assert.equal(replayedCount, 3);
  assert.equal(replayed.length, 3);

  // Test resume from event 1
  const busResume = new EventBus();
  const resumed: Event[] = [];
  busResume.onAny((e) => {
    resumed.push(e);
  });

  const resumeResult = await store.resume(busResume, 'evt-1');
  assert.equal(resumeResult.replayedCount, 2);
  assert.equal(resumed.length, 2);
  assert.equal(resumed[0].id, 'evt-2');
  assert.equal(resumed[1].id, 'evt-3');
  assert.equal(resumeResult.lastEventId, 'evt-3');

  // Test resume with missing ID throws EventNotFoundError
  await assert.rejects(
    async () => store.resume(busResume, 'non-existent-id'),
    EventNotFoundError,
  );

  // Test fork up to evt-2
  const forkPath = path.join(tmpDir, 'fork.jsonl');
  const forkedStore = await store.fork(forkPath, 'evt-2');

  const forkedEvents = await forkedStore.read();
  assert.equal(forkedEvents.length, 2);
  assert.equal(forkedEvents[0].id, 'evt-1');
  assert.equal(forkedEvents[1].id, 'evt-2');

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});
