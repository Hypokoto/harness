import { performance } from 'node:perf_hooks';
import { ToolRegistry } from '../../packages/tools/src/registry.js';
import { StaticCapabilityPolicy } from '../../packages/permissions/src/static-policy.js';

async function runBench() {
  console.log('--- Registry Benchmark ---');
  
  const registrySecure = new ToolRegistry();
  // We mock the event bus to simulate authorization checks and TOCTOU defense active
  registrySecure.eventBus = {
    emitPermissionEvent: async () => { /* simulate async yield */ }
  } as any;
  registrySecure.setPolicy(new StaticCapabilityPolicy(['admin.shell']));
  registrySecure.register({
    name: 'shell',
    description: 'test shell',
    inputSchema: { type: 'object', properties: {} },
    requiredCapabilities: ['admin.shell'],
    execute: async () => 'ok'
  });

  // Mock insecure registry (bypasses auth and event bus)
  const registryInsecure = new ToolRegistry();
  registryInsecure.setPolicy(new StaticCapabilityPolicy(['admin.shell']));
  registryInsecure.register({
    name: 'shell',
    description: 'test shell',
    inputSchema: { type: 'object', properties: {} },
    requiredCapabilities: [],
    execute: async () => 'ok'
  });

  const ITERATIONS = 100000;

  // 1. Insecure execution baseline
  let start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await registryInsecure.get('shell')!.execute({}, {});
  }
  let end = performance.now();
  const insecureTime = end - start;

  // 2. Secure execution baseline
  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await registrySecure.execute('shell', {});
  }
  end = performance.now();
  const secureTime = end - start;

  console.log(`Insecure Execution: ${insecureTime.toFixed(2)}ms (${Math.floor(ITERATIONS / (insecureTime / 1000))} ops/sec)`);
  console.log(`Secure Execution (with auth & TOCTOU checks): ${secureTime.toFixed(2)}ms (${Math.floor(ITERATIONS / (secureTime / 1000))} ops/sec)`);
  
  const overhead = ((secureTime - insecureTime) / insecureTime) * 100;
  console.log(`Authorization & Identity Verification Overhead: +${overhead.toFixed(2)}%`);
}

runBench().catch(console.error);
