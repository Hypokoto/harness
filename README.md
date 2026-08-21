# Harness AI Agent Runtime

`harness` is a modular, phased runtime for building and orchestrating AI agents.

## Phased Architecture & Discipline

The codebase strictly adheres to a phased architecture model to maintain system integrity and clear separation of concerns.

* **Phase 0 (Current)**: Monorepo scaffolding, package boundaries, workspace configuration, base project references, and static structure. No runtime logic or behavior.
* **Phase 1+ (Future)**: Event bus, plugin lifecycle, model adapters, tool registries, agent loops, context engine, permissions, and registry client network logic.

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

## Package Responsibilities

| Package | Purpose | Phase 0 Status |
| :--- | :--- | :--- |
| `@harness/kernel` | Plugin lifecycle, service registry, dependency injection | Boundary defined |
| `@harness/events` | Event bus, JSONL event store, resume/replay/fork | Boundary defined |
| `@harness/model` | Model interface and provider adapters | Boundary defined |
| `@harness/tools` | Tool interface and tool registry | Boundary defined |
| `@harness/agent` | Core AgentLoop and Session concepts | Boundary defined |
| `@harness/context` | ContextProvider, Context Composer, lazy loading | Boundary defined |
| `@harness/permissions` | Capability model and PermissionPolicy | Boundary defined |
| `@harness/profile` | Profile loading, cwd auto-detection, config resolution | Boundary defined |
| `@harness/registry-client` | Package installation and registry communication | Boundary defined |

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
