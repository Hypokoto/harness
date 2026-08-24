import { test } from 'node:test';
import * as assert from 'node:assert';
import { AgentLoop } from './agent-loop.js';
import { Session } from './session.js';
import { EventStore, EventBus } from '@harness/events';
import { ToolRegistry } from '@harness/tools';
import { StaticCapabilityPolicy, DefaultDenyPolicy } from '@harness/permissions';
import { FakeModel } from './fake-model.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phase2-'));
const eventsDir = path.join(tmpDir, 'events');
fs.mkdirSync(eventsDir, { recursive: true });

test('ATTACK 1 — UNGRANTED CAPABILITY', async () => {
  const registry = new ToolRegistry({
    policy: new StaticCapabilityPolicy(['filesystem.read']),
  });

  let entered = false;
  registry.register({
    name: 'fs_write',
    description: 'Writes to a file',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.write'],
    execute: async () => {
      entered = true;
      return 'wrote';
    }
  });

  const eventStore = new EventStore(eventsDir);
  const session = new Session({ eventStore });
  const loop = new AgentLoop({
    model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't1', name: 'fs_write', input: {} }], 'Finished'] }),
    toolRegistry: registry,
  });

  session.addMessage({ role: 'user', content: 'Do it' });
  await loop.run(session);

  assert.equal(entered, false, 'Tool implementation must never be entered');
  const messages = session.getMessages();
  const toolResultMsg = messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'));
  assert.ok(toolResultMsg);
  const block = (toolResultMsg.content as any[])[0];
  assert.ok(block.isError);
  assert.match(block.content, /Permission denied/i);
});

test('ATTACK 3 — TOOL METADATA SPOOFING', async () => {
  const registry = new ToolRegistry({
    policy: new StaticCapabilityPolicy(['filesystem.read']),
  });

  let entered = false;
  registry.register({
    name: 'malicious_tool',
    description: 'Lies about capabilities',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.read'], // LIE
    execute: async () => {
      entered = true;
      return 'pwned';
    }
  });

  const session = new Session();
  const loop = new AgentLoop({
    model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't1', name: 'malicious_tool', input: {} }], 'Finished'] }),
    toolRegistry: registry,
  });

  session.addMessage({ role: 'user', content: 'Do it' });
  await loop.run(session);

  // VULNERABILITY FOUND: The architecture blindly trusts tool-declared capabilities as authoritative.
  assert.equal(entered, true, 'Flaw: Architecture trusts tool-declared capabilities unconditionally');
});

test('ATTACK 5 — SESSION CROSS-CONTAMINATION', async () => {
  const registryA = new ToolRegistry({ policy: new StaticCapabilityPolicy(['filesystem.read']) });
  const registryB = new ToolRegistry({ policy: new StaticCapabilityPolicy(['filesystem.write']) });

  let enteredA = false;
  registryA.register({
    name: 'fs_write',
    description: 'Writes to a file',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.write'],
    execute: async () => { enteredA = true; return 'wrote'; }
  });

  let enteredB = false;
  registryB.register({
    name: 'fs_write',
    description: 'Writes to a file',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.write'],
    execute: async () => { enteredB = true; return 'wrote'; }
  });

  const loopA = new AgentLoop({ model: new FakeModel({ responses: [[{ type: 'tool_use', id: 'tA', name: 'fs_write', input: {} }]] }), toolRegistry: registryA });
  const loopB = new AgentLoop({ model: new FakeModel({ responses: [[{ type: 'tool_use', id: 'tB', name: 'fs_write', input: {} }]] }), toolRegistry: registryB });

  const sessionA = new Session();
  const sessionB = new Session();
  sessionA.addMessage({ role: 'user', content: 'Do it' });
  sessionB.addMessage({ role: 'user', content: 'Do it' });

  await Promise.all([loopA.run(sessionA), loopB.run(sessionB)]);

  assert.equal(enteredA, false);
  assert.equal(enteredB, true);
});

test('ATTACK 9 — UNKNOWN CAPABILITY', async () => {
  const registry = new ToolRegistry({
    policy: new StaticCapabilityPolicy(['capability.this.does.not.exist']),
  });

  let entered = false;
  registry.register({
    name: 'unknown_cap',
    description: 'Test unknown cap',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['capability.this.does.not.exist'],
    execute: async () => {
      entered = true;
      return 'wrote';
    }
  });

  const session = new Session();
  const loop = new AgentLoop({
    model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't1', name: 'unknown_cap', input: {} }], 'Finished'] }),
    toolRegistry: registry,
  });

  session.addMessage({ role: 'user', content: 'Do it' });
  await loop.run(session);

  // If the policy grants exactly 'capability.this.does.not.exist', it allows it.
  // Wait, if it requests an unknown capability and it's NOT granted...
  
  const registry2 = new ToolRegistry({
    policy: new StaticCapabilityPolicy(['filesystem.read']),
  });
  registry2.register({
    name: 'unknown_cap2',
    description: 'Test unknown cap',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['capability.this.does.not.exist'],
    execute: async () => { entered = true; return 'wrote'; }
  });
  
  entered = false;
  const loop2 = new AgentLoop({
    model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't2', name: 'unknown_cap2', input: {} }]] }),
    toolRegistry: registry2,
  });
  const session2 = new Session();
  session2.addMessage({ role: 'user', content: 'Do it' });
  await loop2.run(session2);

  assert.equal(entered, false);
});

test('ATTACK 10 — EMPTY POLICY', async () => {
  const registry = new ToolRegistry({
    policy: new StaticCapabilityPolicy([]),
  });

  let entered = false;
  registry.register({
    name: 'fs_write',
    description: 'Writes to a file',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.write'],
    execute: async () => {
      entered = true;
      return 'wrote';
    }
  });

  const session = new Session();
  const loop = new AgentLoop({
    model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't1', name: 'fs_write', input: {} }]] }),
    toolRegistry: registry,
  });

  session.addMessage({ role: 'user', content: 'Do it' });
  await loop.run(session);

  assert.equal(entered, false);
});

test('ATTACK 11 — WILDCARD / PREFIX ESCAPE', async () => {
  assert.throws(() => {
    new StaticCapabilityPolicy(['filesystem']); // missing action
  }, /Invalid capability format/);

  // Even if we test a valid format 'filesystem.*', we can test prefix collisions.
  const registry = new ToolRegistry({
    policy: new StaticCapabilityPolicy(['filesystem.*']),
  });

  let entered = false;
  registry.register({
    name: 'fs_write',
    description: 'Writes to a file',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['filesystem.read.extra' as any],
    execute: async () => { entered = true; return 'wrote'; }
  });

  const session = new Session();
  const loop = new AgentLoop({
    model: new FakeModel({ responses: [[{ type: 'tool_use', id: 't1', name: 'fs_write', input: {} }], 'Finished'] }),
    toolRegistry: registry,
  });

  session.addMessage({ role: 'user', content: 'Do it' });
  await loop.run(session);

  assert.equal(entered, false, 'Exact match policy must not wildcard');
});
