import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '@harness/tools';
import { AgentLoop, Session, FakeModel } from './index.js';
import { DefaultDenyPolicy, PermissionDeniedError, parseCapability } from '@harness/permissions';
import { ContextComposer } from '@harness/context';
import { ProfileResolver } from '@harness/profile';

test('TEST 21: AgentLoop cannot execute an unauthorized tool', async () => {
  let toolExecuted = false;

  const restrictedTool = {
    name: 'write-test-file',
    description: 'Restricted tool requiring filesystem.write',
    requiredCapabilities: ['filesystem.write'],
    async execute() {
      toolExecuted = true;
      return 'written';
    },
  };

  const policy = new DefaultDenyPolicy();
  const registry = new ToolRegistry({ policy });
  registry.register(restrictedTool);

  const fakeModel = new FakeModel({
    responses: [
      [
        {
          type: 'tool_use',
          id: 'call_security_test',
          name: 'write-test-file',
          input: { data: 'attack payload' },
        },
      ],
      'Done',
    ],
  });

  const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Write to filesystem' });

  const result = await loop.run(session);
  assert.ok(result.completed);
  assert.ok(!toolExecuted, 'tool.execute() must NOT be called through AgentLoop without permission');

  const messages = session.getMessages();
  const lastToolResultMsg = messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.toolUseId === 'call_security_test'));
  assert.ok(lastToolResultMsg);
  const resultBlock = (lastToolResultMsg.content as any[]).find(b => b.type === 'tool_result' && b.toolUseId === 'call_security_test');
  console.log('BLOCK CONTENT:', resultBlock.content);  assert.ok(typeof resultBlock.content === 'string' && resultBlock.content.includes('Permission denied'));
});

test('TEST 25: Existing Phase 5 agent tests still pass (regression)', async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'echo',
    description: 'Returns text',
    async execute(input: any) {
      return { text: input.text };
    },
  });

  const fakeModel = new FakeModel({
    responses: [
      [{ type: 'tool_use', id: 'call_1', name: 'echo', input: { text: 'Hello Phase 5!' } }],
      'Tool ran successfully.',
    ],
  });

  const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
  const session = new Session();
  session.addMessage({ role: 'user', content: 'Run echo' });

  const result = await loop.run(session);
  assert.ok(result.completed);
  assert.equal(result.steps, 2);
  assert.equal(result.finalResponse?.text, 'Tool ran successfully.');
});

test('TEST 26: Existing Phase 6 profile tests still pass (regression)', () => {
  const resolver = new ProfileResolver();
  const resolved = resolver.resolve();
  assert.equal(resolved.name, 'default');
  assert.ok(resolved.config.model);
  assert.ok(resolved.config.maxSteps && resolved.config.maxSteps > 0);
  assert.deepEqual(resolved.config.grantedCapabilities, []);
});

test('TEST 27: Existing Phase 7 context tests still pass (regression)', async () => {
  const tool = {
    name: 'search',
    description: 'Searches documents',
    async execute() {
      return [];
    },
  };

  const composer = new ContextComposer({ tools: [tool] });
  const ctx = await composer.compose();
  assert.ok(ctx.activeTools.some((t: any) => t.name === 'search'));

  const policy = new DefaultDenyPolicy();
  const searchCap = 'search.execute';
  const restrictedTool = { ...tool, name: 'restricted-search', requiredCapabilities: [searchCap] };
  const composerWithRestricted = new ContextComposer({ tools: [restrictedTool] });
  const ctx2 = await composerWithRestricted.compose();

  assert.ok(ctx2.activeTools.some((t: any) => t.name === 'restricted-search'));
  const decision = policy.check({
    toolName: 'restricted-search',
    requiredCapabilities: [parseCapability(searchCap)],
    grantedCapabilities: new Set(),
  });
  assert.ok(!decision.allowed, 'Context visibility must NOT grant execution authority');
});

test('SECURITY: Restricted tool without grant is DENIED via all paths', async () => {
  let executeCallCount = 0;
  const restrictedTool = {
    name: 'write-test-file',
    description: 'Restricted tool',
    requiredCapabilities: ['filesystem.write'],
    async execute() {
      executeCallCount++;
      return 'should not happen';
    },
  };

  {
    const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
    registry.register(restrictedTool);
    await assert.rejects(
      () => registry.execute('write-test-file', {}, {}),
      (err: unknown) => err instanceof PermissionDeniedError
    );
    assert.equal(executeCallCount, 0);
  }

  {
    executeCallCount = 0;
    const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
    registry.register(restrictedTool);
    const fakeModel = new FakeModel({
      responses: [
        [{ type: 'tool_use', id: 'call_x', name: 'write-test-file', input: {} }],
        'Done',
      ],
    });
    const loop = new AgentLoop({ model: fakeModel, toolRegistry: registry });
    const session = new Session();
    session.addMessage({ role: 'user', content: 'Do restricted thing' });
    await loop.run(session);
    assert.equal(executeCallCount, 0);
  }

  {
    executeCallCount = 0;
    const composer = new ContextComposer({ tools: [restrictedTool] });
    const ctx = await composer.compose();
    assert.ok(ctx.activeTools.some((t: any) => t.name === 'write-test-file'));

    const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
    registry.register(restrictedTool);
    await assert.rejects(
      () => registry.execute('write-test-file', {}, {}),
      (err: unknown) => err instanceof PermissionDeniedError
    );
    assert.equal(executeCallCount, 0);
  }
  
  assert.equal(executeCallCount, 0);
});
