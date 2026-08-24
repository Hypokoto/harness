import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolRegistry, InvalidInputError, ToolExecutionError } from '@harness/tools';
import { McpServerManager } from './discovery.js';
import { MCPProtocolError } from './errors.js';
import { McpTool } from './adapter.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

test('Phase 9: MCP tool should validate input against schema before sending to worker', async () => {
  const clientMock = {
    callTool: async () => {
      throw new Error('Should not reach worker!');
    }
  };

  const adapter = new McpTool(
    'testSrv',
    'echo',
    'Echoes',
    {
      type: 'object',
      properties: {
        message: { type: 'string' }
      },
      required: ['message']
    },
    [],
    clientMock as any
  );

  const registry = new ToolRegistry();
  registry.register(adapter);

  // 1. Missing required field
  await assert.rejects(
    registry.execute('testSrv.echo', {}),
    (err: any) => {
      assert.ok(err instanceof InvalidInputError, 'Must throw InvalidInputError');
      return true;
    },
    'Should reject missing required field'
  );

  // 2. Wrong type
  await assert.rejects(
    registry.execute('testSrv.echo', { message: 123 }),
    (err: any) => {
      assert.ok(err instanceof InvalidInputError, 'Must throw InvalidInputError');
      return true;
    },
    'Should reject wrong type'
  );
  
  // 3. Extra fields (schema strictness)
  await assert.rejects(
    registry.execute('testSrv.echo', { message: 'hello', malicious: true }),
    (err: any) => {
      assert.ok(err instanceof InvalidInputError, 'Must throw InvalidInputError');
      return true;
    },
    'Should reject extra fields'
  );
});

test('Phase 9: MCP adapter must reject malformed results from the MCP plugin', async () => {
  let mockResult: any = {};
  const clientMock = {
    callTool: async () => mockResult
  };

  const adapter = new McpTool(
    'testSrv',
    'echo',
    'Echoes',
    { type: 'object', properties: {} },
    [],
    clientMock as any
  );

  // Result is oversized based on bytes
  const oversizedText = 'A'.repeat(5 * 1024 * 1024 + 1); // 5MB + 1 byte
  mockResult = { content: [{ type: 'text', text: oversizedText }] };
  await assert.rejects(
    adapter.execute({}),
    /payload too large/i,
    'Should reject payload larger than 5MB'
  );

  // Multibyte characters exceed the byte limit even if length is < 5 million
  // 🔥 is 4 bytes. 1.26MB of 🔥 = 5MB. 1.3M is ~5.2MB.
  const multibyteText = '🔥'.repeat(1.3 * 1024 * 1024);
  mockResult = { content: [{ type: 'text', text: multibyteText }] };
  await assert.rejects(
    adapter.execute({}),
    /payload too large/i,
    'Should calculate byte size, not just string length'
  );

  // Too deeply nested
  let deeplyNested: any = {};
  let cur = deeplyNested;
  for (let i = 0; i < 25; i++) {
    cur.child = {};
    cur = cur.child;
  }
  mockResult = { content: deeplyNested };
  await assert.rejects(
    adapter.execute({}),
    /too deeply nested/i,
    'Should reject deeply nested payload'
  );

  // Result content is not an array
  mockResult = { content: 'not an array' };
  await assert.rejects(
    adapter.execute({}),
    /malformed/i,
    'Should reject non-array content'
  );

  // Result has invalid item types
  mockResult = { content: [{ type: 'text', text: 123 }] };
  await assert.rejects(
    adapter.execute({}),
    /malformed/i,
    'Should reject non-string text in content'
  );
});

test('Phase 9: MCP discovery must reject malformed tool metadata', async () => {
  const clientMock = {
    listTools: async () => [
      { name: { toString: () => 'malicious' }, inputSchema: { type: 'object' } }
    ]
  };

  assert.throws(
    () => {
      new McpTool(
        'testSrv',
        ({ toString: () => 'malicious' } as any),
        'desc',
        {},
        [],
        clientMock as any
      );
    },
    /Invalid MCP tool name/,
    'Should reject non-string tool name'
  );

  assert.throws(
    () => {
      new McpTool(
        'testSrv',
        '../../../etc/passwd',
        'desc',
        {},
        [],
        clientMock as any
      );
    },
    /Invalid MCP tool name format/,
    'Should reject path-traversal style names'
  );
});
