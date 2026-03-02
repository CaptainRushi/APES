/**
 * ExecutionVerifier — Enforcement gate between agent output and task completion
 *
 * Validates that workspace-related tasks actually performed real file operations
 * before allowing task completion. Prevents "assumed success" completions.
 *
 * Checks:
 *   1. Suspicious instant completion (< minExecutionTime with files written)
 *   2. All claimed written files exist on disk
 *   3. Snapshot comparison — workspace state actually changed
 *   4. Basic result sanity (has output or completed flag)
 */

export class ExecutionVerifier {
  /**
   * @param {object} opts
   * @param {import('../workspace/workspace-engine.js').WorkspaceEngine} [opts.workspaceEngine]
   * @param {number} [opts.minExecutionTime=100] — Min ms for file-writing tasks
   * @param {boolean} [opts.requireSnapshotMatch=true] — Require before/after comparison
   */
  constructor(opts = {}) {
    this.workspaceEngine = opts.workspaceEngine;
    this.verifier = opts.workspaceEngine?.writeVerifier || null;
    this.minExecutionTime = opts.minExecutionTime ?? 100;
    this.requireSnapshotMatch = opts.requireSnapshotMatch ?? true;
  }

  /**
   * Take a pre-execution snapshot of workspace files.
   * @param {string[]} relevantPaths — Files the task may modify
   * @returns {{ snapshotId: string, hashes: Map<string, string|null>, timestamp: number }}
   */
  takeSnapshot(relevantPaths = []) {
    const hashes = this.verifier
      ? this.verifier.snapshot(relevantPaths)
      : new Map();
    return {
      snapshotId: `snap-${Date.now()}`,
      hashes,
      timestamp: Date.now(),
    };
  }

  /**
   * Verify task execution results before allowing completion.
   * @param {object} params
   * @param {object} params.result — AgentLoop result
   * @param {object} params.task — Task object
   * @param {number} params.duration — Execution duration in ms
   * @param {object} [params.preSnapshot] — Pre-execution snapshot
   * @returns {{ pass: boolean, reasons: string[], flags: string[] }}
   */
  verify({ result, task, duration, preSnapshot }) {
    const reasons = [];
    const flags = [];

    const filesWritten = result.filesWritten || [];
    const hasFileWork = filesWritten.length > 0;

    // Check 1: Suspicious instant completion for file-writing tasks
    if (hasFileWork && duration < this.minExecutionTime) {
      flags.push('suspicious_instant_completion');
      reasons.push(
        `Task completed in ${duration}ms with ${filesWritten.length} files written. ` +
        `Minimum expected: ${this.minExecutionTime}ms`
      );
    }

    // Check 2: Verify all claimed written files exist on disk
    if (this.verifier && hasFileWork) {
      for (const fp of filesWritten) {
        if (!this.verifier.fileExists(fp)) {
          flags.push('missing_written_file');
          reasons.push(`Claimed written file does not exist: ${fp}`);
        }
      }
    }

    // Check 3: Snapshot comparison (if pre-snapshot was taken with paths)
    if (this.requireSnapshotMatch && preSnapshot && this.verifier && preSnapshot.hashes.size > 0) {
      const postHashes = this.verifier.snapshot([...preSnapshot.hashes.keys()]);
      const diff = this.verifier.diffSnapshots(preSnapshot.hashes, postHashes);
      const totalChanges = diff.created.length + diff.modified.length + diff.deleted.length;

      if (hasFileWork && totalChanges === 0) {
        flags.push('no_workspace_changes');
        reasons.push('Task claims to have written files but no workspace changes detected in tracked paths');
      }
    }

    // Check 4: Basic result sanity
    if (!result.output && !result.completed) {
      flags.push('empty_result');
      reasons.push('No output and not marked completed');
    }

    const pass = flags.length === 0;
    return { pass, reasons, flags };
  }
}
