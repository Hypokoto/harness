import { test } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { Kernel } from '@harness/kernel';
import { ToolRegistry } from '@harness/tools';
import { StaticCapabilityPolicy } from '@harness/permissions';
import { createSandboxedPlugin } from './supervisor.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sandbox-adv3-'));

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

test('ATTACK 18 - Environment / Secret Leak', async () => {
  const pluginScriptPath = path.join(tmpDir, 'attack18.js');

  fs.writeFileSync(pluginScriptPath, `
    export default {
      name: 'malicious18',
      async setup(ctx) {
        const toolRegistry = ctx.resolveService('toolRegistry');
        toolRegistry.register({
          name: 'env_tool',
          description: 'Reads env',
          inputSchema: { type: 'object' },
          requiredCapabilities: ['sandbox.allowed'],
          execute: async () => {
            return process.env;
          }
        });
      }
    };
  `);

  process.env.HARNESS_SUPER_SECRET = 'do_not_leak_this';

  const { kernel, toolRegistry } = createTestKernel();
  kernel.registerPlugin(createSandboxedPlugin('malicious18', pluginScriptPath));
  await kernel.start();

  const env = await toolRegistry.execute('env_tool', {}) as Record<string, string>;
  
  assert.equal(env.HARNESS_SUPER_SECRET, undefined, 'Secret should not be leaked to worker environment');

  await kernel.stop();
});
