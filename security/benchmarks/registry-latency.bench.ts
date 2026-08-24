import { performance } from 'node:perf_hooks';
import { ToolRegistry } from '../../packages/tools/src/registry.js';
import { StaticCapabilityPolicy } from '../../packages/permissions/src/static-policy.js';

async function runBench() {
  console.log('--- Registry Latency Benchmark (p50/p95/p99) ---');
  
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

  const ITERATIONS = 10000;
  const latencies = new Float64Array(ITERATIONS);

  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await registrySecure.execute('shell', {});
    const end = performance.now();
    latencies[i] = end - start;
  }

  latencies.sort();

  const p50 = latencies[Math.floor(ITERATIONS * 0.50)];
  const p95 = latencies[Math.floor(ITERATIONS * 0.95)];
  const p99 = latencies[Math.floor(ITERATIONS * 0.99)];

  console.log(`Tool Authorization Overhead Latency:`);
  console.log(`p50: ${p50.toFixed(4)} ms`);
  console.log(`p95: ${p95.toFixed(4)} ms`);
  console.log(`p99: ${p99.toFixed(4)} ms`);
}

runBench().catch(console.error);
