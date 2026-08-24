import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { Session } from './session.js';
import { EventStore } from '../../events/src/event-store.js';

test('Phase 13: Recovery Determinism - Corrupted/Partial Writes', async () => {
  // Scenario: An I/O failure truncates an event during persistence.
  // Replay must deterministically recover the state up to the last valid event,
  // or reject the log entirely, but NEVER construct a phantom/partial state.
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-phase13-a-'));
  const store = new EventStore(tmpDir);
  const sessionId = 'test-corruption';
  
  const session = new Session({ id: sessionId, eventStore: store });
  session.startTurn();
  session.startToolCall({ toolCallId: '1', toolName: 'fs.read', input: {} });
  await session.flushEvents();
  
  // Corrupt the event log by appending half a JSON line
  const logFile = path.join(tmpDir, `${sessionId}.jsonl`);
  await fs.appendFile(logFile, '\n{"type":"tool.completed","payload":{"toolCallId":"1"'); // Truncated!
  
  // Replay should either ignore the truncated line safely or throw, but not enter a partial state
  try {
    const recovered = await Session.replay(sessionId, store);
    // If it ignores the truncated line, the tool call must remain active (uncompleted)
    // We can't access activeToolCalls directly, but we can verify it by trying to complete it
    assert.doesNotThrow(() => {
      recovered.completeToolCall({ toolCallId: '1', toolName: 'fs.read', result: 'foo' });
    });
  } catch (err: any) {
    // Or it strictly rejects the corrupted log, which is also safe.
    assert.match(err.message, /JSON/i);
  }
});

test('Phase 13: No Phantom Execution - Crash before execution', async () => {
  // Scenario: Authorization completes, event is emitted, but the worker crashes 
  // synchronously before execution.
  // Replay must NOT show the tool as executed.
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-phase13-b-'));
  const store = new EventStore(tmpDir);
  const sessionId = 'test-phantom-exec';
  
  const session = new Session({ id: sessionId, eventStore: store });
  session.startToolCall({ toolCallId: 'call_1', toolName: 'shell', input: 'echo 1' });
  
  // Simulate crash! We do NOT call completeToolCall.
  await session.flushEvents();
  
  // Replay
  const recovered = await Session.replay(sessionId, store);
  
  // We can successfully complete it now, proving it was pending (not phantom executed)
  assert.doesNotThrow(() => {
    recovered.completeToolCall({ toolCallId: 'call_1', toolName: 'shell', result: 'done' });
  });
});

test('Phase 13: No Duplicate Irreversible Execution - Crash after execute, before commit', async () => {
  // Scenario: Worker performs side effect, returns result, but process crashes 
  // exactly before EventStore persists the tool.completed event.
  // Replay must explicitly show the tool as pending, and NOT automatically replay the side effect.
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-phase13-c-'));
  
  // A mock EventStore that fails on tool.completed
  class FailingEventStore extends EventStore {
    async append(event: any): Promise<void> {
      if (event.type === 'tool.completed') {
        throw new Error('Disk Full / IO Failure');
      }
      return super.append(event);
    }
  }
  
  const store = new FailingEventStore(tmpDir);
  const sessionId = 'test-irreversible';
  
  const session = new Session({ id: sessionId, eventStore: store });
  session.startToolCall({ toolCallId: 'call_1', toolName: 'db.drop', input: {} });
  await session.flushEvents();
  
  // Worker executes side effect successfully...
  const result = 'dropped';
  
  // We try to commit, but it fails!
  session.completeToolCall({ toolCallId: 'call_1', toolName: 'db.drop', result });
  await session.flushEvents(); // The internal promise rejection is swallowed by logEvent to not crash the main thread.
  
  // Replay with normal store
  const normalStore = new EventStore(tmpDir);
  const recovered = await Session.replay(sessionId, normalStore);
  
  // The system must recognize it is still pending
  assert.doesNotThrow(() => {
    recovered.completeToolCall({ toolCallId: 'call_1', toolName: 'db.drop', result: 'manual-recovery' });
  });
});

test('Phase 13: Fail Closed - I/O failure during session logging', async () => {
  // Scenario: If session event logging fails (e.g. disk full), the session does not 
  // crash the active turn (degraded mode), but it must NOT grant authorizations that 
  // couldn't be persisted.
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-phase13-d-'));
  
  class DeadEventStore extends EventStore {
    async append(event: any): Promise<void> {
      throw new Error('EIO');
    }
  }
  const store = new DeadEventStore(tmpDir);
  const sessionId = 'test-degraded';
  
  const session = new Session({ id: sessionId, eventStore: store });
  
  // We can still operate the session in degraded mode
  assert.doesNotThrow(() => {
    session.startTurn();
    session.startToolCall({ toolCallId: '1', toolName: 'read', input: {} });
  });
  
  await session.flushEvents();
  
  // But replay from a dead store yields nothing (no phantom state)
  const recovered = await Session.replay(sessionId, store);
  assert.throws(() => {
    // Attempting to complete a tool that wasn't recorded as started should fail during replay
    // or if the recovered session is entirely empty, it will fail here:
    recovered.completeToolCall({ toolCallId: '1', toolName: 'read', result: 'foo' });
  }, /without tool.called/);
});
