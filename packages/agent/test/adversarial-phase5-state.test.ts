import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop, Session, FakeModel, AgentExecutionError } from '../src/index.js';
import { ToolRegistry } from '@harness/tools';
import { EventStore } from '@harness/events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import crypto from 'node:crypto';

async function createTempStore() {
  const dir = join(tmpdir(), `harness-test-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return { dir, store: new EventStore(dir) };
}

test('ATTACK 1 — EMPTY SESSION', async () => {
  const { store, dir } = await createTempStore();
  const session = new Session({ eventStore: store });
  await session.flushEvents();
  
  const replayed = await Session.replay(session.id, store);
  assert.equal(replayed.getMessages().length, 0);
  assert.ok(replayed.id);
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 2 — MULTI-TURN SESSION', async () => {
  const { store, dir } = await createTempStore();
  const fakeModel = new FakeModel({ responses: ['turn 1', 'turn 2', 'turn 3'] });
  const loop = new AgentLoop({ model: fakeModel });
  const session = new Session({ eventStore: store });
  
  session.addMessage({ role: 'user', content: 'hello 1' });
  await loop.run(session, { maxSteps: 1 });
  
  session.addMessage({ role: 'user', content: 'hello 2' });
  await loop.run(session, { maxSteps: 1 });
  
  await session.flushEvents();
  const msgs = session.getMessages();
  assert.equal(msgs.length, 4);

  const replayed = await Session.replay(session.id, store);
  assert.deepEqual(replayed.getMessages(), msgs);
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 3 — TOOL LOOP', async () => {
  const { store, dir } = await createTempStore();
  let executed = false;
  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    name: 'test-tool', description: 'desc',
    async execute() { executed = true; return 'done'; }
  });

  const fakeModel = new FakeModel({
    responses: [
      [{ type: 'tool_use', id: 'call_1', name: 'test-tool', input: {} }],
      'all done'
    ]
  });
  
  const loop = new AgentLoop({ model: fakeModel, toolRegistry });
  const session = new Session({ eventStore: store });
  session.addMessage({ role: 'user', content: 'run tool' });
  await loop.run(session);
  
  assert.ok(executed);
  await session.flushEvents();
  const replayed = await Session.replay(session.id, store);
  assert.equal(replayed.getMessages().length, 4);
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 4 — TOOL FAILURE LOOP', async () => {
  const { store, dir } = await createTempStore();
  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    name: 'fail-tool', description: 'desc',
    async execute() { throw new Error('tool crashed'); }
  });

  const fakeModel = new FakeModel({
    responses: [
      [{ type: 'tool_use', id: 'call_2', name: 'fail-tool', input: {} }],
      'recovery done'
    ]
  });
  
  const loop = new AgentLoop({ model: fakeModel, toolRegistry });
  const session = new Session({ eventStore: store });
  session.addMessage({ role: 'user', content: 'run tool' });
  await loop.run(session);
  
  await session.flushEvents();
  const replayed = await Session.replay(session.id, store);
  const msgs = replayed.getMessages();
  assert.equal(msgs.length, 4);
  const toolResult = msgs[2].content as any[];
  assert.ok(toolResult[0].isError);
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 7 — ABORT BEFORE MODEL', async () => {
  const loop = new AgentLoop({ model: new FakeModel({ responses: ['done'] }) });
  const session = new Session();
  const ac = new AbortController();
  ac.abort();
  
  await assert.rejects(loop.run(session, { signal: ac.signal }), /aborted/);
});

test('ATTACK 9 — ABORT DURING TOOL', async () => {
  const { store, dir } = await createTempStore();
  const ac = new AbortController();
  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    name: 'slow-tool', description: 'desc',
    async execute(input, ctx) { 
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('done'), 1000);
        ctx.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('AbortError'));
        });
      });
    }
  });

  const fakeModel = new FakeModel({
    responses: [
      [{ type: 'tool_use', id: 'call_3', name: 'slow-tool', input: {} }],
      'done'
    ]
  });
  
  const loop = new AgentLoop({ model: fakeModel, toolRegistry });
  const session = new Session({ eventStore: store });
  session.addMessage({ role: 'user', content: 'run tool' });
  
  const p = loop.run(session, { signal: ac.signal });
  // Abort after small delay so tool starts
  setTimeout(() => ac.abort(), 10);
  
  await assert.rejects(p, /aborted/);
  await session.flushEvents();
  
  const replayed = await Session.replay(session.id, store);
  // Replay should succeed without error since generation/tool were aborted properly
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 11 — DOUBLE EXECUTION (Concurrency)', async () => {
  const fakeModel = new FakeModel({
    responses: [
      async () => {
        await new Promise(r => setTimeout(r, 10));
        return 'done';
      }
    ]
  });
  const loop = new AgentLoop({ model: fakeModel });
  const session = new Session();
  
  session.addMessage({ role: 'user', content: 'concurrent' });
  
  const p1 = loop.run(session);
  const p2 = loop.run(session);
  
  let rejected = false;
  try {
    await Promise.all([p1, p2]);
  } catch (err) {
    if (err instanceof Error && (err.message.includes('concurrent') || err.message.includes('processing a request'))) {
      rejected = true;
    } else {
      throw err;
    }
  }
  
  assert.ok(rejected, 'Must reject concurrent execution');
});

test('ATTACK 17 — EVENT ORDER CORRUPTION (tool.completed without tool.call)', async () => {
  const { store, dir } = await createTempStore();
  const sessionId = 'session_bad';
  
  await store.appendBatch([
    { type: 'session_created', sessionId, payload: {} },
    { type: 'generation.started', sessionId, payload: {} },
    { type: 'tool.completed', sessionId, payload: { toolCallId: '123' } } // No tool.called!
  ]);

  await assert.rejects(Session.replay(sessionId, store), /without tool.called/);
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 18 — DUPLICATE EVENTS', async () => {
  const { store, dir } = await createTempStore();
  const sessionId = 'session_dup';
  
  await store.appendBatch([
    { type: 'session_created', sessionId, payload: {} },
    { type: 'generation.started', sessionId, payload: {} },
    { type: 'generation.started', sessionId, payload: {} }, // DUPLICATE
  ]);

  await assert.rejects(Session.replay(sessionId, store), /without completing/);
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 20 — UNKNOWN EVENTS', async () => {
  const { store, dir } = await createTempStore();
  const sessionId = 'session_unknown';
  
  await store.appendBatch([
    { type: 'session_created', sessionId, payload: {} },
    { type: 'completely_unknown_event', sessionId, payload: {} }, 
  ]);

  await assert.rejects(Session.replay(sessionId, store), /Unknown event type/);
  await rm(dir, { recursive: true, force: true });
});

test('ATTACK 26 — SIDE-EFFECT DUPLICATION', async () => {
  const { store, dir } = await createTempStore();
  let count = 0;
  const toolRegistry = new ToolRegistry();
  toolRegistry.register({
    name: 'counter', description: 'desc',
    async execute() { count++; return count; }
  });

  const fakeModel = new FakeModel({
    responses: [
      [{ type: 'tool_use', id: 'call_26', name: 'counter', input: {} }],
      'done'
    ]
  });
  
  const loop = new AgentLoop({ model: fakeModel, toolRegistry });
  const session = new Session({ eventStore: store });
  session.addMessage({ role: 'user', content: 'run tool' });
  await loop.run(session);
  
  assert.equal(count, 1);
  await session.flushEvents();
  
  // Replay
  const replayed = await Session.replay(session.id, store);
  const loop2 = new AgentLoop({ model: new FakeModel({ responses: ['done2'] }), toolRegistry });
  
  // Did NOT re-execute tool on replay
  assert.equal(count, 1);
  await rm(dir, { recursive: true, force: true });
});
