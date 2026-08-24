# Threat Model

## Actors & Roles
- **Untrusted MCP Plugins:** External binaries, scripts, or network endpoints invoked via standard IO/RPC providing tools, resources, or prompts.
- **Agent Loop / LLM:** The logic engine orchestrating tasks, potentially guided by adversarial prompts (Prompt Injection) or external malicious data.
- **Harness Core (Trusted):** The central state machine, event store, configuration resolver, and permission registry managing interactions between plugins, the agent, and the local system.

## Key Threat Vectors

### 1. Identity Spoofing & Canonicalization
*Threat:* An attacker attempts to exploit naming ambiguities (case variations, Unicode normalization) to hijack a trusted tool identity (e.g. replacing `admin.shell` with `admin.shéll`).
*Mitigation:* Strict, case-sensitive binary string equivalence required across discovery, registry, authorization, and event log boundaries.

### 2. Time-of-Check to Time-of-Use (TOCTOU)
*Threat:* Exploiting the asynchronous yield during event emission (such as logging an authorization) to swap out a tool's underlying execution logic or state before the execution promise resolves.
*Mitigation:* Absolute identity and reference tracking. Re-verification of capability policies immediately following any asynchronous yield prior to `callTool` dispatch.

### 3. State & Event Forgery
*Threat:* An MCP plugin or compromised model returns a payload structurally mirroring an authoritative Harness event (e.g., `PermissionAllowed`), attempting to trick the replay engine into escalating privileges upon restart.
*Mitigation:* Strict structural encapsulation. Untrusted data is wrapped exclusively in `.payload.result` property fields, preventing traversal into top-level event dispatch boundaries.

### 4. Crash-Induced State Corruption
*Threat:* Infrastructure failures (disk full, unhandled exception in worker, network partition) cause truncation in event logs, leading to an ambiguous recovery state that permits phantom executions or bypassed authorizations.
*Mitigation:* Monotonic, fail-closed persistence constraints. Truncated writes yield syntactical parsing failures that abort recovery completely rather than continuing in an unauthorized degraded mode.

### 5. Boundary Resource Exhaustion
*Threat:* A malicious plugin returns a structurally valid but infinitely deep JSON object, or a massive string buffer (e.g. 5GB), consuming V8 heap memory and crashing the harness.
*Mitigation:* Hard boundaries enforced immediately at the adapter boundary: maximum 20-level nesting depth limits and strict 5MB payload limits prior to data extraction.
