# APES — Advanced Parallel Execution System

> Distributed multi-agent orchestration with dynamic task decomposition and DAG-based parallel execution.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    INTERFACE LAYER                           │
│  CLI Parser → Permission Handler → Session Context          │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                  ORCHESTRATION LAYER                         │
│                                                              │
│  10-Stage Cognitive Pipeline:                                │
│  Parse → Classify → Decompose → Score → Allocate →          │
│  Execute (DAG) → Evaluate → Aggregate → Learn → Output      │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                    AGENT SYSTEM                              │
│                                                              │
│  Registry (11 agents × 6 clusters)                          │
│  ┌──────────┬──────────┬──────────┐                         │
│  │ Research  │ Coding   │ DevOps   │                         │
│  │ Cluster   │ Cluster  │ Cluster  │                         │
│  ├──────────┼──────────┼──────────┤                         │
│  │ UI/UX    │ Analysis │ Eval     │                         │
│  │ Cluster  │ Cluster  │ Cluster  │                         │
│  └──────────┴──────────┴──────────┘                         │
│                                                              │
│  Dynamic Spawner (confidence-based selection)                │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                  EXECUTION ENGINE                            │
│                                                              │
│  DAG Scheduler (topological wave execution)                  │
│  Worker Pool (bounded concurrency, 8 workers)                │
│                                                              │
│  Wave 1: [A]       ← independent tasks                      │
│  Wave 2: [B, C]    ← parallel after A                       │
│  Wave 3: [D]       ← after B and C                          │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                   MEMORY SYSTEM                              │
│                                                              │
│  Layer 1: Session Memory    (current task context)           │
│  Layer 2: Performance Memory (agent metrics + trends)        │
│  Layer 3: Skill Evolution    (learned patterns)              │
│  Layer 4: Vector Memory      (future: embeddings)            │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                  LEARNING SYSTEM                             │
│                                                              │
│  Reinforcement Scoring:                                      │
│    faster_than_avg → confidence += 0.02                      │
│    task_failed     → confidence -= 0.05                      │
│                                                              │
│  Trains: agent selection policy, routing, heuristics         │
│  Does NOT retrain the LLM                                    │
└─────────────────────────────────────────────────────────────┘
```

## Complexity Scoring

```
Score = subtask_count × dependency_weight × risk_factor

0–3  → Simple   → 1–2 agents
4–7  → Medium   → 3–5 agents parallel
8+   → Complex  → DAG with staged parallel waves
```

## Quick Start

```bash
# Interactive mode
node bin/apes.js

# Execute a task
node bin/apes.js "build a REST API with authentication"

# Show status
node bin/apes.js --status

# Help
node bin/apes.js --help
```

## Project Structure

```
src/
├── index.js                        # Barrel export
├── interface/                      # Layer I: Interface
│   ├── cli.js                      # Main CLI entry
│   ├── command-parser.js           # Argument parsing
│   ├── permission-handler.js       # Side-effect gating
│   ├── session-context.js          # Session state
│   └── renderer.js                 # Terminal UI
├── orchestration/                  # Layer II: Brain
│   ├── orchestrator.js             # Central control plane
│   ├── intent-classifier.js        # Stage 2: Intent classification
│   ├── task-decomposer.js          # Stage 3: Task decomposition
│   ├── complexity-scorer.js        # Stage 4: Complexity scoring
│   ├── result-evaluator.js         # Stage 7: Result evaluation
│   └── result-aggregator.js        # Stage 8: Aggregation
├── agents/                         # Layer III: Agents
│   ├── registry.js                 # Agent registry (6 clusters)
│   └── spawner.js                  # Dynamic allocation
├── execution/                      # Layer IV: Execution
│   ├── dag-scheduler.js            # DAG-based scheduler
│   └── worker-pool.js              # Bounded worker pool
├── memory/                         # Layer V: Memory
│   └── memory-system.js            # 4-layer memory architecture
└── learning/                       # Layer VI: Learning
    └── learning-system.js          # Reinforcement scoring
```

## Design Principles

- **Zero dependencies** — Pure Node.js 20+
- **DAG-based scheduling** — Not random multi-agent spawning
- **Reinforcement-based agent selection** — Performance-aware routing
- **Permission-aware side-effect control** — Interactive gating
- **Memory-driven optimization** — Learn from every execution
- **Simulation-first** — Validate architecture before connecting to LLMs

## Next Steps

1. ~~Single-agent orchestrator~~ ✅
2. ~~Task decomposition~~ ✅
3. ~~Worker pool parallelism~~ ✅
4. ~~Agent registry~~ ✅
5. ~~Performance scoring~~ ✅
6. ~~Memory layer~~ ✅
7. ~~Learning system~~ ✅
8. **LLM Provider Integration** ← Next
9. **Vector DB (pgvector/Supabase)**
10. **Distributed cluster scaling**