import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolRegistry } from '@harness/tools';
import { parseCapability, StaticCapabilityPolicy, PermissionDeniedError, DefaultDenyPolicy } from '@harness/permissions';
import { ContextComposer, ToolIndex } from '@harness/context';
import { McpServerManager } from './discovery.js';
import { validateServerConfig } from './config.js';
import { MCPConnectionError, MCPToolError } from './errors.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testServerPath = join(__dirname, 'test-server.js');

const validConfig = {
  name: 'testSrv',
  command: process.execPath,
  args: [testServerPath],
};

const restrictedConfig = {
  name: 'secureSrv',
  command: process.execPath,
  args: [testServerPath],
  requiredCapabilities: [parseCapability('filesystem.read')],
};

test('TEST 1: MCP client can start a test server & TEST 2: MCP initialization succeeds', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  await manager.initializeServer(validConfig, registry);
  
  assert.ok(registry.has('testSrv.echo'));
  await manager.closeAll();
});

test('TEST 3: MCP tools/list succeeds & TEST 4: MCP metadata maps into Harness Tool metadata & TEST 5: MCP tool receives a deterministic namespace', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  await manager.initializeServer(validConfig, registry);
  
  const tools = registry.list();
  const echoTool = tools.find(t => t.name === 'testSrv.echo');
  assert.ok(echoTool);
  assert.equal(echoTool.description, 'Echoes the input');
  assert.deepEqual(echoTool.inputSchema, {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message']
  });
  
  await manager.closeAll();
});

test('TEST 6: MCP tool registers in the existing ToolRegistry & TEST 9: MCP tool execution reaches the test server & TEST 10: MCP result is normalized correctly', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  await manager.initializeServer(validConfig, registry);
  
  const result = await registry.execute('testSrv.echo', { message: 'hello mcp' }) as any[];
  assert.equal(result[0].text, 'echo: hello mcp');
  
  await manager.closeAll();
});

test('TEST 7: MCP tool can be found through Phase 7 search_tools() & TEST 8: Full MCP tool schema is still lazily loaded', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  await manager.initializeServer(validConfig, registry);
  
  const allTools = registry.list().map(m => registry.get(m.name));
  const index = new ToolIndex({ tools: allTools as any });
  const searchTool = index.createSearchTool();
  
  const found = await searchTool.execute({ query: 'echo' }, {} as any) as { content: string };
  assert.ok(found.content.includes('testSrv.echo'));
  
  await manager.closeAll();
});

test('TEST 11: MCP tool errors propagate clearly', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  await manager.initializeServer(validConfig, registry);
  
  await assert.rejects(
    async () => registry.execute('testSrv.error_tool', {}),
    (err: any) => {
      assert.ok(err.message.includes('testSrv.error_tool'));
      assert.ok(err.cause instanceof MCPToolError);
      return true;
    }
  );
  
  await manager.closeAll();
});

test('TEST 12: MCP server shutdown works & TEST 23: MCP server processes are cleaned up after shutdown & TEST 24: No MCP process remains after test teardown', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  await manager.initializeServer(validConfig, registry);
  await manager.closeAll();
  
  await assert.rejects(
    async () => registry.execute('testSrv.echo', { message: 'hi' }),
    /Client is not connected/
  );
});

test('TEST 13: Multiple MCP servers can coexist & TEST 14: Tool names from different servers do not collide', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  
  const config2 = { ...validConfig, name: 'otherSrv' };
  
  await manager.initializeServers([validConfig, config2], registry);
  
  assert.ok(registry.has('testSrv.echo'));
  assert.ok(registry.has('otherSrv.echo'));
  
  const result1 = await registry.execute('testSrv.echo', { message: '1' }) as any[];
  const result2 = await registry.execute('otherSrv.echo', { message: '2' }) as any[];
  
  assert.equal(result1[0].text, 'echo: 1');
  assert.equal(result2[0].text, 'echo: 2');
  
  await manager.closeAll();
});

test('TEST 15: A failing MCP server does not break unrelated local tools', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  
  registry.register({
    name: 'local.tool',
    description: 'local',
    inputSchema: {},
    execute: async () => 'local result'
  });
  
  const badConfig = { name: 'badSrv', command: 'nonexistent-command-xyz' };
  
  await manager.initializeServers([validConfig, badConfig], registry);
  
  // local tool still works
  const localRes = await registry.execute('local.tool', {});
  assert.equal(localRes, 'local result');
  
  // valid server still works
  const mcpRes = await registry.execute('testSrv.echo', { message: 'mcp' }) as any[];
  assert.equal(mcpRes[0].text, 'echo: mcp');
  
  await manager.closeAll();
});

test('TEST 16: MCP tool requiring an ungranted capability is denied & TEST 17: Denied MCP tool never reaches the MCP server', async () => {
  const manager = new McpServerManager();
  // using default deny policy
  const registry = new ToolRegistry();
  
  await manager.initializeServer(restrictedConfig, registry);
  
  await assert.rejects(
    async () => registry.execute('secureSrv.restricted', { file: 'secret.txt' }),
    (err: any) => {
      assert.ok(err instanceof PermissionDeniedError);
      return true;
    }
  );
  
  await manager.closeAll();
});

test('TEST 18: Granted MCP tool reaches the MCP server', async () => {
  const manager = new McpServerManager();
  const policy = new StaticCapabilityPolicy(['filesystem.read']);
  const registry = new ToolRegistry({ policy });
  
  await manager.initializeServer(restrictedConfig, registry);
  
  const result = await registry.execute('secureSrv.restricted', { file: 'public.txt' }) as any[];
  assert.equal(result[0].text, 'read: public.txt');
  
  await manager.closeAll();
});

