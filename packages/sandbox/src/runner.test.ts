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
});
