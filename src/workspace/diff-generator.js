/**
 * DiffGenerator — Unified diff generation (LCS-based)
 *
 * Generates human-readable unified diffs before file mutations.
 * Pure JS implementation — no external dependencies.
 */

export class DiffGenerator {

  unified(beforeContent, afterContent, filePath = 'file', contextLines = 3) {
    const beforeStr = beforeContent ?? '';
    const afterStr = afterContent ?? '';
    if (beforeStr === afterStr) return '';

    const linesA = beforeStr.split('\n');
    const linesB = afterStr.split('\n');
    const hunks = this._buildHunks(linesA, linesB, contextLines);
    if (hunks.length === 0) return '';

    return this._formatUnified(hunks, filePath, linesA, linesB);
  }

  summary(beforeContent, afterContent) {
    const beforeStr = beforeContent ?? '';
    const afterStr = afterContent ?? '';
    if (beforeStr === afterStr) {
      return { additions: 0, deletions: 0, changes: 0, hunks: 0 };
    }
    const linesA = beforeStr.split('\n');
    const linesB = afterStr.split('\n');
    const ops = this._computeEditOps(linesA, linesB);
    let additions = 0;
    let deletions = 0;
    for (const op of ops) {
      if (op.type === 'insert') additions++;
      else if (op.type === 'delete') deletions++;
    }
    const hunks = this._buildHunks(linesA, linesB, 0);
    return {
      additions,
      deletions,
      changes: additions + deletions,
      hunks: hunks.length,
    };
  }

  colorized(diffString) {
    if (!diffString) return '';
    const lines = diffString.split('\n');
    return lines.map(line => {
      if (line.startsWith('+++') || line.startsWith('---')) {
        return `\x1b[1m${line}\x1b[0m`;
      }
      if (line.startsWith('@@')) {
        return `\x1b[36m${line}\x1b[0m`;
      }
      if (line.startsWith('+')) {
        return `\x1b[32m${line}\x1b[0m`;
      }
      if (line.startsWith('-')) {
        return `\x1b[31m${line}\x1b[0m`;
      }
      return line;
    }).join('\n');
  }

  fromEdits(originalContent, edits) {
    const lines = (originalContent ?? '').split('\n');
    const sorted = [...edits].sort((a, b) => (b.startLine || 0) - (a.startLine || 0));
    const result = [...lines];

    for (const edit of sorted) {
      switch (edit.type) {
        case 'replace': {
          const newLines = (edit.content || '').split('\n');
          result.splice(edit.startLine - 1, (edit.endLine || edit.startLine) - edit.startLine + 1, ...newLines);
          break;
        }
        case 'insert': {
          const newLines = (edit.content || '').split('\n');
          result.splice(edit.startLine || 0, 0, ...newLines);
          break;
        }
        case 'delete': {
          result.splice(edit.startLine - 1, (edit.endLine || edit.startLine) - edit.startLine + 1);
          break;
        }
      }
    }

    const after = result.join('\n');
    const diff = this.unified(originalContent, after, 'file');
    return { diff, after };
  }

  // --- Internal ---

  _computeEditOps(linesA, linesB) {
    const m = linesA.length;
    const n = linesB.length;
    // Use O(ND) Myers-like approach for performance on large files
    // Fallback to LCS DP for small files
    if (m + n > 10000) {
      return this._myersOps(linesA, linesB);
    }
    return this._lcsOps(linesA, linesB);
  }

  _lcsOps(linesA, linesB) {
    const m = linesA.length;
    const n = linesB.length;
    // Build LCS table
    const dp = new Array(m + 1);
    for (let i = 0; i <= m; i++) {
      dp[i] = new Uint16Array(n + 1);
    }
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (linesA[i - 1] === linesB[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    // Trace back
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
        ops.unshift({ type: 'equal', lineA: i - 1, lineB: j - 1 });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.unshift({ type: 'insert', lineB: j - 1 });
        j--;
      } else {
        ops.unshift({ type: 'delete', lineA: i - 1 });
        i--;
      }
    }
    return ops;
  }

