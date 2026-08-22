import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EventStore } from '@harness/events';
import { ToolRegistry, type Tool } from '@harness/tools';
import {
  AgentExecutionError,
  AgentLoop,
  FakeModel,
  MaxStepsExceededError,
  Session,
} from './index.js';

interface EchoInput {
  text: string;
}

const echoTool: Tool<EchoInput, { text: string }> = {
  name: 'echo',
  description: 'Returns the input text',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
  },
  validateInput(input: unknown) {
    if (typeof input !== 'object' || input === null || typeof (input as any).text !== 'string') {
      throw new Error('Invalid input');
    }
    return input as EchoInput;
  },
  async execute(input: EchoInput) {
    return { text: input.text };
  },
};

test('TEST 1: Session initializes with defaults', () => {
  const session = new Session();
  assert.ok(session.id.startsWith('session_'));
  assert.equal(session.systemPrompt, undefined);
  assert.equal(session.model, undefined);
  assert.deepEqual(session.getMessages(), []);
});

test('TEST 2: Session records message history accurately', () => {
  const session = new Session({ systemPrompt: 'You are helpful' });
  session.addMessage({ role: 'user', content: 'Hello' });
  session.addMessages([
    { role: 'assistant', content: 'Hi there' },
    { role: 'user', content: 'How are you?' },
  ]);

  const messages = session.getMessages();
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'Hello');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[2].content, 'How are you?');
});

test('TEST 3: Session clearHistory resets messages array', () => {
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Test message' });
  assert.equal(session.getMessages().length, 1);
  session.clearHistory();
  assert.equal(session.getMessages().length, 0);
});

test('TEST 4: Session logs events if EventStore is configured', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-session-test-'));
  try {
    const store = new EventStore(join(tmpDir, 'events.jsonl'));
    const session = new Session({ id: 'test_session_1', eventStore: store });
    session.addMessage({ role: 'user', content: 'Hello event store' });
    session.clearHistory();
    await session.flushEvents();

    const events = await store.read('test_session_1');
    assert.equal(events.length, 3);
    assert.equal(events[0].type, 'session_created');
    assert.equal(events[1].type, 'message_added');
    assert.equal(events[2].type, 'history_cleared');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 5: FakeModel returns enqueued responses', async () => {
  const fakeModel = new FakeModel({
    responses: ['First response', 'Second response'],
  });

  const resp1 = await fakeModel.complete({ messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(resp1.text, 'First response');

  const resp2 = await fakeModel.complete({ messages: [{ role: 'user', content: 'Hi again' }] });
  assert.equal(resp2.text, 'Second response');
});

test('TEST 6: FakeModel tracks request history', async () => {
  const fakeModel = new FakeModel();
  await fakeModel.complete({ messages: [{ role: 'user', content: 'Req 1' }] });
  await fakeModel.complete({ messages: [{ role: 'user', content: 'Req 2' }] });

  const requests = fakeModel.getRequests();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].messages[0].content, 'Req 1');
  assert.equal(requests[1].messages[0].content, 'Req 2');
  assert.equal(fakeModel.getLastRequest()?.messages[0].content, 'Req 2');
});

test('TEST 7: AgentLoop single turn completes with text output', async () => {
  const fakeModel = new FakeModel({ responses: ['Hello, user!'] });
  const loop = new AgentLoop({ model: fakeModel });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Hi agent' });

  const result = await loop.run(session);
  assert.equal(result.completed, true);
  assert.equal(result.steps, 1);
  assert.equal(result.finalResponse?.text, 'Hello, user!');
  assert.equal(session.getMessages().length, 2);
});

test('TEST 8: AgentLoop tool execution loop resolves tool call', async () => {
  const fakeModel = new FakeModel({
    responses: [
      [
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'echo',
          input: { text: 'Hello from tool!' },
        },
      ],
      'Tool returned result successfully.',
    ],
  });

  const registry = new ToolRegistry();
  registry.register(echoTool);

  const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Run echo tool' });

  const result = await loop.run(session);
  assert.equal(result.completed, true);
  assert.equal(result.steps, 2);
  assert.equal(result.finalResponse?.text, 'Tool returned result successfully.');

  const messages = session.getMessages();
  assert.equal(messages.length, 4); // user, assistant(tool_use), user(tool_result), assistant(final)
});

