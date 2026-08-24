# Phase 8 — Permission Security Report

## Authoritative Chokepoint
`ToolRegistry.execute()` is definitively the single authoritative chokepoint. 
The permission invariant strictly surrounds the `tool.execute()` call. Any request arriving from the model, TUI, CLI, headless pipeline, or an external MCP connection MUST invoke `ToolRegistry.execute()`. This design prevents accidental execution pathways since tools are not exposed as raw functions to external subsystems.

## Capability Canonicalization
PASS WITH FIXES
* Defect: `parseCapability()` stripped whitespace but did not canonicalize case, meaning a policy granting `filesystem.read` would reject `FILESYSTEM.READ`, or conversely, a case mismatch could bypass exact-match lookups in a flawed Set.
* Fix: Augmented `parseCapability()` to enforce `toLowerCase()` canonicalization alongside structural structural `<domain>.<action>` requirements.

## Fail-Closed Behavior
PASS
Unknown, null, empty, malformed, and unrecognized capabilities reliably trigger `TypeError` upstream during parsing, meaning malformed capability requests fail closed long before execution is attempted. Unknown valid-format capabilities (e.g., `alien.tech`) are correctly rejected with `PermissionDeniedError` by default.

## Policy Isolation
PASS
`StaticCapabilityPolicy` enforces exact strict equality. A grant of `filesystem.read` does not bleed into `filesystem.write`. 

## Session / Project Isolation
PASS
Different `ToolRegistry` instances manage distinct configurations. `PermissionPolicy` is explicitly injected at the execution boundary rather than statically cached globally, ensuring concurrent execution pipelines respect distinct isolation levels.

## TUI, CLI, Headless, MCP Isolation
PASS
Because all of these UI and transport components rely on retrieving and calling the context engine tools via `ToolRegistry.execute()`, they inherit the chokepoint implicitly. `ToolRegistry` does not differentiate transport methods, neutralizing bypass attempts.

## Plugin Worker Isolation & IPC Security
PASS
Host-side proxy tools (which wrap IPC calls to sandbox workers) declare their capabilities to the Host's `ToolRegistry`. The capability check happens on the Host *before* the IPC command is ever dispatched to the worker. Furthermore, if a Malicious Worker attempts an unsolicited IPC callback to execute a tool, the Host's message listener routes that request through `ToolRegistry.execute()`, instantly rejecting ungranted escalation.

## Replay Security
PASS
Replaying the raw `.harness.toml` session injects event data via `Session.replay()`, which is entirely observational (state reconstruction) as verified in Phase 5. Replayed `permission.granted` events are purely historical logs and do not mutate the current `PermissionPolicy`.

## Abort Semantics
PASS
Because the authorization check synchronously precedes the `Promise.race([tool.execute(...), timeout])` block, an abort triggered right before execution halts the chain cleanly.

## Concurrent Policy Changes
PASS
Because `decision` is evaluated synchronously using the current snapshot of `policy.check()`, concurrent mutations cannot create undefined half-states. Execution utilizes a complete, point-in-time security decision.

## State Corruption
NONE FOUND
Capabilities are deeply verified at execution time rather than statically at discovery time, eliminating cache corruption. 

## Permission Escalation
NONE FOUND
Metadata spoofing (e.g., declaring `requiredCapabilities: []` but trying to write a file) is prevented at the OS sandbox level, not the permission framework level. The architecture correctly documents this limitation.

## Bypass Paths
NONE FOUND

## Defects & Fixes
- **Defect**: Case-sensitive capability mismatch allowed unpredictable behaviors.
- **Fix**: Added strict `.toLowerCase()` canonicalization to `parseCapability()`.
- **Defect**: Namespace confusion allowed ambiguous `filesystem` to be granted.
- **Fix**: `parseCapability()` structurally guarantees the `<domain>.<action>` format containing at least one dot operator.

## Architectural Limitations
The `PermissionPolicy` proves semantic intent: "The harness allows tool X to perform capability Y." It **does NOT** guarantee OS-level enforcement. If a tool claims `[]` capabilities but contains malicious JavaScript to delete `~/.ssh`, the semantic layer will approve it. The OS Sandboxing (Worker / Deno layer) is required to physically restrict the process. This distinction is strictly maintained.

## Verdict
**PASS WITH FIXES**

The capability authorization framework correctly isolates semantic permission decisions from discovery, ensuring that an execution can only succeed if actively granted by the authoritative configuration at runtime. Ready for Phase 9!
