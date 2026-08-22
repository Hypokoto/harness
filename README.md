# Harness AI Agent Runtime

`harness` is a modular, phased runtime for building and orchestrating AI agents.

## Phased Architecture & Discipline

The codebase strictly adheres to a phased architecture model to maintain system integrity and clear separation of concerns.

* **Phase 13 (Current)**: Monorepo scaffolding, package boundaries, workspace configuration, base project references, and static structure are complete. Runtime logic, event bus, plugin lifecycle, model adapters, tool registries, agent loops, context engine, permissions, registry client, memory, subagents, sandbox, and signing are implemented and verified.
* **Phase 14+ (Future)**: Continued development based on architectural needs.

### Two-Repository Architecture

1. `harness` (This repository): Runtime / SDK / CLI.
2. `harness-registry`: Separate git-index repository for plugin and tool marketplace discovery.

## Repository Structure

```text
harness/
├── packages/
│   ├── kernel/           # Plugin lifecycle, service registry, DI
│   ├── events/           # Event bus, JSONL event store, resume/replay/fork
│   ├── model/            # Model interface & adapters (Anthropic, Ollama, OpenRouter)
│   ├── tools/            # Tool interface & registry
│   ├── agent/            # AgentLoop & Session management
│   ├── context/          # ContextProvider, Context Composer, lazy loading
│   ├── permissions/      # Capability & PermissionPolicy models
│   ├── profile/          # Profile loading & config resolution
│   └── registry-client/  # Plugin installation & registry index client
├── cli/
│   └── harness.ts        # CLI entrypoint placeholder
├── config/
│   ├── config.toml       # Global runtime configuration
│   ├── profiles/         # User-authored profile configurations (git-ignored)
│   └── installed/        # Installed plugins and extensions (git-ignored)
├── schemas/              # Common schemas directory
├── package.json          # Workspace root package configuration
├── tsconfig.json         # Workspace root TypeScript project references
└── pnpm-workspace.yaml   # pnpm workspace definition
```

## Phase Discipline (hard rule)

Phases execute in strict sequence. Do not touch a later phase's package until the current phase's gate test passes.

```
0 Scaffolding        — done
1 Kernel              — done  (plugin lifecycle, service registry, dep resolver, rollback)
2 Events               — done  (event bus, JSONL store, replay/resume/fork)
3 Model interface        — done  (Anthropic adapter, streaming, full error-code normalization)
4 Tool interface           — done  (empty-by-default enforced by test, isolation enforced by test)
5 AgentLoop + Session        — done  (tool-call loop, maxSteps guard, event logging, abort handling)
6 Profile system                — done  (5-layer precedence, TOML parser, validator)
7 Context engine                  — done  (lazy tool loading / search_tools, profile isolation proven)
8 Permissions                       — done  (enforcement inlined in ToolRegistry.execute, 27 tests + 3 security-negative)
9 MCP plugin type                     — done  (McpTool implements Tool, inherits permission gate automatically)
10 Registry client                      — done  (manifest requires capabilities[] + checksum, lockfile, no server code)
11 Skill plugin type                     — built, needs test-run confirmation (path-traversal guard present in loader)
12 Memory                                  — done  (provider, qdrant mock, conflict/dedup, typed errors, tests pass)
13 Sandbox / subagents / signing             — folders exist, NOT YET AUDITED — was explicitly deferred, confirm this was a deliberate jump
```

## Getting Started

### Prerequisites

* Node.js >= 20.0.0
* pnpm >= 9.0.0 (or npm)

### Build & Typecheck

To build all workspace packages via TypeScript project references (`tsc -b`):

```bash
pnpm build
```

To run type checking across all workspace packages:

```bash
pnpm typecheck
```

To clean build artifacts:

```bash
pnpm clean
```
