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

---

## Controlled LLM Orchestration Architecture (v2.0)

APES v2 introduces a fully controlled LLM pipeline. The LLM is never given raw user prompts. Every call is pre-analyzed by 5 deterministic control agents, assembled into a structured constrained prompt, and post-validated before output is accepted.

### Design Principle

```
OLD (pass-through):  user objective → LLM → output

NEW (controlled):    user objective
                         │
                    [Stage 1] Task Analysis (deterministic, no LLM)
                         │
                    [Stage 2] 5 Control Agents analyze task + workspace
                         │
                    [Stage 3] PromptBuilder assembles constrained prompt
                         │
                    [Stage 4] LLM called with structured prompt (never raw objective)
                         │
                    [Stage 5] OutputValidator runs 7-stage post-generation validation
                         │
                    [Stage 6] RegenerationLoop retries with tightened constraints if needed
                         │
                        output
```

### The 5 Control Agents (`src/agents/control-agents.js`)

All 5 agents are **deterministic** — no LLM calls, no I/O, no side effects. Every agent implements `analyze(taskAnalysis, workspaceContext) → structured object`.

| Agent | Output | Purpose |
|-------|--------|---------|
| `SpecificationAgent` | `spec` | Converts vague objective to precise spec: language, output files, function signatures, complexity, error handling requirements |
| `ConstraintAgent` | `constraints` | Hard limits on what the LLM must NOT do: forbidden imports, forbidden file paths, security rules, zero-dep detection, file scope |
| `HallucinationGuardAgent` | `guardRules` | Anti-hallucination injection: grounding instructions, uncertainty protocols, known-good API surface, prompt markers |
| `CodeQualityAgent` | `qualityRules` | Naming conventions, complexity limits (max 60 lines/function, 500 lines/file), ESM/CJS detection, required and forbidden patterns |
| `VerificationAgent` | `verificationCriteria` | Acceptance criteria for post-generation validation: syntax checks to run, required content patterns, forbidden content, structural checks, scoring weights |

### PromptBuilder (`src/prompts/prompt-builder.js`)

Assembles the 5 agent outputs into a structured `{ system, user, maxTokens, temperature }` prompt object. Key behaviors:

- **System prompt**: 10 sections — role definition, workspace context, hard constraints, quality rules, anti-hallucination grounding, approved imports, behavioral constraints, output format, verification conditions, error handling requirements
- **User message**: structured task spec (objective, file scope, function signatures, known APIs, previous failure context on retries) — never the raw user text
- **Token budget**: 4096 (low) / 8192 (medium) / 12288 (high) complexity; +25% per retry attempt
- **Temperature**: domain-specific (security/bug_fix: 0.05, code_generation: 0.1, documentation: 0.3); −0.02 per retry, minimum 0.01

### OutputValidator (`src/safety/output-validator.js`)

7-stage static analysis pipeline that runs after every LLM generation:

| Stage | Check | Failure Severity |
|-------|-------|-----------------|
| 1 | Basic content: non-empty, length >= 20 chars | error |
| 2 | Forbidden content: 14 placeholder/truncation patterns (ellipsis, `// rest of code`, `[INSERT HERE]`, `raise NotImplementedError`, etc.) | error |
| 3 | Syntax: bracket balance, string termination, JSON parseable, HTML tag balance, Python indentation/colons, template literal balance, import statement validity | error |
| 4 | Import validation: unknown/hallucinated packages, zero-dep mode violations | error/warning |
| 5 | Constraint compliance: path traversal, hardcoded secrets, zero-dep mode | error |
| 6 | Structural: ESM exports present, no `require()` in ESM, test structure present | warning/error |
| 7 | Semantic: required patterns and identifiers from VerificationAgent criteria | warning |

Returns `{ passed: boolean, score: 0.0–1.0, violations: object[], syntaxErrors: string[], warnings: string[] }`. Passes when zero `error`-severity violations and score >= 0.5.

### RegenerationLoop (`src/safety/regeneration-loop.js`)

When OutputValidator rejects output, the loop:

1. Calls `OutputValidator.summarize()` to categorize violations (syntax, placeholder, imports, constraints, structural, semantic)
2. Clones and tightens constraints by injecting `CRITICAL:` hard limits for each failing category
3. Rebuilds the full controlled prompt with `previousFailure` context injected into the user message
4. Retries the LLM; tracks the best output by score across all attempts
5. At attempt 3+, activates ultra-strict mode with three universal hard limits
6. Returns either the first passing result or the best partial result if all attempts are exhausted

**Backoff policy**: attempt 1 immediate → attempt 2 immediate → attempt 3+ exponential (2s base, doubles each time). Network errors retry with separate exponential backoff. Default max: 3 attempts.

### 6-Stage Pipeline (`src/tasks/apes-executor.js`)

`ClaudeExecutor.execute()` runs every non-trivial task through:

1. **Task Analysis** — deterministic domain classification, workspace scan via `RepoAnalyzer` (falls back to lightweight `readdirSync` scan). Two health-check gates fire first: provider configured check, provider health-check ping.
2. **Agent Spawn** — instantiates and runs all 5 control agents; on agent failure, safe defaults are substituted so execution continues
3. **Prompt Build** — `PromptBuilder.build()` produces the constrained system+user prompt pair; a separate lighter planning prompt asks the LLM to produce a task list (not code)
4. **LLM Execution** — `provider.generate()` called with controlled prompt; transient errors retry with 2s/4s exponential backoff (max 3 total calls); thinking model support: accepts `result.thinking` when `result.content` is empty
5. **Output Validate** — `OutputValidator.validate()` runs on each written file in-line; validation score and hash are reported to the status callback
6. **Regenerate** — `RegenerationLoop.create()` fires when a task produces textual output but no files and validation fails; reports per-attempt progress via `onAttempt` callback

Stages 3–6 run **per parsed sub-task**, not once for the whole objective. Each sub-task gets its own re-analysis by the 5 control agents scoped to that specific task title.

### New Files

| File | Purpose |
|------|---------|
| `src/agents/control-agents.js` | 5 deterministic control agents |
| `src/prompts/prompt-builder.js` | Controlled prompt assembler (10-section system prompt) |
| `src/safety/output-validator.js` | 7-stage post-generation validator |
| `src/safety/regeneration-loop.js` | Adaptive retry with constraint tightening |
| `src/tasks/apes-executor.js` | Updated executor with full 6-stage pipeline |

### Key Design Rules

- **Zero LLM calls in control agents** — all 5 agents are pure deterministic functions
- **Control agents never mutate their inputs** — `RegenerationLoop._tightenConstraints()` shallow-clones before modifying
- **Safe degradation** — control agent failures substitute documented defaults; the execution never aborts because an agent threw
- **Health-check gate** — executor refuses to run if the provider does not respond to a ping before the main task starts
- **Thinking model support** — `result.thinking` is accepted as valid output when `result.content` is empty
