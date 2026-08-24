import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventStore } from '../../packages/events/src/event-store.js';

async function runBench() {
  console.log('--- EventStore Benchmark ---');
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-bench-store-'));
  const store = new EventStore(tmpDir);
  const sessionId = 'bench-session';
  const logFile = path.join(tmpDir, `${sessionId}.jsonl`);

  const eventCounts = [1000, 10000, 50000];
  
  for (const count of eventCounts) {
    // 1. Append Benchmark
    let start = performance.now();
    for (let i = 0; i < count; i++) {
      await store.append({
        id: `evt-${i}`,
        type: 'tool.called',
        timestamp: Date.now(),
        sessionId,
        payload: { toolCallId: `call-${i}`, toolName: 'bench' }
      });
    }
    let end = performance.now();
    const appendTime = end - start;
    
    // 2. Read (Replay) Benchmark
    start = performance.now();
    const events = await store.read(sessionId);
    end = performance.now();
    const readTime = end - start;
    
    console.log(`\nEvent Count: ${count}`);
    console.log(`Append Time: ${appendTime.toFixed(2)}ms (${Math.floor(count / (appendTime / 1000))} ops/sec)`);
    console.log(`Read Time: ${readTime.toFixed(2)}ms (${Math.floor(count / (readTime / 1000))} ops/sec)`);
    
    // Cleanup for next loop
    await fs.unlink(logFile);
  }
}

runBench().catch(console.error);
