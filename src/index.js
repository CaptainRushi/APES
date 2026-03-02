/**
 * APES — Advanced Parallel Execution System
 *
 * Distributed multi-agent orchestration with dynamic task decomposition
 * and parallel execution via DAG-based scheduling.
 *
 * Architecture Layers:
 *   I.    Interface Layer        — CLI parser, permissions, session context
 *   II.   Orchestration Layer    — Central control plane (apes-orch)
 *   III.  Cognitive Pipeline     — Parse → Classify → Decompose → Score → Allocate → Execute → Evaluate → Learn
 *   IV.   Agent Cluster          — 64 agents across 8 clusters
 *   V.    Communication Layer    — Message bus, mailboxes, inter-agent messaging
 *   VI.   Team Management        — Team lifecycle, task claiming
 *   VII.  Safety Layer           — Anti-hallucination, constraint enforcement, conflict resolution
 *   VIII. Memory System          — Session, vector, performance, skill evolution
 *   IX.   Learning System        — Reinforcement scoring, policy updates
 *   X.    Session Layer          — Distributed multi-terminal parallel execution
 */

export { CLI } from './interface/cli.js';
export { Orchestrator } from './orchestration/orchestrator.js';
export { AgentRegistry } from './agents/registry.js';
export { DAGScheduler } from './execution/dag-scheduler.js';
export { MemorySystem } from './memory/memory-system.js';
export { MessageBus } from './communication/message-bus.js';
export { TeamManager } from './teams/team-manager.js';
export { HallucinationDetector } from './safety/hallucination-detector.js';
export { ClusterAnimationEngine } from './interface/cluster-animation.js';
export { TerminalAnimationEngine } from './interface/terminal-animation.js';

// ─── Multi-Terminal Parallel Execution ────────────────────────────
export { SessionManager } from './session/session-manager.js';
export { SessionStore } from './session/session-store.js';
export { TaskLock } from './session/task-lock.js';
export { InterTerminalBus } from './session/inter-terminal-bus.js';

// ─── Distributed Task Engine ──────────────────────────────────────
export { TaskEngine } from './tasks/task-engine.js';
export { TaskGraphGenerator } from './tasks/task-graph.js';
export { TaskTreeRenderer } from './tasks/task-renderer.js';
export { TaskAutoExecutor } from './tasks/task-executor.js';
export { TaskLearningBridge } from './tasks/task-learning.js';
export { LockManager } from './tasks/lock-manager.js';

// ─── Swarm Orchestration v2 ──────────────────────────────────────
export { SwarmManager, TOPOLOGY, AGENT_STATE } from './orchestration/swarm-manager.js';
export { CapabilityRegistry } from './orchestration/capability-registry.js';
export { AdaptiveRouter, HOOK_TYPE } from './orchestration/adaptive-router.js';
export { ConsensusEngine, GCounter, LWWRegister, ORSet } from './orchestration/consensus.js';
export { MetricsCollector } from './orchestration/metrics-collector.js';

// ─── Persistent Semantic Memory ──────────────────────────────────
export { VectorStore } from './memory/vector-store.js';
export { PatternBank } from './memory/pattern-bank.js';

// ─── MCP Tool Integration ────────────────────────────────────────
export { MCPClient } from './workspace/mcp-client.js';

// ─── Project Config (apes.md + Skills) ──────────────────────────
export { ApesMdLoader } from './config/apes-md-loader.js';
export { SkillLoader } from './config/skill-loader.js';
