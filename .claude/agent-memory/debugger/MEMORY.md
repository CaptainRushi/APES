# APES Debugger Memory

## Architecture Notes

- The actual execution path is: `CLI.startInteractiveMode()` → `ClaudeExecutor.execute()` (apes-executor.js)
- `Orchestrator.execute()` (orchestrator.js) is **NOT** called from the interactive prompt or `executeTask()`. It is dead code for the primary execution path.
- `ComplexityScorer`, `IntentClassifier`, `TaskDecomposer`, and `AgentSpawner` all work correctly but are only used by `Orchestrator.execute()`, which is bypassed.
- The real complexity/agent-count logic lives in `ClaudeExecutor._selectDynamicAgents()`.

## Known Bug Patterns

### 1. Unconditional Interview Launch (FIXED)
- **File**: `src/interface/cli.js` lines 459–461
- **Pattern**: `new PlannerInterview(rl, ...).run(trimmed)` called with no guard
- **Fix**: Check `GREETING_RE` and word-count gate before constructing/running interview

### 2. Hardcoded 8-Agent Baseline (FIXED)
- **File**: `src/tasks/apes-executor.js` lines 302–306 (original)
- **Pattern**: `requiredNames` Set populated with 8 names unconditionally before any keyword checks
- **Fix**: Gate the baseline `Set` on `isFileTask` regex check; empty set for conversational inputs

### 3. FileLock ENOENT Race (FIXED)
- **File**: `src/workspace/file-lock.js`
- **Pattern**: `_ensureDir()` only called in constructor; if directory deleted between construction and `acquire()`, `writeFileSync({flag:'wx'})` throws ENOENT
- **Fix**: Call `_ensureDir()` at the top of `acquire()` — idempotent, cheap

## Fragile Areas

- `ClaudeExecutor._selectDynamicAgents()` — keyword matching is shallow regex, prone to false positives/negatives
- `PlannerInterview.run()` — starts rendering to stdout immediately (line 265), no way to abort cleanly after starting
- `FileLock` — no retry-after-mkdir for ENOENT; should be hardened to re-try once on ENOENT
- `WorkspaceEngine` is initialized once with `sessionId: 'default'` even when `isolateSession()` generates a new sessionId

## Key File Paths

- CLI entry: `src/interface/cli.js`
- Real executor: `src/tasks/apes-executor.js` (ClaudeExecutor)
- Interview: `src/interface/planner-interview.js`
- FileLock: `src/workspace/file-lock.js`
- Lock/audit dir: `~/.apes/workspace/{sessionId}/locks/` and `~/.apes/workspace/{sessionId}/audit/`
