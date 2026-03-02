# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

APES (Advanced Parallel Execution System) is a zero-dependency Node.js CLI for distributed multi-agent orchestration. It decomposes user tasks into subtasks, allocates them to specialized agents organized in clusters, and executes them in parallel via DAG-based scheduling.

## Commands

```bash
# Run interactively
node bin/apes.js

# Execute a task directly
node bin/apes.js "build a REST API with authentication"

# Dev mode (auto-restart on changes)
node --watch bin/apes.js

# Run tests
node --test tests/*.test.js
```

No build step. No dependencies to install. Requires Node.js >= 20.

## Architecture

**Entry flow**: `bin/apes.js` → `CLI` (src/interface/cli.js) → `Orchestrator` (src/orchestration/orchestrator.js)

### 10-Stage Cognitive Pipeline (orchestrator.js)

The orchestrator runs every user task through this pipeline:
1. **Parse** — extract input
2. **Classify** — map to intent → cluster (intent-classifier.js)
3. **Decompose** — break into subtasks with dependencies (task-decomposer.js)
4. **Score** — complexity scoring determines agent count [1–24] (complexity-scorer.js)
5. **Allocate** — spawner selects agents from matching clusters (spawner.js)
6. **Execute** — DAG scheduler runs subtasks in topological waves (dag-scheduler.js + worker-pool.js)
7. **Evaluate** — result-evaluator.js checks quality
7.5. **Anti-Hallucination** — hallucination-detector.js (4-stage: confidence, consistency, constraint, escalation)
8. **Aggregate** — merge results, resolve conflicts (result-aggregator.js)
9. **Learn** — update agent confidence scores (learning-system.js)
10. **Output** — render to terminal

### Agent System (64 agents, 7 clusters)

Defined in `src/agents/agent-definitions.js`. Clusters: planning_layer, core_development, verification_layer, optimization_layer, enforcement_layer, documentation_dx, release_layer. Each agent has an id, role, cluster, skills, and workspace permissions.

`AgentRegistry` (registry.js) loads definitions and provides lookup. `AgentSpawner` (spawner.js) selects agents by matching skills to subtasks; caps at 24 agents for complex tasks.

### Execution Engine

- `DAGScheduler` — builds dependency graph, executes in topological waves, publishes `task_output` events to message bus
- `WorkerPool` — bounded concurrency (default maxWorkers=16)

### Communication (src/communication/)

- `MessageBus` — pub/sub with channels: `global`, `cluster:{id}`, `task:{id}`, `agent:{id}`
- `Mailbox` / `MailboxStore` — per-agent inbox/outbox with file persistence at `~/.apes/teams/{id}/mailbox/`

### Team System (src/teams/)

- `TeamManager` — full lifecycle: create, spawn, assign, shutdown, cleanup
- `TeamStore` — persists at `~/.apes/teams/{id}/config.json`
- `TaskClaimer` — atomic file-rename based task claiming

### Safety (src/safety/)

- `HallucinationDetector` — 4-stage validation pipeline
- `ConstraintEnforcer` — rules: non_empty, no_placeholder, length, task_reference
- `ConflictResolver` — weighted confidence voting + arbitration

### Provider System (src/providers/)

- `base-provider.js` — maps all 64 agent roles to system prompts
- `providers.config.json` + `ollama.config.json` — cluster-specific provider config
- `ProviderManager` / `ProviderRegistry` — manage external LLM connections

### Terminal Animation

- `ClusterAnimationEngine` (cluster-animation.js) — collapsible cluster groups with auto-expand for active clusters; used by the CLI
- `AnimationEngine` (animation-engine.js) — flat engine, re-exports ClusterAnimationEngine

### Other Layers

- **Memory** (src/memory/) — 4-layer: session, performance, skill evolution, vector store
- **Learning** (src/learning/) — reinforcement scoring adjusting agent confidence
- **Session** (src/session/) — multi-terminal parallel execution with inter-terminal bus
- **Tasks** (src/tasks/) — task graph generation, tree rendering, auto-execution
- **Workspace** (src/workspace/) — MCP client, file operations engine

## Key Conventions

- **Pure ESM** — `"type": "module"` in package.json, all imports use `.js` extensions
- **Zero dependencies** — everything is built with Node.js builtins only
- **ANSI colors** — all terminal colors use raw `\x1b[...]` escape sequences, no chalk/picocolors
- **Optional chaining for animation** — `context.animationEngine?.method()` since animation may not exist
- **Message bus injection** — `context.messageBus` is injected by the orchestrator into the DAG scheduler
- **Workspace permissions** — each cluster has read/write/edit/delete permission presets defined in agent-definitions.js
