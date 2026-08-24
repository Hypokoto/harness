# Benchmarking Methodology

## Goal
Quantify the explicit performance cost of the security invariants codified in the Threat Model and Final Assessment. Instead of general execution profiling, this benchmarking suite specifically measures overhead directly attributable to zero-trust safety constraints (authorization checks, structural validations, and event boundary marshalling).

## Measurement Approach
All benchmarks operate by establishing a baseline "insecure/unchecked" proxy implementation, comparing execution times and resource consumption against the hardened Harness runtime paths.

### 1. `registry.bench.ts`
- **Target:** `ToolRegistry.execute()`
- **Measurement:** Latency injected by asynchronous `PermissionDecision` dispatch and post-yield identity reverifications (TOCTOU mitigations). Concurrent throughput under heavy authorization lock contention.

### 2. `mcp-validation.bench.ts`
- **Target:** `McpTool` `normalizeResult` limits.
- **Measurement:** Throughput drops caused by schema validation, 20-level max depth walks, and 5MB string size validations on large, small, deeply nested, and structurally malformed JSON-RPC boundaries. Memory bounds (V8 heap) and operation latency percentiles (p50, p95, p99).

### 3. `event-store.bench.ts` & `replay.bench.ts`
- **Target:** `EventStore` persistence and `Session.replay` state reconstruction.
- **Measurement:** Append rates per second, fail-closed JSON syntax validation costs, and most crucially: big-O complexity scaling of state replay as the event sequence grows exponentially (1K, 10K, 100K, 1M).

### 4. `red-team-overhead.bench.ts`
- **Target:** Aggregate infrastructure overhead (AgentLoop wrapping).
- **Measurement:** Simulating normal application traffic vs Phase 14 aggressive fuzzer loads. We measure CPU cycles, RSS variations, Event-Loop lag (using `perf_hooks`), and V8 Garbage Collection pressure under adversarial attack conditions compared to resting conditions.
