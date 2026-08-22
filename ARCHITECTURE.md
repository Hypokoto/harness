# Architecture Invariants

This document defines the strict architectural rules enforced by the AI Agent Harness. These invariants prevent context bloat, dependency cycles, abstraction leaks, and ensure deterministic, secure execution.

## Dependency Rules
To maintain a directed acyclic graph (DAG) of dependencies and avoid tight coupling, the following rules apply:
- **`packages/permissions`** MUST NOT import `AgentLoop` or `ContextComposer`. Permissions operate solely on capabilities and tool metadata.
- **`packages/tools`** MUST NOT import `agent`, `context`, or `permissions`. Tools are isolated execution units.
- **`packages/sandbox`** MUST NOT import core logic. It exists strictly to isolate execution and proxy commands.
- **`packages/events`** MUST NOT import other business logic. It provides core serialization and storage.
- **`packages/model`** MUST NOT leak concrete provider types (e.g., Anthropic SDK `Anthropic`) into the core interface exported by `index.ts`. Only the abstract `Model` interfaces are exposed for dependency inversion.
- **`packages/memory`** MUST NOT expose `qdrant` internal types. It exposes the generic `MemoryProvider` interface.

## Abstraction Rules
- **Context Engine**: Context is assembled via `ContextComposer`. There is no separate "memory agent" or secondary context engine. Memory (`MemoryProvider`), Tool context, and Session context all plug uniformly into the existing composer.
- **Agent Lifecycle**: The `AgentLoop` is the sole orchestrator of steps. All tasks must execute through its tick execution model, bounded by `maxSteps`.

## Validation
These invariants are tested via `test/architecture.test.ts`, which runs statically over the codebase to ensure no forbidden imports or module dependencies exist.
