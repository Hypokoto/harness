# Security Benchmarking Baseline

## Overview
This report quantifies the exact performance cost of the zero-trust security boundaries implemented in the Harness Agent Runtime. The focus is to map the formalized invariants (Authorization, MCP payload constraint, Event Replay scaling) to their raw V8 execution overhead and disk bounds.

## Benchmark Results

### 1. Authorization & Execution Chokepoint (`ToolRegistry.execute`)
**Objective:** Measure the latency introduced by capability evaluation and post-yield TOCTOU identity reverification.
- **Insecure Execution Baseline:** ~6,424,313 ops/sec
- **Secure Execution (Auth + TOCTOU Active):** ~52,969 ops/sec
- **Overhead:** +12,028%
- **Analysis:** While the relative percentage increase is massive, the absolute latency is extremely favorable. The runtime can process nearly 53,000 fully authorized and TOCTOU-protected executions per second per core. This is orders of magnitude faster than the LLM inference loop triggering these tools.

### 2. MCP Transport Boundary Validation
**Objective:** Measure the CPU cost of the 20-level depth max check and 5MB payload size validation on untrusted plugin data.
- **Small Payload Overhead:** +3,002% (0.43ms insecure $\rightarrow$ 13.49ms secure for 10K operations).
- **Large Payload (2MB text) Validation:** ~7.29ms per operation.
- **Deeply Nested Payload Rejection:** ~0.03ms per rejected operation.
- **Analysis:** Validation is structurally sound. Deeply nested payloads fail incredibly fast (0.03ms), protecting the V8 call stack. Processing a near-limit payload (2MB) introduces roughly 7 milliseconds of latency, which is an acceptable cost for absolute heap memory protection.

### 3. EventStore & Replay Complexity Scaling
**Objective:** Confirm that strict structural validation and recovery determinism does not introduce $O(n^2)$ time complexity into session reboots.
- **Append Latency:** ~788 ops/sec (Bounded strictly by local filesystem `fs.appendFile` IO limits).
- **Log Read Latency:** ~394,955 ops/sec.
- **State Machine Replay (10,000 events):** 25.82ms total (0.0026ms per event).
- **Analysis:** Replay time scales linearly at roughly 2 microseconds per event. A massively long-lived session containing 1 million events would recover completely in ~2.6 seconds. The invariant verification creates no polynomial traps.

### 4. Red-Team Adversarial Fuzzer Overhead
**Objective:** Evaluate if continuous malicious capability swapping and TOCTOU collision attacks degrade overall runtime throughput compared to normal linear usage.
- **Linear Workload (2000 ops):** 20.10ms
- **Adversarial Thrashing Workload (2000 ops):** 6.03ms
- **Analysis:** Counter-intuitively, the adversarial workload completes *faster* (-70% execution time). This happens because the authorization engine fails-closed aggressively; malicious mutations and unauthorized invocations hit fast-path exceptions and short-circuit immediately, preventing execution overhead. The system is highly efficient under attack.

## Summary & Answers
**What does the harness trust?**
Nothing outside its own local heap and EventStore ledgers. MCP data and Tool behaviors are actively distrusted.

**What can an attacker control?**
The content of JSON-RPC plugin responses (up to 5MB, 20 levels deep) and the timing of asynchronous resolutions.

**What invariants prevent escalation?**
Capability mathematical intersections (Zero-trust Execution), strict TOCTOU reverifications, and Fail-Closed state persistency.

**What evidence demonstrates those invariants?**
The Phase 14 property-based state fuzzers (yielding 0 authorization breaches) and the Phase 13 I/O failure injection recovery validations.

**What remains unproven?**
Distributed memory contention bounds scaling over tens of thousands of horizontally concurrent sessions sharing a non-local `EventStore` interface.
