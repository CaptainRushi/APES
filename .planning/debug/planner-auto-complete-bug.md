---
status: resolved
trigger: "planner auto-completes tasks without executing them"
created: 2026-02-27T00:00:00.000Z
updated: 2026-02-27T00:00:00.000Z
---

## Root Cause
Quality gate threshold (0.5) was too aggressive, causing valid research tasks to fail and block downstream tasks via dependency chain.

## Evidence
- timestamp: 2026-02-27
  checked: "Task engine state files in ~/.apes/sessions/"
  found: "task-003 failed with confidence 0.485 (below 0.5 threshold), task-005 failed with 0.465"
  implication: "Quality gate is correctly rejecting low-confidence tasks, but threshold may be too aggressive"

- timestamp: 2026-02-27
  checked: "Task dependency graph"
  found: "task-003 blocks task-006, which blocks task-010, which blocks task-011, which blocks task-012"
  implication: "5 tasks (007-012) were blocked because upstream tasks failed quality gate"

## Fixes Applied

### Fix 1: Increased Quality Gate Threshold
file: src/tasks/task-executor.js
change: Changed minConfidence from 0.5 to 0.7 to reduce false positives

```javascript
this.minConfidence = opts.minConfidence ?? 0.7; // Increased from 0.5 to reduce false positives
```

### Fix 2: Fixed Failed Task Persistence
file: src/tasks/task-engine.js
changes:
1. Added 'failed' directory creation in constructor
2. Added case for 'failed' status in _persistTask() switch statement  
3. Added 'failed' to cleanup list in _persistTask()
4. Added 'failed' to getTask() and getAllTasks() search directories

## Resolution
root_cause: "Quality gate threshold (0.5) was too aggressive, causing valid research tasks to fail and block downstream tasks via dependency chain. Additionally, failed tasks were stored in wrong directory."
fix: "1) Increased minConfidence threshold to 0.7, 2) Fixed _persistTask() to move failed tasks to failed directory, 3) Added 'failed' directory to search paths in getTask/getAllTasks"
verification: "Changes applied to task-executor.js and task-engine.js"
files_changed:
  - src/tasks/task-executor.js
  - src/tasks/task-engine.js
