# APES Performance Optimizer — Persistent Memory

## Project: APES (Advanced Parallel Execution System)
Path: C:/Users/rushi/Downloads/apes1/APES
Stack: Zero-dependency Node.js ESM, no build step, Node >= 20

## Architecture Summary
- 10-stage cognitive pipeline in orchestrator.js
- 64 agents across 8 clusters, DAG-scheduled execution
- WorkerPool bounded concurrency (default 16 workers)
- MessageBus pub/sub with circular history buffer (post-fix)
- ClusterAnimationEngine at 20 FPS for terminal UI
- Memory layers: session, performance (indexed), skill evolution (indexed), vector store

## Optimizations Applied (2026-03-01)

### dag-scheduler.js — O(V+E) topological sort
- Replaced O(V²) re-scan wave computation with Kahn's BFS algorithm
- Uses in-degree tracking + dependents adjacency list
- Does NOT mutate node.status during wave computation (was polluting execution state)

### worker-pool.js — Backpressure drain fix
- processQueue() changed from draining 1 item to draining ALL available slots in a while loop
- Prevents starvation when multiple workers finish simultaneously (race condition)

### message-bus.js — Circular buffer history
- Replaced `this._history.push()` + `this._history.slice()` with fixed-size circular buffer
- _historyBuf (Array[1000]), _historyHead pointer, _historySize counter
- O(1) writes instead of O(n) array recreation on overflow

### registry.js — Cluster-indexed agent lookup
- findAgents() now uses cluster.agents[] id list when cluster filter present
- O(cluster_size ~8) instead of O(64) spread + filter
- Skills lookup uses Set for O(1) per-skill checks

### memory-system.js — Secondary indexes
- Added _agentPerfIndex (Map<agentId, entries[]>) and _clusterPerfIndex
- getAgentPerformance/getClusterPerformance: O(agent_entries) not O(all_entries)
- Added _skillPatternIndex for O(1) recordPattern duplicate detection
- _rebuildPerfIndexes() called after trim
- load() rebuilds all indexes after disk restore

### vector-store.js — Math + allocation savings
- _cosineSimilarity: single Math.sqrt(magA * magB) instead of two separate sqrts
- textSearch: Jaccard intersection computed with Set.has loop (O(|q|)), union = |A|+|B|-|intersection| — eliminates new Set([...a,...b]) spread

### cluster-animation.js — Batched stdout writes
- _render() builds entire frame as one string, single process.stdout.write() call
- Was: up to 35 individual readline.clearLine + readline.cursorTo + write calls per frame
- At 20 FPS: ~700 syscalls/sec -> 20 syscalls/sec (35x reduction)
- Uses raw ANSI escape sequences: ESC[nA (cursor up), ESC[2K (erase line), ESC[0G (col 0)

### agent-loop.js — Static imports + regex caching
- Moved readFileSync, writeFileSync, mkdirSync, execSync, readdirSync, statSync, dirname imports to module top level
- All 7 regex patterns in _extractFilesFromResponse pre-compiled as module constants (RE_CODE_BLOCK_FILENAME, RE_CREATE_FILE, etc.)
- Each exec loop resets .lastIndex before use (required for /g reuse across calls)
- _parseToolCall uses pre-compiled RE_TOOL_CALL

### orchestrator.js — Eliminated duplicate string split
- parseInput() calls input.split(/\s+/) once, derives both tokens[] and wordCount from same result

## Key Performance-Sensitive Paths
1. DAG execute() -> WorkerPool.execute() -> provider.execute() (LLM hot path)
2. ClusterAnimationEngine._render() called every 50ms (20 FPS)
3. AgentRegistry.findAgents() called in spawner.allocate() for each task type
4. MessageBus.publish() called per task_output event
5. MemorySystem.recordPerformance() called per learning update

## Known Anti-Patterns Confirmed Fixed
- Array.prototype.slice for ring-buffer semantics (now true circular buffer)
- Dynamic import() inside hot tool-call paths (now static imports)
- Regex literal inside function body called per LLM response (now module constants)
- Linear O(n) scan with Array.find/filter where Map index would suffice
- Multiple Math.sqrt where one suffices
