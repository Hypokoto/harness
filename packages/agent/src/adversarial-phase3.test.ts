import { test } from 'node:test';
import * as assert from 'node:assert';
import { AgentLoop } from './agent-loop.js';
import { Session } from './session.js';
import { ToolRegistry } from '@harness/tools';
import { StaticCapabilityPolicy } from '@harness/permissions';
import type { Model, ModelRequest, ModelResponse, ModelStreamEvent } from '@harness/model';

// --- FIXTURES ---

class ImmediateFailureModel implements Model {
  provider = 'test';
  defaultModel = 'test';
  async complete(req: ModelRequest): Promise<ModelResponse> { throw new Error('immediate_failure complete'); }
  async *completeStream(req: ModelRequest): AsyncIterable<ModelStreamEvent> {
    throw new Error('immediate_failure');
  }
}

class AsyncFailureModel implements Model {
  provider = 'test';
  defaultModel = 'test';
  async complete(req: ModelRequest): Promise<ModelResponse> { return Promise.reject(new Error('async_failure complete')); }
  async *completeStream(req: ModelRequest): AsyncIterable<ModelStreamEvent> {
    await new Promise(r => setTimeout(r, 10));
    throw new Error('async_failure');
  }
}

class StreamThenFailureModel implements Model {
  provider = 'test';
  defaultModel = 'test';
  async complete(req: ModelRequest): Promise<ModelResponse> { throw new Error('Not implemented'); }
  async *completeStream(req: ModelRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'message_start', id: '1', model: 'test', role: 'assistant' };
    yield { type: 'text_delta', text: 'hello' };
    yield { type: 'text_delta', text: ' world' };
    throw new Error('stream_then_failure');
  }
}

class MalformedStreamModel implements Model {
  provider = 'test';
  defaultModel = 'test';
  async complete(req: ModelRequest): Promise<ModelResponse> { throw new Error('Not implemented'); }
  async *completeStream(req: ModelRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'message_start', id: '1', model: 'test', role: 'assistant' };
    yield { type: 'text_delta', text: 'start' };
    // @ts-ignore malformed
    yield null;
    // @ts-ignore malformed
    yield { type: 'unknown_type' };
  }
}

// Memory event store to inspect emitted events
class MemoryEventStore {
  events: any[] = [];
  async append(event: any) { this.events.push(event); }
}

function createAgent(model: Model) {
  const toolRegistry = new ToolRegistry();
  toolRegistry.setPolicy(new StaticCapabilityPolicy(['sandbox.allowed']));
  toolRegistry.register({
    name: 'mock_tool',
    description: 'A mock tool',
    inputSchema: { type: 'object' },
    requiredCapabilities: ['sandbox.allowed'],
    execute: async () => 'tool_success'
  });
  
  const loop = new AgentLoop({ model, toolRegistry });
  const eventStore = new MemoryEventStore();
  const session = new Session({ id: 's1', model: 'test', systemPrompt: 'system' });
  // @ts-ignore - inject mock event store for testing
  session.eventStore = eventStore;
  
  return { loop, session, eventStore, toolRegistry };
}

// --- TESTS ---

test('ATTACK 1 - Immediate Model Failure', async () => {
  const { loop, session, eventStore } = createAgent(new ImmediateFailureModel());
  
  await assert.rejects(loop.step(session), /immediate_failure/);
  
  const events = eventStore.events.map(e => e.type);
  assert.ok(events.includes('generation.started'));
  assert.ok(events.includes('generation.failed'));
  assert.ok(!events.includes('generation.completed'));
  
  // No phantom assistant message
  assert.equal(session.getMessages().length, 0);
});

test('ATTACK 2 - Failure After Streaming', async () => {
  const { loop, session, eventStore } = createAgent(new StreamThenFailureModel());
  
  await assert.rejects(loop.step(session), /stream_then_failure/);
  
  const events = eventStore.events.map(e => e.type);
  assert.ok(events.includes('generation.started'));
  assert.ok(events.includes('generation.chunk'));
  assert.ok(events.includes('generation.failed'));
  assert.ok(!events.includes('generation.completed'));
  
  // No partial response silently persisted to session
  assert.equal(session.getMessages().length, 0);
});

test('ATTACK 3 - Malformed Model Event', async () => {
  const { loop, session, eventStore } = createAgent(new MalformedStreamModel());
  
  // AgentLoop.step iterates over stream. In our current impl, switch(event.type) will just ignore unknown types.
  // null will cause a crash (Cannot read properties of null). Let's see if it throws cleanly.
  await assert.rejects(loop.step(session));
  
  const events = eventStore.events.map(e => e.type);
  assert.ok(events.includes('generation.failed'));
  assert.ok(!events.includes('generation.completed'));
});

class MalformedToolCallModel implements Model {
  provider = 'test'; defaultModel = 'test';
  async complete(req: ModelRequest): Promise<ModelResponse> { throw new Error('Not implemented'); }
  async *completeStream(req: ModelRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'message_start', id: '1', model: 'test', role: 'assistant' };
    yield { type: 'text_delta', text: '{ "tool": "mock_tool", "input": ' }; // malformed json
    yield { type: 'message_stop' };
  }
}

class UnknownToolModel implements Model {
  provider = 'test'; defaultModel = 'test';
  async complete(req: ModelRequest): Promise<ModelResponse> { throw new Error('Not implemented'); }
  async *completeStream(req: ModelRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'message_start', id: '1', model: 'test', role: 'assistant' };
    yield { type: 'text_delta', text: '{ "tool": "nonexistent_tool", "input": {} }' };
    yield { type: 'message_stop' };
  }
}

class TimeoutModel implements Model {
  provider = 'test'; defaultModel = 'test';
  async complete(req: ModelRequest): Promise<ModelResponse> { throw new Error('Not implemented'); }
  async *completeStream(req: ModelRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'message_start', id: '1', model: 'test', role: 'assistant' };
    while (!req.signal?.aborted) {
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('AbortError');
  }
}

test('ATTACK 4 - Malformed Tool Call', async () => {
  const { loop, session, eventStore } = createAgent(new MalformedToolCallModel());
  const result = await loop.step(session);
  
  assert.equal(result.hasToolCalls, true);
  
  const events = eventStore.events.map(e => e.type);
  assert.ok(events.includes('tool.failed'));
  
  const toolErrorEvent = eventStore.events.find(e => e.type === 'tool.failed');
  assert.equal(toolErrorEvent.payload.toolName, 'malformed_tool');
});

test('ATTACK 5 - Unknown Tool', async () => {
  const { loop, session, eventStore } = createAgent(new UnknownToolModel());
  const result = await loop.step(session);
  
  assert.equal(result.hasToolCalls, true);
  
  const events = eventStore.events.map(e => e.type);
  assert.ok(events.includes('tool.failed'));
  
  const toolErrorEvent = eventStore.events.find(e => e.type === 'tool.failed');
  assert.equal(toolErrorEvent.payload.toolName, 'nonexistent_tool');
  assert.ok(toolErrorEvent.payload.error.includes('not found in registry'));
});

test('ATTACK 8 - Model Timeout', async () => {
  const { loop, session } = createAgent(new TimeoutModel());
  const controller = new AbortController();
  
  const stepPromise = loop.step(session, { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  
  await assert.rejects(stepPromise, /aborted/);
});
