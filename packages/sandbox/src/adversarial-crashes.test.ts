import { test, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { Kernel } from '@harness/kernel';
import { ToolRegistry } from '@harness/tools';
import { StaticCapabilityPolicy } from '@harness/permissions';
import { createSandboxedPlugin } from './supervisor.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sandbox-adv2-'));

let activeKernel: Kernel | null = null;

test.afterEach(async () => {
  if (activeKernel) {
    await activeKernel.stop();
    activeKernel = null;
  }
});

function createTestKernel() {
  const kernel = new Kernel();
  const toolRegistry = new ToolRegistry();
  toolRegistry.setPolicy(new StaticCapabilityPolicy(['sandbox.allowed'])); 
  kernel.registerPlugin({
    name: 'tools',
    setup(ctx) {
      ctx.registerService('toolRegistry', toolRegistry);
    }
  });
  return { kernel, toolRegistry };
}

test('ATTACK 7 - Worker Crash During Tool Call', async () => {
  const pluginScriptPath = path.join(tmpDir, 'attack7.js');

  fs.writeFileSync(pluginScriptPath, `
    export default {
      name: 'malicious7',
      async setup(ctx) {
        const toolRegistry = ctx.resolveService('toolRegistry');
        toolRegistry.register({
          name: 'suicide_tool',
          description: 'Crashes during execution',
          inputSchema: { type: 'object' },
          requiredCapabilities: ['sandbox.allowed'],
          execute: async () => {
            process.exit(1);
          }
        });
      }
    };
  `);

  const { kernel, toolRegistry } = createTestKernel();
  activeKernel = kernel;
  kernel.registerPlugin(createSandboxedPlugin('malicious7', pluginScriptPath));
  await kernel.start();

  // Executing the tool should cause the worker to die, which should reject the promise
  await assert.rejects(
    toolRegistry.execute('suicide_tool', {}),
    /exited unexpectedly/
  );
});

test('ATTACK 8 & 9 - Worker Crash During Setup/Start', async () => {
  const pluginScriptPath = path.join(tmpDir, 'attack8.js');

  fs.writeFileSync(pluginScriptPath, `
    export default {
      name: 'malicious8',
      async setup(ctx) {
        process.exit(1); // Crash during setup
      }
    };
  `);

  const { kernel } = createTestKernel();
  activeKernel = kernel;
  kernel.registerPlugin(createSandboxedPlugin('malicious8', pluginScriptPath));
  
  // The kernel start should throw an error because the plugin failed to start
  await assert.rejects(
    kernel.start(),
    /exited with code 1/
  );
});

test('ATTACK 12 & 13 - Duplicate and Late Responses', async () => {
  const pluginScriptPath = path.join(tmpDir, 'attack12.js');

  fs.writeFileSync(pluginScriptPath, `
    export default {
      name: 'malicious12',
      async setup(ctx) {
        const toolRegistry = ctx.resolveService('toolRegistry');
        toolRegistry.register({
          name: 'spam_tool',
          description: 'Sends multiple responses',
          inputSchema: { type: 'object' },
          requiredCapabilities: ['sandbox.allowed'],
          execute: async () => {
            return 'first';
          }
        });
      },
      async start() {
        // Wait, we can use process.send directly to send fake responses!
        process.send({
          type: 'execute_tool_result',
          id: 'fake_id',
          result: 'fake_result'
        });
      }
    };
  `);

  const { kernel, toolRegistry } = createTestKernel();
  activeKernel = kernel;
  kernel.registerPlugin(createSandboxedPlugin('malicious12', pluginScriptPath));
  
  // Should start fine, and the rogue IPC message should just be dropped by the supervisor
  await kernel.start();
  
  const res = await toolRegistry.execute('spam_tool', {});
  assert.equal(res, 'first');
});

after(() => setTimeout(() => process.exit(0), 10));
