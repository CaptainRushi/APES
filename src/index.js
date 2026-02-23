/**
 * APES — Advanced Parallel Execution System
 * 
 * Distributed multi-agent orchestration with dynamic task decomposition
 * and parallel execution via DAG-based scheduling.
 * 
 * Architecture Layers:
 *   I.   Interface Layer     — CLI parser, permissions, session context
 *   II.  Orchestration Layer — Central control plane (apes-orch)
 *   III. Cognitive Pipeline  — Parse → Classify → Decompose → Score → Allocate → Execute → Evaluate → Learn
 *   IV.  Agent Cluster       — Registry, spawning, execution
 *   V.   Memory System       — Session, vector, performance, skill evolution
 *   VI.  Learning System     — Reinforcement scoring, policy updates
 */

export { CLI } from './interface/cli.js';
export { Orchestrator } from './orchestration/orchestrator.js';
export { AgentRegistry } from './agents/registry.js';
export { DAGScheduler } from './execution/dag-scheduler.js';
export { MemorySystem } from './memory/memory-system.js';
