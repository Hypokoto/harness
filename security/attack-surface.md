# Attack Surface

The Harness Runtime is exposed to various attack surfaces originating from user configurations, external plugins, and runtime infrastructure vulnerabilities.

## 1. Plugin Configuration & Registration (`.harness.toml`)
- **Vectors:** Malicious overrides hijacking profile namespaces, duplicate capability declarations, or unsafe plugin URL registrations.
- **Defenses:** Strict canonical parsing, fallback isolation, and hard failure blocks on colliding `ToolIndex` identities.

## 2. MCP JSON-RPC Streaming
- **Vectors:** Gigantic payloads intended to trigger OOM (Out-of-Memory), deeply nested cyclic JSON meant to crash the call stack, or malformed schema returns.
- **Defenses:** The `normalizeResult()` layer enforcing 20-level max depth and 5MB payload chunk barriers prior to internal `AgentLoop` state hydration.

## 3. Concurrency & Execution Queues
- **Vectors:** Race conditions exploiting TOCTOU (Time-Of-Check to Time-Of-Use) windows across asynchronous yields during authorization workflows (`emitPermissionEvent()`).
- **Defenses:** Explicit re-validation of tool identities and granted policies immediately following any asynchronous yield prior to physical dispatch.

## 4. State Reconstruction (Replay Engine)
- **Vectors:** Truncated JSON logs caused by IO interruptions, event sequence re-ordering, or fake state-event injections nested inside tool results.
- **Defenses:** Line-by-line strict `JSON.parse` evaluations providing syntactical guarantees on integrity. Safe transaction rollbacks resolving incomplete executions as `PENDING` states rather than blind automatic retries.

## 5. Memory & Process Lifecycle
- **Vectors:** Mass concurrency attacks attempting to lock V8 event-loops via heavy CPU serialization requirements across $N$ async plugin executions.
- **Defenses:** Optimized string payload isolations and degraded execution handling during local I/O store failures.
