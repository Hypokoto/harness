# Security Invariants

These invariants define the absolute truth properties that must be preserved unconditionally by the Harness Runtime across all boundary executions, failures, and replays.

## 1. Zero-Trust Tool Execution
An unknown, unregistered, or unauthorized tool must yield **NO privilege** and **NO unauthorized execution**. Tools execute only if their required capabilities mathematically intersect with the active granted policy at the exact microsecond of invocation dispatch.

## 2. Recovery Determinism
**Same committed event log $\rightarrow$ Same reconstructed state.**
Truncated, reordered, or structurally corrupt event streams must trigger an absolute fail-closed state abort (preferring unavailability over inconsistency), yielding no phantom privilege escalations. 

## 3. No Phantom Execution
A worker process or tool invocation that crashed before yielding execution side effects must not appear as "successfully executed" upon state recovery. Unresolved executions default to `PENDING`.

## 4. No Phantom Authorization
An authorization verification that successfully completed in-memory but failed to reach its durable commit point (due to I/O disruption) must not be rendered authoritative upon system restart.

## 5. Destructive Operation Safety
**No duplicate irreversible execution.**
If an asynchronous worker completes a destructive operation (e.g. `db.drop`) but the process crashes before the `tool.completed` event is flushed to the ledger, recovery must flag the action as `PENDING`, explicitly demanding higher-level human or system resolution instead of automatically invoking a hazardous retry loop.

## 6. Monotonic Context Integrity
MCP context inputs and capability metadata must serialize stably across all network and execution channels, bounded in size and structural nesting, ensuring context buffers can never overflow the orchestrating Node.js heap architecture.
