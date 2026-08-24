# Phase 11: Event Ordering & Transactional Integrity Report

## Objective
Establish a formal invariant where security-relevant state may only be derived from authenticated, ordered, schema-valid events whose producer is authorized to emit them. Ambiguous or corrupted event histories must explicitly fail closed rather than risk insecure state reconstruction.

## Attack Vectors Tested and Bounded

### 1. Event Reordering & Sequence-Number Attacks
**Vulnerability:** 
Transport anomalies, intentional tampering, or replay delays could cause events like `AUTHORIZE`, `EXECUTE`, and `REVOKE` to be persisted or replayed out-of-order, potentially resulting in authorization being interpreted in an unintended state (e.g. executing after a revocation).

**Resolution:**
The `EventStore` enforces strict monotonicity. Sequences MUST increment linearly per session. `store.append()` strictly validates that the incoming sequence matches the expected next sequence `(lastSeq + 1)`. If an out-of-order or skipped sequence is detected during persistence or reading (with `validateSequences: true`), it throws a `SequenceError` and explicitly fails closed.

### 2. Duplicate Events
**Vulnerability:**
Replaying or persisting duplicate events (e.g., duplicated `execute` or `authorize` triggers).

**Resolution:**
The monotonic sequence validation naturally catches duplicated events because the sequence numbers collide. Furthermore, `Session.replay()` is strict; receiving a duplicate `generation.started` or `tool.completed` event causes an immediate structural failure, preventing idempotency vulnerabilities.

### 3. Cross-Session Contamination
**Vulnerability:**
Capability grants or execution histories from `Session A` bleeding into or authorizing actions for `Session B`.

**Resolution:**
The `EventStore` provides absolute physical isolation per-session (separate `.jsonl` logs unless specified otherwise). Furthermore, every single event envelope is structurally bound to a `sessionId`. If an attacker attempts to spoof a session ID by injecting an event for `Session B` into `Session A`'s log file, the `EventStore.read()` scanner detects the session mismatch and throws an `EventCorruptedError`, failing the load entirely.

### 4. Crash Between Security Events (Commit Points)
**Vulnerability:**
Process crash after an authorization is granted in-memory but before it's persisted, or between a tool call starting and finishing.

**Resolution:**
The system establishes the `EventStore` on disk as the ultimate authoritative state, bypassing transient memory entirely upon restart. A crash after a tool starts executing will truncate the log at `tool.called`. Upon replay, the `Session` reconstructs to the exact point of the crash (with the tool still in `activeToolCalls`). Since the state machine is validated linearly from disk, no spurious or unauthorized execution paths emerge from torn transactions. 

### 5. Event Injection (Unauthenticated Producers)
**Vulnerability:**
MCP plugins producing and injecting core framework events (like `permission.allowed`) to spoof authorization.

**Resolution:**
The architecture perfectly encapsulates the plugin layer. MCP plugins run out-of-process and communicate exclusively via JSON-RPC. There is no `EventBus` or Event API exposed to them. If a malicious plugin attempts to return a perfectly formatted `EventEnvelope` as a tool result, the `AgentLoop` blindly wraps it inside the `payload.result` property of a `tool.completed` event. The injection is safely isolated in the payload wrapper, rendering it structurally impossible for it to become an authoritative top-level system event.

## Formal Security Invariant Proven
> **Security-relevant state may only be derived from authenticated, ordered, schema-valid events whose producer is authorized to emit that event, and ambiguous or corrupted event histories must fail closed.**

All Phase 11 adversarial tests passed successfully, validating this invariant across all layers (MCP Transport → Schema → Authorization → ToolRegistry → Event Ordering → Persistence).

The environment is now ready for **Phase 12: Cross-boundary Attack Chains**.
