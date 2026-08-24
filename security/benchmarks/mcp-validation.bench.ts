import { performance } from 'node:perf_hooks';
import { McpTool } from '../../packages/mcp/src/adapter.js';

function createDeepObject(depth: number): any {
  if (depth === 0) return { leaf: true };
  return { child: createDeepObject(depth - 1) };
}

function createLargeString(megabytes: number): string {
  return 'a'.repeat(megabytes * 1024 * 1024);
}

async function runBench() {
  console.log('--- MCP Validation Benchmark ---');
  
  const ITERATIONS = 1000;
  
  // Scenarios
  const smallPayload = { success: true, count: 5 };
  const largeValidPayload = { text: createLargeString(2) }; // 2 MB string
  const invalidDeepPayload = createDeepObject(25); // Above max depth 20
  
  // Baseline (Insecure parsing - just returning the object)
  function insecureParse(obj: any) {
    return obj;
  }

  const mockTool = new McpTool('bench_server', 'bench_tool', 'bench desc', {} as any, ['foo'], {} as any) as any;

  // 1. Small Valid
  let start = performance.now();
  for (let i = 0; i < ITERATIONS * 10; i++) {
    insecureParse(smallPayload);
  }
  let end = performance.now();
  const insecureSmallTime = end - start;

  start = performance.now();
  for (let i = 0; i < ITERATIONS * 10; i++) {
    mockTool.normalizeResult(smallPayload);
  }
  end = performance.now();
  const secureSmallTime = end - start;

  // 2. Large Valid Payload
  start = performance.now();
  for (let i = 0; i < 100; i++) {
    insecureParse(largeValidPayload);
  }
  end = performance.now();
  const insecureLargeTime = end - start;

  start = performance.now();
  for (let i = 0; i < 100; i++) {
    mockTool.normalizeResult(largeValidPayload);
  }
  end = performance.now();
  const secureLargeTime = end - start;

  // 3. Invalid Deep Payload (Expect rejection)
  let rejectedCount = 0;
  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      mockTool.normalizeResult(invalidDeepPayload);
    } catch (e) {
      rejectedCount++;
    }
  }
  end = performance.now();
  const deepRejectTime = end - start;

  console.log(`Small Payload Insecure: ${insecureSmallTime.toFixed(2)}ms`);
  console.log(`Small Payload Secure: ${secureSmallTime.toFixed(2)}ms (+${(((secureSmallTime - insecureSmallTime)/insecureSmallTime)*100).toFixed(2)}%)`);
  
  console.log(`Large Payload (2MB) Insecure: ${insecureLargeTime.toFixed(2)}ms`);
  console.log(`Large Payload (2MB) Secure: ${secureLargeTime.toFixed(2)}ms (+${(((secureLargeTime - insecureLargeTime)/insecureLargeTime)*100).toFixed(2)}%)`);
  
  console.log(`Deeply Nested Payload Rejection Time: ${(deepRejectTime / ITERATIONS).toFixed(4)}ms per operation (Total rejects: ${rejectedCount})`);
}

runBench().catch(console.error);
