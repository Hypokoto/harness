import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Session } from '../../packages/agent/src/session.js';
import { EventStore } from '../../packages/events/src/event-store.js';

async function runBench() {
  console.log('--- Replay Scaling Benchmark ---');
  
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-bench-replay-'));
  const store = new EventStore(tmpDir);

  const eventCounts = [100, 1000, 10000];
  
  for (const count of eventCounts) {
    const sessionId = `bench-session-${count}`;
    
    // Seed events
    for (let i = 0; i < count; i++) {
      await store.append({
        id: `evt-${i}`,
        type: i % 2 === 0 ? 'tool.called' : 'tool.completed',
        timestamp: Date.now(),
        sessionId,
        payload: { toolCallId: `call-${Math.floor(i/2)}`, toolName: 'bench', result: i % 2 === 0 ? undefined : 'ok' }
      });
    }
    
    // 1. Replay Benchmark
    let start = performance.now();
    await Session.replay(sessionId, store);
    let end = performance.now();
    const replayTime = end - start;
    
    console.log(`\nReplay Event Count: ${count}`);
    console.log(`State Reconstruction Time: ${replayTime.toFixed(2)}ms (${(replayTime / count).toFixed(4)}ms per event)`);
  }
}

runBench().catch(console.error);
