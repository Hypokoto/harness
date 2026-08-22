import test from 'node:test';
import assert from 'node:assert';
import { SubagentRunner, type SubagentSpec } from './subagent.js';
import { FakeModel } from '@harness/agent';
import type { ToolRegistry } from '@harness/tools';
import type { ContextComposer } from '@harness/context';
import type { EventInput } from '@harness/events';

class MockEventStore {
  public events: any[] = [];
  async append<T>(eventInput: EventInput<T>) { 
    this.events.push(eventInput); 
    return { ...eventInput, id: eventInput.id || '123' } as any;
  }
  async getEvents() { return this.events as any; }
  async getEventsBySession(sessionId: string) { return this.events.filter(e => e.sessionId === sessionId) as any; }
}

const mockComposer: ContextComposer = {
  compose: async () => ({ systemPrompt: 'SysPrompt', messages: [], activeTools: [], indexedTools: [], metadata: {}, isLazy: false })
} as any;

const mockRegistry: ToolRegistry = {
  get: () => ({} as any),
  has: () => false,
  list: () => [],
  execute: async () => ({}),
  register: () => {},
  setPolicy: () => {}
} as any;

test('Subagent Tests', async (t) => {
  await t.test('TEST 19: Subagent depth limit works', async () => {
    const runner = new SubagentRunner();
    const spec: SubagentSpec = {
      task: 'test',
      model: new FakeModel({ responses: ['done'] }),
      toolRegistry: mockRegistry,
      contextComposer: mockComposer,
      currentDepth: 3,
      maxDepth: 3
    };
    const res = await runner.spawn(spec);
    assert.strictEqual(res.status, 'failed');
    assert.match(res.summary, /Max subagent depth exceeded/);
  });

  await t.test('TEST 20: Subagent token/step budget works', async () => {
    const runner = new SubagentRunner();
    const spec: SubagentSpec = {
      task: 'test',
      model: new FakeModel({ responses: [
        [{ type: 'tool_use', id: '1', name: 't', input: {} }],
        [{ type: 'tool_use', id: '2', name: 't', input: {} }],
        'done'
      ] }),
      toolRegistry: mockRegistry,
      contextComposer: mockComposer,
      maxSteps: 1 // should fail here
    };
    const res = await runner.spawn(spec);
    assert.strictEqual(res.status, 'failed');
    assert.match(res.error?.message || '', /Agent loop exceeded maximum allowed steps/);
  });

  await t.test('TEST 21: Parent cancellation propagates', async () => {
    const runner = new SubagentRunner();
    const spec: SubagentSpec = {
      task: 'test',
      model: {
        defaultModel: 'test',
        async complete() {
          await new Promise(resolve => setTimeout(resolve, 500));
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
      } as any,
      toolRegistry: mockRegistry,
      contextComposer: mockComposer,
      timeoutMs: 100 // will abort internally
    };
    const res = await runner.spawn(spec);
    assert.strictEqual(res.status, 'failed');
    assert.match(res.error?.message || '', /aborted|timeout/i);
  });

  await t.test('TEST 22: Subagent events are traceable', async () => {
    const runner = new SubagentRunner();
    const eventStore = new MockEventStore();
    const spec: SubagentSpec = {
      task: 'test',
      model: new FakeModel({ responses: ['done'] }),
      toolRegistry: mockRegistry,
      contextComposer: mockComposer,
      eventStore: eventStore as any
    };
    const res = await runner.spawn(spec);
    assert.strictEqual(res.status, 'completed');
    const subEvents = eventStore.events.filter(e => String(e.type).startsWith('subagent.'));
    assert.strictEqual(subEvents.length, 3);
    assert.strictEqual(subEvents[0].type, 'subagent.spawned');
    assert.strictEqual(subEvents[1].type, 'subagent.started');
    assert.strictEqual(subEvents[2].type, 'subagent.completed');
  });
});
