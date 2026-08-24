import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, suite } from 'node:test';
import { EventStore } from '@harness/events';
import { ToolRegistry, type Tool } from '@harness/tools';
import { AgentLoop, FakeModel, Session } from './index.js';

// ============================================================================
// FIXTURES
// ============================================================================

const syncThrowTool: Tool = {
  name: 'sync_throw',
  description: 'Throws immediately synchronously',
  execute() {
    throw new Error('Sync failure');
  },
};

const asyncThrowTool: Tool = {
  name: 'async_throw',
  description: 'Throws asynchronously',
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw new Error('Async failure');
  },
};

const malformedResultTool: Tool = {
  name: 'malformed_result',
  description: 'Returns un-JSON-serializable data',
  async execute() {
    const obj: any = {};
    obj.circular = obj; // Circular reference will fail JSON serialization/validation down the line
    return obj;
  },
};

const hugeResultTool: Tool = {
  name: 'huge_result',
  description: 'Returns a 10MB string payload',
  async execute() {
    return { data: 'A'.repeat(10 * 1024 * 1024) };
  },
};

const infiniteTool: Tool = {
  name: 'infinite_tool',
  description: 'Never resolves until AbortSignal',
  async execute(input: unknown, context) {
    return new Promise((resolve, reject) => {
      if (context.signal?.aborted) {
        return reject(new Error('Aborted'));
      }
      context.signal?.addEventListener('abort', () => {
        reject(new Error('Aborted via signal'));
      });
    });
  },
};

let partialSideEffectOccurred = false;
const partialFailureTool: Tool = {
  name: 'partial_failure',
  description: 'Performs a side effect then throws',
  async execute() {
    partialSideEffectOccurred = true;
    throw new Error('Failed after side effect');
  },
};

// ============================================================================
// TESTS
// ============================================================================

