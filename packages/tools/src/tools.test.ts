import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  DuplicateToolError,
  InvalidInputError,
  ToolExecutionError,
  ToolRegistry,
  UnknownToolError,
  type Tool,
} from './index.js';

interface EchoInput {
  value: string;
}

interface EchoOutput {
  value: string;
}

const createEchoTool = (): Tool<EchoInput, EchoOutput> => ({
  name: 'echo',
  description: 'Test echo tool that returns input value',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'string' },
    },
    required: ['value'],
  },
  validateInput(input: unknown): EchoInput {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof (input as any).value !== 'string'
    ) {
      throw new InvalidInputError('Input must be an object with string property "value".');
    }
    return input as EchoInput;
  },
  async execute(input: EchoInput): Promise<EchoOutput> {
    return { value: input.value };
  },
});

test('TEST 1: Empty registry starts with zero tools', () => {
  const registry = new ToolRegistry();
  assert.equal(registry.list().length, 0);
  assert.deepEqual(registry.list(), []);
});

test('TEST 2: Register a test tool', () => {
  const registry = new ToolRegistry();
  const echoTool = createEchoTool();
  registry.register(echoTool);
  assert.equal(registry.has('echo'), true);
});

test('TEST 3: Get registered tool', () => {
  const registry = new ToolRegistry();
  const echoTool = createEchoTool();
  registry.register(echoTool);
  const retrieved = registry.get('echo');
  assert.equal(retrieved.name, 'echo');
  assert.equal(retrieved.description, 'Test echo tool that returns input value');
});

test('TEST 4: has(name) works', () => {
  const registry = new ToolRegistry();
  const echoTool = createEchoTool();
  assert.equal(registry.has('echo'), false);
  registry.register(echoTool);
  assert.equal(registry.has('echo'), true);
  assert.equal(registry.has('nonexistent'), false);
});

test('TEST 5: list() returns registered tools', () => {
  const registry = new ToolRegistry();
  const echoTool = createEchoTool();
  registry.register(echoTool);
  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'echo');
  assert.equal(list[0].description, 'Test echo tool that returns input value');
  assert.deepEqual(list[0].inputSchema, echoTool.inputSchema);
});

test('TEST 6: Duplicate registration fails', () => {
  const registry = new ToolRegistry();
  const echoTool1 = createEchoTool();
  const echoTool2 = createEchoTool();
  registry.register(echoTool1);
  assert.throws(
    () => registry.register(echoTool2),
    (err: any) => {
      assert.ok(err instanceof DuplicateToolError);
      assert.equal(err.toolName, 'echo');
      return true;
    }
  );
});

test('TEST 7: Unknown tool lookup fails', () => {
  const registry = new ToolRegistry();
  assert.throws(
    () => registry.get('unknown_tool'),
    (err: any) => {
      assert.ok(err instanceof UnknownToolError);
      assert.equal(err.toolName, 'unknown_tool');
      return true;
    }
  );

  assert.rejects(
    async () => registry.execute('unknown_tool', { value: 'hi' }),
    (err: any) => {
      assert.ok(err instanceof UnknownToolError);
      assert.equal(err.toolName, 'unknown_tool');
      return true;
    }
  );
});

test('TEST 8: Valid tool input executes', async () => {
  const registry = new ToolRegistry();
  registry.register(createEchoTool());
  const result = await registry.execute('echo', { value: 'hello harness' });
  assert.deepEqual(result, { value: 'hello harness' });
});

test('TEST 9: Invalid tool input fails validation', async () => {
  const registry = new ToolRegistry();
  registry.register(createEchoTool());

  await assert.rejects(
    async () => registry.execute('echo', { value: 12345 }),
    (err: any) => {
      assert.ok(err instanceof InvalidInputError);
      return true;
    }
  );

  await assert.rejects(
    async () => registry.execute('echo', null),
    (err: any) => {
      assert.ok(err instanceof InvalidInputError);
      return true;
    }
  );
});

test('TEST 10: Tool execution errors propagate clearly', async () => {
  const registry = new ToolRegistry();
  const failingTool: Tool = {
    name: 'failing_tool',
    description: 'A tool that always throws during execution',
    async execute() {
      throw new Error('Database connection failed inside tool execution');
    },
  };
  registry.register(failingTool);

  await assert.rejects(
    async () => registry.execute('failing_tool', {}),
    (err: any) => {
      assert.ok(err instanceof ToolExecutionError);
      assert.equal(err.toolName, 'failing_tool');
      assert.ok(err.message.includes('Database connection failed inside tool execution'));
      return true;
    }
  );
});

test('TEST 11: Registry does not automatically contain built-in tools', () => {
  const registry = new ToolRegistry();
  assert.equal(registry.list().length, 0);
  assert.equal(registry.has('bash'), false);
  assert.equal(registry.has('read_file'), false);
  assert.equal(registry.has('git'), false);
  assert.equal(registry.has('mcp'), false);
});

test('TEST 12: Tool package does not depend on agent/context/permissions/MCP', () => {
  const pkgJsonPath = process.cwd().endsWith('packages/tools')
    ? join(process.cwd(), 'package.json')
    : join(process.cwd(), 'packages/tools/package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const deps = Object.keys(pkgJson.dependencies || {});
  const devDeps = Object.keys(pkgJson.devDependencies || {});
  const allDeps = [...deps, ...devDeps];

  const forbidden = ['@harness/agent', '@harness/context', '@harness/permissions', '@harness/mcp'];
  for (const f of forbidden) {
    assert.equal(allDeps.includes(f), false, `Package must not depend on ${f}`);
  }
});
