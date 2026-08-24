import { test } from 'node:test';
import * as assert from 'node:assert';
import { AgentLoop } from './agent-loop.js';
import { Session } from './session.js';
import { EventStore, EventBus } from '@harness/events';
import { ToolRegistry } from '@harness/tools';
import { StaticCapabilityPolicy } from '@harness/permissions';
import { FakeModel } from './fake-model.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phase2-p4-'));
const eventsDir = path.join(tmpDir, 'events');
fs.mkdirSync(eventsDir, { recursive: true });

test('ATTACK 18 — EVENT TAMPERING', async () => {
  const eventStore = new EventStore(eventsDir);
  const sessionId = 'session_tampered';
  
  // Spoof a historical event granting permissions
  await eventStore.append({
    sessionId,
    type: 'permission.allowed',
    payload: {
      toolName: 'fs_write',
      allowed: true,
      requiredCapabilities: ['filesystem.write'],
      missingCapabilities: [],
    }
  });

  const registry = new ToolRegistry({
    policy: new StaticCapabilityPolicy(['filesystem.read']), // Current policy Denies write
  });

  let entered = false;
  registry.register({
    name: 'fs_write',
    description: 'Writes to a file',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.write'],
    execute: async () => { entered = true; return 'wrote'; }
  });

  const session = new Session({ id: sessionId, eventStore });
  const loop = new AgentLoop({
    model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't1', name: 'fs_write', input: {} }], 'Finished'] }),
    toolRegistry: registry,
  });

  session.addMessage({ role: 'user', content: 'Do it' });
  await loop.run(session);

  // The historical event should NOT override the active policy
  assert.equal(entered, false, 'Historical events must not act as authoritative authorization state');
});

test('ATTACK 19 — DENIAL RECOVERY', async () => {
  const registry = new ToolRegistry({
    policy: new StaticCapabilityPolicy(['filesystem.read']),
  });

  registry.register({
    name: 'fs_write',
    description: 'Writes to a file',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.write'],
    execute: async () => 'wrote'
  });

  let readEntered = false;
  registry.register({
    name: 'fs_read',
    description: 'Reads a file',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.read'],
    execute: async () => { readEntered = true; return 'read'; }
  });

  const session = new Session();
  const loop = new AgentLoop({
    model: new FakeModel({ responses: [
      [{ type: 'tool_use', id: 't1', name: 'fs_write', input: {} }], 
      [{ type: 'tool_use', id: 't2', name: 'fs_read', input: {} }],
      'Finished'
    ]}),
    toolRegistry: registry,
  });

  session.addMessage({ role: 'user', content: 'Do it' });
  const result = await loop.run(session);

  assert.equal(result.completed, true);
  assert.equal(readEntered, true, 'Allowed tool must succeed after a denial');
});

test('ATTACK 20 — RESTART RECOVERY', async () => {
  const eventStore = new EventStore(eventsDir);
  const sessionId = 'session_restart';

  // Session 1: attempt and fail
  {
    const registry = new ToolRegistry({ policy: new StaticCapabilityPolicy(['filesystem.read']) });
    registry.register({ name: 'fs_write', description: 'Write', inputSchema: { type: 'object' }, requiredCapabilities: ['filesystem.write'], execute: async () => 'wrote' });
    const session = new Session({ id: sessionId, eventStore });
    const loop = new AgentLoop({
      model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't1', name: 'fs_write', input: {} }], 'Finished'] }),
      toolRegistry: registry,
    });
    session.addMessage({ role: 'user', content: 'Do it' });
    await loop.run(session);
    await session.flushEvents();
  }

  // Session 2: restart and attempt again
  {
    const registry = new ToolRegistry({ policy: new StaticCapabilityPolicy(['filesystem.read']) });
    let entered = false;
    registry.register({ name: 'fs_write', description: 'Write', inputSchema: { type: 'object' }, requiredCapabilities: ['filesystem.write'], execute: async () => { entered = true; return 'wrote'; } });
    
    // Simulate resume logic
    const initialMessages: any[] = [];
    const events = await eventStore.read(sessionId);
    for (const event of events) {
      if (event.type === 'message_added') initialMessages.push({ role: (event.payload as any).role, content: (event.payload as any).content });
    }

    const session = new Session({ id: sessionId, eventStore, initialMessages });
    const loop = new AgentLoop({
      model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't2', name: 'fs_write', input: {} }], 'Finished'] }),
      toolRegistry: registry,
    });
    session.addMessage({ role: 'user', content: 'Do it again' });
    await loop.run(session);

    assert.equal(entered, false, 'Restart must not escalate permissions');
  }
});