  _myersOps(linesA, linesB) {
    // Simplified line-by-line comparison for large files
    const ops = [];
    const m = linesA.length;
    const n = linesB.length;
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (linesA[i] === linesB[j]) {
        ops.push({ type: 'equal', lineA: i, lineB: j });
        i++; j++;
      } else {
        // Look ahead for a match
        let foundA = -1, foundB = -1;
        for (let k = 1; k <= 10; k++) {
          if (i + k < m && linesA[i + k] === linesB[j]) { foundA = k; break; }
          if (j + k < n && linesA[i] === linesB[j + k]) { foundB = k; break; }
        }
        if (foundA >= 0 && (foundB < 0 || foundA <= foundB)) {
          for (let k = 0; k < foundA; k++) ops.push({ type: 'delete', lineA: i + k });
          i += foundA;
        } else if (foundB >= 0) {
          for (let k = 0; k < foundB; k++) ops.push({ type: 'insert', lineB: j + k });
          j += foundB;
        } else {
          ops.push({ type: 'delete', lineA: i });
          ops.push({ type: 'insert', lineB: j });
          i++; j++;
        }
      }
    }
    while (i < m) { ops.push({ type: 'delete', lineA: i++ }); }
    while (j < n) { ops.push({ type: 'insert', lineB: j++ }); }
    return ops;
  }

  _buildHunks(linesA, linesB, contextLines) {
    const ops = this._computeEditOps(linesA, linesB);
    const changes = [];
    for (let idx = 0; idx < ops.length; idx++) {
      if (ops[idx].type !== 'equal') {
        changes.push(idx);
      }
    }
    if (changes.length === 0) return [];

    // Group changes into hunks
    const hunks = [];
    let hunkStart = changes[0];
    let hunkEnd = changes[0];

    for (let c = 1; c < changes.length; c++) {
      if (changes[c] - hunkEnd <= contextLines * 2 + 1) {
        hunkEnd = changes[c];
      } else {
        hunks.push(this._buildHunk(ops, hunkStart, hunkEnd, contextLines, linesA, linesB));
        hunkStart = changes[c];
        hunkEnd = changes[c];
      }
    }
    hunks.push(this._buildHunk(ops, hunkStart, hunkEnd, contextLines, linesA, linesB));
    return hunks;
  }

  _buildHunk(ops, start, end, contextLines, linesA, linesB) {
    const ctxStart = Math.max(0, start - contextLines);
    const ctxEnd = Math.min(ops.length - 1, end + contextLines);
    const lines = [];
    let startA = -1, startB = -1;
    let countA = 0, countB = 0;

    for (let i = ctxStart; i <= ctxEnd; i++) {
      const op = ops[i];
      if (op.type === 'equal') {
        if (startA < 0) startA = op.lineA;
        if (startB < 0) startB = op.lineB;
        lines.push(' ' + linesA[op.lineA]);
        countA++; countB++;
      } else if (op.type === 'delete') {
        if (startA < 0) startA = op.lineA;
        if (startB < 0) startB = (i > 0 && ops[i - 1].lineB != null) ? ops[i - 1].lineB + 1 : 0;
        lines.push('-' + linesA[op.lineA]);
        countA++;
      } else if (op.type === 'insert') {
        if (startB < 0) startB = op.lineB;
        if (startA < 0) startA = (i > 0 && ops[i - 1].lineA != null) ? ops[i - 1].lineA + 1 : 0;
        lines.push('+' + linesB[op.lineB]);
        countB++;
      }
    }

    return { startA: startA + 1, countA, startB: startB + 1, countB, lines };
  }

  _formatUnified(hunks, filePath, linesA, linesB) {
    const out = [];
    out.push(`--- a/${filePath}`);
    out.push(`+++ b/${filePath}`);
    for (const hunk of hunks) {
      out.push(`@@ -${hunk.startA},${hunk.countA} +${hunk.startB},${hunk.countB} @@`);
      out.push(...hunk.lines);
    }
    return out.join('\n');
  }
}