test('TEST 9: AgentLoop handles JSON tool calls in text', async () => {
  const fakeModel = new FakeModel({
    responses: [
      JSON.stringify({ tool: 'echo', input: { text: 'JSON tool text' } }),
      'Completed tool execution.',
    ],
  });

  const registry = new ToolRegistry();
  registry.register(echoTool);

  const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Run tool via JSON' });

  const result = await loop.run(session);
  assert.equal(result.steps, 2);
  assert.equal(result.completed, true);
});

test('TEST 10: AgentLoop handles unknown tool execution failure gracefully', async () => {
  const fakeModel = new FakeModel({
    responses: [
      [
        {
          type: 'tool_use',
          id: 'call_unknown',
          name: 'nonexistent_tool',
          input: {},
        },
      ],
      'Processed tool error.',
    ],
  });

  const registry = new ToolRegistry();
  const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Run missing tool' });

  const result = await loop.run(session);
  assert.equal(result.steps, 2);
  assert.equal(result.completed, true);

  const toolResultMsg = session.getMessages()[2];
  assert.equal(toolResultMsg.role, 'user');
  const toolBlocks = toolResultMsg.content as any[];
  assert.ok(toolBlocks[0].content.includes('Tool "nonexistent_tool" not found in registry'));
});

test('TEST 11: AgentLoop enforces maxSteps and throws MaxStepsExceededError', async () => {
  const fakeModel = new FakeModel({
    responses: [
      [{ type: 'tool_use', id: 'call_1', name: 'echo', input: { text: 'loop' } }],
      [{ type: 'tool_use', id: 'call_2', name: 'echo', input: { text: 'loop' } }],
      [{ type: 'tool_use', id: 'call_3', name: 'echo', input: { text: 'loop' } }],
    ],
  });

  const registry = new ToolRegistry();
  registry.register(echoTool);

  const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry, maxSteps: 2 });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Infinite tool call loop' });

  await assert.rejects(
    async () => loop.run(session),
    (err: any) => {
      assert.ok(err instanceof MaxStepsExceededError);
      assert.equal(err.steps, 2);
      return true;
    }
  );
});

test('TEST 12: AgentLoop logs event envelopes to EventStore', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'harness-agent-events-'));
  try {
    const store = new EventStore(join(tmpDir, 'session_events.jsonl'));
    const session = new Session({ id: 'session_events', eventStore: store });
    session.addMessage({ role: 'user', content: 'Execute echo' });

    const fakeModel = new FakeModel({
      responses: [
        [{ type: 'tool_use', id: 'call_evt', name: 'echo', input: { text: 'Event test' } }],
        'Done with events',
      ],
    });

    const registry = new ToolRegistry();
    registry.register(echoTool);

    const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
    await loop.run(session);

    const events = await store.read('session_events');
    const types = events.map((e) => e.type);
    assert.ok(types.includes('agent_turn_started'));
    assert.ok(types.includes('agent_turn_completed'));
    assert.ok(types.includes('tool_call_requested'));
    assert.ok(types.includes('tool_call_completed'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TEST 13: AgentLoop respects AbortSignal cancellation', async () => {
  const fakeModel = new FakeModel({ responses: ['Should not be returned'] });
  const loop = new AgentLoop({ model: fakeModel });
  const session = new Session();

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    async () => loop.run(session, { signal: controller.signal }),
    (err: any) => {
      assert.ok(err instanceof AgentExecutionError);
      return true;
    }
  );
});

test('TEST 14: Agent package does not depend on Phase 6+ packages', () => {
  const pkgJsonPath = process.cwd().endsWith('packages/agent')
    ? join(process.cwd(), 'package.json')
    : join(process.cwd(), 'packages/agent/package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const deps = Object.keys(pkgJson.dependencies || {});
  const devDeps = Object.keys(pkgJson.devDependencies || {});
  const allDeps = [...deps, ...devDeps];

  const forbidden = [
    '@harness/profile',
    '@harness/context',
    '@harness/permissions',
    '@harness/mcp',
    '@harness/registry-client',
    '@harness/skills',
    '@harness/memory',
  ];
  for (const f of forbidden) {
    assert.equal(allDeps.includes(f), false, `Package must not depend on ${f}`);
  }
});