suite('Phase 1: Tool Failures', () => {
  let tmpDir: string;
  let eventStore: EventStore;

  test.beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'harness-phase1-'));
    eventStore = new EventStore(join(tmpDir, 'events.jsonl'));
    partialSideEffectOccurred = false;
  });

  test.afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createAgent(tool: Tool, responses: any[]) {
    const registry = new ToolRegistry();
    registry.register(tool);
    const model = new FakeModel({ responses });
    const session = new Session({ eventStore });
    const loop = new AgentLoop({ model, toolRegistry: registry });
    return { loop, session, registry, model };
  }

  test('ATTACK A — SYNCHRONOUS FAILURE', async () => {
    const { loop, session } = await createAgent(syncThrowTool, [
      [{ type: 'tool_use', id: 'call_sync', name: 'sync_throw', input: {} }],
      'Recovered',
    ]);
    session.addMessage({ role: 'user', content: 'run tool' });
    const result = await loop.run(session);
    
    assert.equal(result.completed, true);
    assert.equal(result.steps, 2);
    
    const messages = session.getMessages();
    const toolResultMsg = messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'));
    assert.ok(toolResultMsg);
    assert.ok((toolResultMsg.content as any[])[0].isError);
  });

  test('ATTACK B — ASYNCHRONOUS FAILURE', async () => {
    const { loop, session } = await createAgent(asyncThrowTool, [
      [{ type: 'tool_use', id: 'call_async', name: 'async_throw', input: {} }],
      'Recovered',
    ]);
    session.addMessage({ role: 'user', content: 'run tool' });
    const result = await loop.run(session);
    
    assert.equal(result.completed, true);
    assert.equal(result.steps, 2);
    
    const messages = session.getMessages();
    const toolResultMsg = messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'));
    assert.ok(toolResultMsg);
    assert.ok((toolResultMsg.content as any[])[0].isError);
  });

  test('ATTACK C — MALFORMED RESULT', async () => {
    const { loop, session } = await createAgent(malformedResultTool, [
      [{ type: 'tool_use', id: 'call_malformed', name: 'malformed_result', input: {} }],
      'Recovered',
    ]);
    session.addMessage({ role: 'user', content: 'run tool' });
    const result = await loop.run(session);
    
    assert.equal(result.completed, true);
    const messages = session.getMessages();
    const toolResultMsg = messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'));
    assert.ok(toolResultMsg);
    assert.ok((toolResultMsg.content as any[])[0].isError, 'Malformed result should be trapped as a tool error');
  });

  test('ATTACK D — HUGE RESULT', async () => {
    const { loop, session } = await createAgent(hugeResultTool, [
      [{ type: 'tool_use', id: 'call_huge', name: 'huge_result', input: {} }],
      'Recovered',
    ]);
    session.addMessage({ role: 'user', content: 'run tool' });
    const result = await loop.run(session);
    
    assert.equal(result.completed, true);
    const events = await eventStore.read(session.id);
    assert.ok(events.length > 0);
  });

  test('ATTACK E — INFINITE TOOL (AbortSignal)', async () => {
    const { loop, session } = await createAgent(infiniteTool, [
      [{ type: 'tool_use', id: 'call_infinite', name: 'infinite_tool', input: {} }],
    ]);
    session.addMessage({ role: 'user', content: 'run tool' });
    
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20); 
    
    await assert.rejects(
      loop.run(session, { signal: ac.signal }),
      /aborted/
    );
  });

  test('ATTACK F — PARTIAL SIDE EFFECT', async () => {
    const { loop, session } = await createAgent(partialFailureTool, [
      [{ type: 'tool_use', id: 'call_partial', name: 'partial_failure', input: {} }],
      'Recovered',
    ]);
    session.addMessage({ role: 'user', content: 'run tool' });
    const result = await loop.run(session);
    
    assert.equal(result.completed, true);
    assert.equal(partialSideEffectOccurred, true);
    
    const messages = session.getMessages();
    const toolResultMsg = messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'));
    assert.ok(toolResultMsg);
    assert.ok((toolResultMsg.content as any[])[0].isError);
  });

  test('EVENT ORDERING INVARIANTS', async () => {
    const { loop, session } = await createAgent(syncThrowTool, [
      [{ type: 'tool_use', id: 'call_sync_2', name: 'sync_throw', input: {} }],
      'Recovered',
    ]);
    session.addMessage({ role: 'user', content: 'run tool' });
    await loop.run(session);
    await session.flushEvents();
    
    const events = await eventStore.read(session.id);
    let calledFound = false;
    let terminalFound = false;
    
    for (const evt of events) {
      if (evt.type === 'tool.called') {
        assert.equal(terminalFound, false, 'tool.called must precede terminal event');
        calledFound = true;
      }
      if (evt.type === 'tool.failed' || evt.type === 'tool.completed') {
        assert.equal(calledFound, true, 'tool.called must happen before terminal event');
        assert.equal(terminalFound, false, 'Multiple terminal events not allowed');
        terminalFound = true;
      }
    }
    assert.equal(calledFound && terminalFound, true);
  });

  test('RECOVERY IN-PROCESS', async () => {
    // 1. Keep the same process alive
    const { loop, session } = await createAgent(syncThrowTool, [
      [{ type: 'tool_use', id: 'call_fail', name: 'sync_throw', input: {} }], // turn 1
      'Tool failed as expected.', // response to failure
      'Normal response', // response to normal request
    ]);
    
    session.addMessage({ role: 'user', content: 'fail now' });
    const result1 = await loop.run(session);
    assert.equal(result1.completed, true);
    
    // 2. Submit another normal request
    session.addMessage({ role: 'user', content: 'now work' });
    const result2 = await loop.run(session);
    
    // 3. Verify the agent works
    assert.equal(result2.completed, true);
    assert.equal(result2.finalResponse?.text, 'Normal response');
  });

  test('RECOVERY AFTER RESTART', async () => {
    let sessionId: string;
    
    // 1. First process executes failure
    {
      const { loop, session } = await createAgent(syncThrowTool, [
        [{ type: 'tool_use', id: 'call_fail_2', name: 'sync_throw', input: {} }],
        'Tool failed as expected.',
      ]);
      session.addMessage({ role: 'user', content: 'fail now' });
      await loop.run(session);
      await session.flushEvents();
      sessionId = session.id;
    } // process "terminates"
    
    // 2. Restart harness, resume session
    {
      const initialMessages: import('@harness/model').ModelMessage[] = [];
      const events = await eventStore.read(sessionId);
      for (const event of events) {
        const payload = event.payload as Record<string, unknown>;
        if (event.type === 'message_added' && payload.role && payload.content) {
          initialMessages.push({
            role: payload.role as 'user' | 'assistant',
            content: payload.content as any,
          });
        }
      }
      const newSession = new Session({ id: sessionId, eventStore, initialMessages });
      
      const newRegistry = new ToolRegistry();
      const newModel = new FakeModel({ responses: ['Normal response after restart'] });
      const newLoop = new AgentLoop({ model: newModel, toolRegistry: newRegistry });
      
      // 4. Verify failed tool call correctly represented in restored session
      const messages = newSession.getMessages();
      const toolResultMsg = messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'));
      assert.ok(toolResultMsg);
      assert.ok((toolResultMsg.content as any[])[0].isError);
      
      // 5. Execute another successful tool call (or normal request)
      newSession.addMessage({ role: 'user', content: 'work now' });
      const result = await newLoop.run(newSession);
      assert.equal(result.completed, true);
      assert.equal(result.finalResponse?.text, 'Normal response after restart');
    }
  });
});
