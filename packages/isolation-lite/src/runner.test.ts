import test from 'node:test';
import assert from 'node:assert';
import { SandboxRunner } from './runner.js';

test('Sandbox Tests', async (t) => {
  await t.test('TEST 23: Sandbox runs simple script', async () => {
    const runner = new SandboxRunner();
    const result = await runner.run({ script: '1 + 2' });
    assert.strictEqual(result, '3');
  });

  await t.test('TEST 24: Sandbox enforces timeout', async () => {
    const runner = new SandboxRunner();
    await assert.rejects(
      runner.run({ script: 'while(true) {}', timeoutMs: 100 }),
      /Sandbox timeout exceeded/
    );
  });

  await t.test('TEST 25: Sandbox propagates error', async () => {
    const runner = new SandboxRunner();
    await assert.rejects(
      runner.run({ script: 'throw new Error("Boom")' }),
      /Boom/
    );
  });

  await t.test('SECURITY: Sandbox callTool respects ToolRegistry permissions', async () => {
    // Dynamically import to avoid top-level cyclic dependency issues
    const { ToolRegistry } = await import('@harness/tools');
    const { DefaultDenyPolicy } = await import('@harness/permissions');

    let executed = false;
    const registry = new ToolRegistry({ policy: new DefaultDenyPolicy() });
    
    registry.register({
      name: 'restricted-tool',
      description: 'Tool needing write capability',
      requiredCapabilities: ['filesystem.write'],
      execute: async () => {
        executed = true;
        return 'success';
      }
    });
    
    const runner = new SandboxRunner();
    await assert.rejects(
      runner.run({ 
        script: 'callTool("restricted-tool", {})',
        toolRegistry: registry
      }),
      /Permission denied/
    );
    assert.strictEqual(executed, false, 'Tool must not execute when permission is denied via callTool');
  });
});
