import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CircularPluginDependencyError,
  Kernel,
  MissingPluginDependencyError,
  PluginLifecycleError,
  UnknownServiceError,
} from './index.js';
import type { Plugin } from './index.js';

describe('Kernel Phase 1', () => {
  // TEST 1 — Register + resolve
  it('TEST 1: should register plugin and allow registering and resolving service', async () => {
    const kernel = new Kernel();
    const testService = { name: 'dummy-service', value: 42 };

    const dummyPlugin: Plugin = {
      name: 'dummy-plugin',
      setup(ctx) {
        ctx.registerService('test-service', testService);
      },
    };

    kernel.registerPlugin(dummyPlugin);
    await kernel.start();

    assert.equal(kernel.hasService('test-service'), true);
    const resolved = kernel.resolveService<typeof testService>('test-service');
    assert.deepEqual(resolved, testService);

    await kernel.stop();
  });

  // TEST 2 — Missing service
  it('TEST 2: resolving an unknown service must throw a clear error', () => {
    const kernel = new Kernel();

    assert.throws(
      () => {
        kernel.resolveService('unknown-service');
      },
      (err: unknown) => {
        assert(err instanceof UnknownServiceError);
        assert.equal(err.message, 'Service "unknown-service" is not registered.');
        return true;
      },
    );
  });

  // TEST 3 — Dependency ordering
  it('TEST 3: should execute lifecycle hooks in correct dependency order (C -> B -> A for setup/start, A -> B -> C for stop)', async () => {
    const executionLog: string[] = [];
    const kernel = new Kernel();

    // A depends on B
    const pluginA: Plugin = {
      name: 'plugin-a',
      dependencies: ['plugin-b'],
      setup() {
        executionLog.push('setup:A');
      },
      start() {
        executionLog.push('start:A');
      },
      stop() {
        executionLog.push('stop:A');
      },
    };

    // B depends on C
    const pluginB: Plugin = {
      name: 'plugin-b',
      dependencies: ['plugin-c'],
      setup() {
        executionLog.push('setup:B');
      },
      start() {
        executionLog.push('start:B');
      },
      stop() {
        executionLog.push('stop:B');
      },
    };

    // C has no dependencies
    const pluginC: Plugin = {
      name: 'plugin-c',
      setup() {
        executionLog.push('setup:C');
      },
      start() {
        executionLog.push('start:C');
      },
      stop() {
        executionLog.push('stop:C');
      },
    };

    // Register in arbitrary order
    kernel.registerPlugin(pluginA);
    kernel.registerPlugin(pluginC);
    kernel.registerPlugin(pluginB);

    await kernel.start();
    assert.deepEqual(executionLog, [
      'setup:C',
      'setup:B',
      'setup:A',
      'start:C',
      'start:B',
      'start:A',
    ]);

    executionLog.length = 0;
    await kernel.stop();
    assert.deepEqual(executionLog, ['stop:A', 'stop:B', 'stop:C']);
  });

  // TEST 4 — Missing dependency
  it('TEST 4: a plugin depending on a nonexistent plugin must fail during startup', async () => {
    const kernel = new Kernel();

    const pluginAgent: Plugin = {
      name: 'agent',
      dependencies: ['model'],
    };

    kernel.registerPlugin(pluginAgent);

    await assert.rejects(
      async () => {
        await kernel.start();
      },
      (err: unknown) => {
        assert(err instanceof MissingPluginDependencyError);
        assert.equal(err.message, 'Plugin "agent" depends on missing plugin "model".');
        return true;
      },
    );
  });

  // TEST 5 — Circular dependency
  it('TEST 5: circular plugin dependencies must fail during startup with a useful error', async () => {
    const kernel = new Kernel();

    const pluginA: Plugin = {
      name: 'A',
      dependencies: ['B'],
    };

    const pluginB: Plugin = {
      name: 'B',
      dependencies: ['A'],
    };

    kernel.registerPlugin(pluginA);
    kernel.registerPlugin(pluginB);

    await assert.rejects(
      async () => {
        await kernel.start();
      },
      (err: unknown) => {
        assert(err instanceof CircularPluginDependencyError);
        assert(err.message.includes('Circular plugin dependency detected'));
        assert(err.message.includes('A -> B -> A') || err.message.includes('B -> A -> B'));
        return true;
      },
    );
  });

  // TEST 6 — Start failure cleanup
  it('TEST 6: if a plugin fails during start, previously-started plugins must be stopped in reverse order', async () => {
    const stoppedPlugins: string[] = [];
    const kernel = new Kernel();

    const pluginA: Plugin = {
      name: 'plugin-a',
      start() {
        // Successful start
      },
      stop() {
        stoppedPlugins.push('plugin-a');
      },
    };

    const pluginB: Plugin = {
      name: 'plugin-b',
      dependencies: ['plugin-a'],
      start() {
        throw new Error('Start failed in plugin-b');
      },
      stop() {
        stoppedPlugins.push('plugin-b');
      },
    };

    kernel.registerPlugin(pluginA);
    kernel.registerPlugin(pluginB);

    await assert.rejects(
      async () => {
        await kernel.start();
      },
      (err: unknown) => {
        assert(err instanceof PluginLifecycleError);
        assert.equal(err.pluginName, 'plugin-b');
        assert.equal(err.stage, 'start');
        return true;
      },
    );

    // plugin-a was started before plugin-b failed, so plugin-a must be stopped during rollback
    assert.deepEqual(stoppedPlugins, ['plugin-a']);
    assert.equal(kernel.getState(), 'stopped');
  });

  // TEST 7 — Stop failure isolation
  it('TEST 7: if one plugin throws during stop, other plugins must still receive stop()', async () => {
    const stoppedPlugins: string[] = [];
    const kernel = new Kernel();

    // A depends on B (start order: B, A; stop order: A, B)
    const pluginA: Plugin = {
      name: 'plugin-a',
      dependencies: ['plugin-b'],
      stop() {
        stoppedPlugins.push('plugin-a');
        throw new Error('Stop failed in plugin-a');
      },
    };

    const pluginB: Plugin = {
      name: 'plugin-b',
      stop() {
        stoppedPlugins.push('plugin-b');
      },
    };

    kernel.registerPlugin(pluginA);
    kernel.registerPlugin(pluginB);

    await kernel.start();

    await assert.rejects(
      async () => {
        await kernel.stop();
      },
      (err: unknown) => {
        assert(err instanceof PluginLifecycleError);
        assert.equal(err.pluginName, 'plugin-a');
        assert.equal(err.stage, 'stop');
        return true;
      },
    );

    // Even though plugin-a threw during stop, plugin-b must still have been stopped!
    assert.deepEqual(stoppedPlugins, ['plugin-a', 'plugin-b']);
    assert.equal(kernel.getState(), 'stopped');
  });
});
