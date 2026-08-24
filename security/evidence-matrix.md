# Security Evidence Matrix

| Invariant | Enforcement | Attack | Evidence | Result | Residual risk |
|---|---|---|---|---|---|
| Unauthorized tools cannot execute | `ToolRegistry.execute()` | Capability mutation | Phase 8/14 | 0 violations | None observed |
| Stale tools cannot execute | Registry identity check | TOCTOU swap | Phase 10/12/14 | Blocked | None observed |
| MCP data cannot become events | AgentLoop wrapping | Forged event envelope | Phase 12 | Isolated | None observed |
| Corrupt history cannot create authority | `EventStore` + replay | Reordered/truncated events | Phase 11/13/14 | Fail closed | Recovery semantics |
| Destructive unknown outcomes aren't retried | Pending state | Crash after side effect | Phase 13 | Pending | Manual resolution |
| MCP result cannot exceed configured boundary | `normalizeResult()` | Large payload | Phase 9/14 | Rejected/bounded | Aggregate resource testing |