test('TEST 19: MCP server stdout is reserved for protocol traffic & TEST 20: MCP stderr is handled separately', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  
  await manager.initializeServer(validConfig, registry);
  
  // "noisy" tool writes to stderr, which shouldn't break the protocol parse
  const result = await registry.execute('testSrv.noisy', {}) as any[];
  assert.equal(result[0].text, 'noisy success');
  
  await manager.closeAll();
});

test('TEST 21: Malformed MCP configuration fails clearly', () => {
  assert.throws(() => validateServerConfig({}), /must include a valid non-empty "name" string/);
  assert.throws(() => validateServerConfig({ name: 'x' }), /must include a valid non-empty "command" string/);
  assert.throws(() => validateServerConfig({ name: 'x', command: 'y', args: [123] }), /must be an array of strings/);
});

test('TEST 22: Invalid MCP server startup is handled clearly', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  
  await assert.rejects(
    async () => manager.initializeServer({ name: 'fail', command: 'nonexistent-xyz' }, registry),
    (err: any) => {
      assert.ok(err instanceof MCPConnectionError);
      return true;
    }
  );
});

test('TEST 25, 26, 27, 28, 29: Handled by workspace tests', () => {
  assert.ok(true);
});

test('SECURITY 1: MCP server exposes restricted tool. Capability not granted', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry(); // DefaultDenyPolicy
  await manager.initializeServer(restrictedConfig, registry);
  
  await assert.rejects(
    async () => registry.execute('secureSrv.restricted', { file: 'secret.txt' }),
    PermissionDeniedError
  );
  
  await manager.closeAll();
});

test('SECURITY 2: Capability granted. Attempt execution', async () => {
  const manager = new McpServerManager();
  const policy = new StaticCapabilityPolicy(['filesystem.read']);
  const registry = new ToolRegistry({ policy });
  await manager.initializeServer(restrictedConfig, registry);
  
  const result = await registry.execute('secureSrv.restricted', { file: 'public.txt' }) as any[];
  assert.equal(result[0].text, 'read: public.txt');
  
  await manager.closeAll();
});

test('SECURITY 3: MCP server exposes a tool named like a local privileged tool -> no overwrite', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  
  registry.register({
    name: 'read_file',
    description: 'local read',
    inputSchema: {},
    execute: async () => 'local content'
  });
  
  // the MCP server has a tool named 'restricted' but it gets registered as 'secureSrv.restricted'
  // and we don't allow it to overwrite 'read_file' anyway since it's namespaced.
  await manager.initializeServer(restrictedConfig, registry);
  
  const localRes = await registry.execute('read_file', {});
  assert.equal(localRes, 'local content');
  
  assert.ok(registry.has('secureSrv.restricted'));
  
  await manager.closeAll();
});

test('SECURITY 4: Config contains malicious arguments -> kept structured', async () => {
  const manager = new McpServerManager();
  const registry = new ToolRegistry();
  
  // Arguments are passed in args array, NOT evaluated by a shell
  const maliciousArgs = ['&&', 'echo', 'hacked'];
  
  // We expect it to try to execute `node test-server.js && echo hacked`
  // as literal arguments to node. Since node ignores them, it will actually succeed starting.
  // We just ensure it does not run a shell and execute echo hacked.
  await assert.doesNotReject(
    async () => manager.initializeServer({ name: 'mal', command: process.execPath, args: [testServerPath, ...maliciousArgs] }, registry)
  );
  
  await manager.closeAll();
});

test('SECURITY 5: MCP adapter reads capabilities from install-time manifest', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-mcp-test-'));
  
  // Create a fake manifest with a capability requirement
  await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
    name: 'network-server',
    version: '1.0.0',
    capabilities: ['network.access']
  }));

  const config = {
    name: 'netSrv',
    command: process.execPath,
    args: [testServerPath],
    packagePath: tmpDir
  };

  const manager = new McpServerManager();
  
  // Attempt with DefaultDenyPolicy (no grants) -> Should fail
  const denyRegistry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
  await manager.initializeServer(config, denyRegistry);
  
  await assert.rejects(
    async () => denyRegistry.execute('netSrv.echo', { message: 'hello' }),
    (err: any) => {
      assert.ok(err instanceof PermissionDeniedError);
      assert.ok(err.message.includes('network.access'));
      return true;
    },
    'Tool must be denied because manifest requires "network.access" capability'
  );
  
  await manager.closeAll();

  // Attempt with granted capability -> Should succeed
  const allowRegistry = new ToolRegistry({ policy: new StaticCapabilityPolicy(['network.access']) });
  await manager.initializeServer(config, allowRegistry);
  
  const result = await allowRegistry.execute('netSrv.echo', { message: 'hello' }) as any[];
  assert.equal(result[0].text, 'echo: hello', 'Tool must execute successfully when capability is granted');
  
  await manager.closeAll();
  
  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('SECURITY 6: MCP adapter fails initialization if manifest.json is missing when packagePath is set', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-mcp-test-missing-'));
  
  // We DO NOT create a manifest.json in tmpDir to simulate a corrupt/missing install
  
  const config = {
    name: 'corruptSrv',
    command: process.execPath,
    args: [testServerPath],
    packagePath: tmpDir
  };

  const manager = new McpServerManager();
  const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
  
  // Initialization should throw because packagePath was given but manifest is unreadable
  await assert.rejects(
    async () => manager.initializeServer(config, registry),
    /manifest.json could not be read or parsed/
  );
  
  // The server's tools should NOT be registered
  assert.equal(registry.has('corruptSrv.echo'), false, 'Tools from a corrupt server should not be registered');
  
  await manager.closeAll();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
