import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Session } from '../../packages/agent/src/session.js';
import { EventStore } from '../../packages/events/src/event-store.js';
import { ToolRegistry } from '../../packages/tools/src/registry.js';
import { EventBus } from '../../packages/events/src/event-bus.js';
import { StaticCapabilityPolicy } from '../../packages/permissions/src/static-policy.js';

async function runBench() {
  console.log('--- Fuzzer/Overhead Benchmark ---');
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-bench-fuzz-'));
  
  const ITERATIONS = 100;
  const MAX_STEPS = 20;
  
  const createTool = (name: string, required: string[]) => ({
    name,
    description: 'Fuzz tool',
    inputSchema: { type: 'object', properties: {} },
    requiredCapabilities: required,
    execute: async () => 'success'
  });

  // 1. Normal Workload (Linear Execution)
  let start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const store = new EventStore(tmpDir);
    const bus = new EventBus();
    const registry = new ToolRegistry({ eventBus: bus });
    registry.setPolicy(new StaticCapabilityPolicy(['fs.read']));
    registry.register(createTool('tool', ['fs.read']));
    
    for (let step = 0; step < MAX_STEPS; step++) {
      await registry.execute('tool', {});
    }
  }
  let end = performance.now();
  const normalTime = end - start;

  // 2. Adversarial Workload (Fuzzer Phase 14 Style)
  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const store = new EventStore(tmpDir);
    const bus = new EventBus();
    const registry = new ToolRegistry({ eventBus: bus });
    const capabilities = ['fs.read', 'db.write', 'admin.shell'];
    registry.setPolicy(new StaticCapabilityPolicy(capabilities)); // Grant all for execution
    
    bus.onAny(async (event) => {
      if (event.type === 'permission.allowed') {
        const toolName = event.payload.toolName as string;
        if (registry.has(toolName)) {
           try {
             registry.replace(toolName, createTool(toolName, ['admin.shell']));
           } catch (e) {}
        }
      }
    });

    let pendingExecutions: Promise<any>[] = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const action = Math.floor(Math.random() * 3); // Limit to Register, Execute, Replace
      try {
        switch (action) {
          case 0:
            registry.register(createTool(`tool-${step}`, [capabilities[Math.floor(Math.random() * capabilities.length)]]));
            break;
          case 1:
            const tools = ['tool-0', 'tool-1', 'tool-2'];
            const target = tools[Math.floor(Math.random() * tools.length)];
            if (registry.has(target)) {
              pendingExecutions.push(registry.execute(target, {}).catch(e => {}));
            }
            break;
          case 2:
            const existing = ['tool-0', 'tool-1', 'tool-2'];
            const toReplace = existing[Math.floor(Math.random() * existing.length)];
            if (registry.has(toReplace)) {
               registry.replace(toReplace, createTool(toReplace, ['admin.shell']));
            }
            break;
        }
      } catch (err) {}
    }
    await Promise.allSettled(pendingExecutions);
  }
  end = performance.now();
  const adversarialTime = end - start;

  console.log(`Normal Linear Workload (${ITERATIONS * MAX_STEPS} ops): ${normalTime.toFixed(2)}ms`);
  console.log(`Adversarial Fuzz Workload (${ITERATIONS * MAX_STEPS} random ops): ${adversarialTime.toFixed(2)}ms`);
  
  const overhead = ((adversarialTime - normalTime) / normalTime) * 100;
  console.log(`State-Machine Thrashing Penalty: +${overhead.toFixed(2)}%`);
}

runBench().catch(console.error);
