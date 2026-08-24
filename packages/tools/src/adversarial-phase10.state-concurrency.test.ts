import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from './registry.js';
import { StaticCapabilityPolicy } from '@harness/permissions';
import { EventBus } from '@harness/events';

test('Phase 10: Authorization TOCTOU - Capability revoked during authorization', async () => {
  const bus = new EventBus();
  
  // We need the emit to be async to force a microtask yield
  bus.onAny(async (event) => {
    // Delay slightly
    await new Promise(r => setTimeout(r, 10));
  });

  const registry = new ToolRegistry({ eventBus: bus });
  
  registry.register({
    name: 'test.tool',
    description: 'test',
    inputSchema: {},
    requiredCapabilities: ['fs.read'],
    execute: async () => 'success'
  });

  let policy = new StaticCapabilityPolicy(['fs.read']);
  registry.setPolicy(policy);

  // We start execution
  const execPromise = registry.execute('test.tool', {});

  // Immediately revoke the capability synchronously before the await resolves
  registry.setPolicy(new StaticCapabilityPolicy([])); // Empty grants

  await assert.rejects(
    execPromise,
    /PermissionDeniedError/,
    'Should fail if capability is revoked during the authorization yield'
  );
});

test('Phase 10: Concurrent Registry Mutation - Executing an unregistered tool', async () => {
  const bus = new EventBus();
  
  bus.onAny(async (event) => {
    await new Promise(r => setTimeout(r, 10));
  });

  const registry = new ToolRegistry({ eventBus: bus });
  
  registry.register({
    name: 'test.volatile',
    description: 'test',
    inputSchema: {},
    requiredCapabilities: [],
    execute: async () => 'success'
  });

  const execPromise = registry.execute('test.volatile', {});

  // Unregister during the authorization yield
  registry.unregister('test.volatile');

  await assert.rejects(
    execPromise,
    /replaced or unregistered/,
    'Should fail if tool is unregistered during the authorization yield'
  );
});

test('Phase 10: Concurrent Registry Mutation - Executing a replaced tool', async () => {
  const bus = new EventBus();
  
  bus.onAny(async (event) => {
    await new Promise(r => setTimeout(r, 10));
  });

  const registry = new ToolRegistry({ eventBus: bus });
  
  const originalTool = {
    name: 'test.replaceable',
    description: 'test',
    inputSchema: {},
    requiredCapabilities: [],
    execute: async () => 'original'
  };
  registry.register(originalTool);

  const execPromise = registry.execute('test.replaceable', {});

  // Replace during the authorization yield
  registry.replace('test.replaceable', {
    name: 'test.replaceable',
    description: 'test',
    inputSchema: {},
    requiredCapabilities: [],
    execute: async () => 'replaced'
  });

  await assert.rejects(
    execPromise,
    /replaced or unregistered/,
    'Should fail if tool is replaced during the authorization yield'
  );
});

import { Session } from '@harness/agent';
import { EventStore } from '@harness/events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('Phase 10: State Corruption - Session replay fails closed on invalid state', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-phase10-'));
  const store = new EventStore(tmpDir);
  const sessionId = 'test-session-1';

  // We write an invalid event sequence directly to the store
  await store.appendBatch([
    { sessionId, type: 'generation.started', payload: {} },
    { sessionId, type: 'generation.started', payload: {} } // Duplicate start! Invalid state!
  ]);

  // Replay should fail closed and not produce an unauthorized state
  await assert.rejects(
    Session.replay(sessionId, store),
    /generation.started without completing previous generation/,
    'Session should fail closed when replaying corrupt state'
  );
});

test('Phase 10: State Corruption - Tool completed without tool called', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-phase10-'));
  const store = new EventStore(tmpDir);
  const sessionId = 'test-session-2';

  await store.append({
    sessionId,
    type: 'tool.completed', 
    payload: { toolCallId: 'missing-id' },
  });

  await assert.rejects(
    Session.replay(sessionId, store),
    /tool.completed without tool.called/,
    'Session should fail closed when replaying corrupt tool state'
  );
});

test('Phase 10: Crash consistency - Unpersisted events do not corrupt replay', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-phase10-'));
  const store = new EventStore(tmpDir);
  const session = new Session({ id: 'crash-test', eventStore: store });

  session.startGeneration();
  
  // Wait for the event to persist
  await session.flushEvents();
  
  // Now we do a "crash" before flush:
  session.completeGeneration({ response: 'test' });
  
  // We do NOT wait for flushEvents. We create a new session (simulate restart)
  // Replay strictly validates whatever IS persisted.
  const replayedSession = await Session.replay('crash-test', store);
  assert.equal(replayedSession.id, 'crash-test');
});
