import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Session } from '../../packages/agent/src/session.js';
import { EventStore } from '../../packages/events/src/event-store.js';

async function runBench() {
  console.log('--- Replay Scaling Benchmark (Large) ---');
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-bench-replay-'));
  const store = new EventStore(tmpDir);

  const eventCounts = [10000, 100000, 500000, 1000000];
  
  for (const count of eventCounts) {
    const sessionId = `bench-session-${count}`;
    
    // Seed events efficiently
    const logFile = path.join(tmpDir, `${sessionId}.jsonl`);
    const fd = await fs.open(logFile, 'w');
    const batchSize = 10000;
    
    let buffer = '';
    for (let i = 0; i < count; i++) {
      const evt = {
        id: `evt-${i}`,
        type: i % 2 === 0 ? 'tool.called' : 'tool.completed',
        timestamp: Date.now(),
        sequence: i,
        sessionId,
        payload: { toolCallId: `call-${Math.floor(i/2)}`, toolName: 'bench', result: i % 2 === 0 ? undefined : 'ok' }
      };
      buffer += JSON.stringify(evt) + '\n';
      
      if (i % batchSize === 0 || i === count - 1) {
        await fd.write(buffer);
        buffer = '';
      }
    }
    await fd.close();
    
    const startMemory = process.memoryUsage().heapUsed;
    let start = performance.now();
    
    await Session.replay(sessionId, store);
    
    let end = performance.now();
    const endMemory = process.memoryUsage().heapUsed;
    
    const replayTime = end - start;
    const memConsumedMB = (endMemory - startMemory) / 1024 / 1024;
    
    console.log(`\nReplay Event Count: ${count}`);
    console.log(`State Reconstruction Time: ${replayTime.toFixed(2)}ms (${(replayTime / count).toFixed(4)}ms per event)`);
    console.log(`Memory Consumed: ${memConsumedMB.toFixed(2)} MB`);
  }
}

runBench().catch(console.error);
