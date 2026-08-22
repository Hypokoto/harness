# Security Guarantees

This document outlines the security architecture and threat models for the AI Agent Harness. Security is treated as a chain, not a single point of failure.

## Sandbox Escapes and "Isolation Lite"

**CRITICAL DIRECTIVE**: The current `node:vm` architecture is **NOT** a security sandbox. It is an "isolation-lite" execution environment.

It has been proven during audit that `vm` context escapes (such as `this.constructor.constructor('return process')()`, prototype chain walks, and stack trace manipulations) cannot be fully mitigated at the V8/Node language layer without unacceptable compromises to tool functionality. 

**Policy**:
- Treat any tool with `shell.execute` or `network.*` capabilities as running with **ZERO** sandbox guarantee.
- Do not run untrusted or adversarial code through the `vm` relying on it to contain the process.
- The `permissions` layer (which enforces capability matching) is the **ONLY** real security boundary in the system. It has been mathematically and behaviorally verified via 30 regression tests.

To achieve true adversarial multi-tenancy, the architecture must transition from a language-level sandbox to a process-level container (e.g., `bwrap`, Linux Namespaces + seccomp) in a future phase. Until then, the system operates under a "trusted tool, restrictive permission" model.

The sandbox guarantees that tools executed via it are proxied over IPC and subjected to the host's `ToolRegistry` and `PermissionPolicy`.

## Registry & Package Installation
The registry client verifies the integrity of downloaded skills and MCP plugins:
- **Default Deny / Unsigned Packages**: Unsigned marketplace packages are rejected by default. Signatures must match the `TrustStore`.
- **Checksum Verification**: `crypto.createHash('sha256')` is used to verify the artifact buffer against the manifest checksum prior to extraction.
- **TOCTOU Protection**: The checksum is calculated on the in-memory buffer before it is written to the disk. Extraction happens into a temporary staging directory, which is atomically renamed to the final destination via `fs.rename` to prevent time-of-check/time-of-use races.
- **Symlink Prevention**: The extraction process (`tar.extract`) explicitly rejects `SymbolicLink` or `Link` entries, mitigating arbitrary file overwrite attacks.
- **Path Traversal Protection**: Archive extraction blocks any absolute paths or `..` paths.

## Event System Integrity
- The EventStore JSONL implementation leverages crash recovery. If a crash occurs mid-write, partial final lines are safely ignored during reads, maintaining sequential integrity without discarding actual data or silently inventing state.
- `EventStore` requires strict monotonic sequence increments. Any gap or collision throws a `SequenceError`.

## Subagent Resource Controls
Subagents are strictly bound by resource limits to prevent exhaustion:
- `maxDepth` restricts infinite subagent nesting (throws `SubagentLimitExceededError`).
- `maxSteps` restricts AgentLoop infinite cycles.
- `timeoutMs` binds the agent loop and individual tool execution logic. Tool outputs are bounded to 100KB to prevent context window explosion.
