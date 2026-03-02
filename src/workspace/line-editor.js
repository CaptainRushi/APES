/**
 * LineEditor — Precision line-level editing
 *
 * Supports:
 *   - Replace line range
 *   - Insert lines at position
 *   - Delete line range
 *   - Search-and-replace (string or regex)
 *   - Batch edits (sorted bottom-up to preserve line numbers)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class LineEditor {
  constructor(projectRoot) {
    this.projectRoot = resolve(projectRoot);
  }

  applyEdits(filePath, edits) {
    try {
      const resolved = this._resolve(filePath);
      const before = readFileSync(resolved, 'utf-8');
      const lines = before.split('\n');

      // Validate all edits before applying
      const validation = this._validateEdits(lines, edits);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join('; '), before, after: before };
      }

      // Sort edits by startLine descending (bottom-up preserves line numbers)
      const sorted = [...edits].sort((a, b) => {
        const lineA = a.startLine || a.afterLine || 0;
        const lineB = b.startLine || b.afterLine || 0;
        return lineB - lineA;
      });

      let result = [...lines];
      let totalChanged = 0;

      for (const edit of sorted) {
        const { changed, lines: newLines } = this._applyEdit(result, edit);
        result = newLines;
        totalChanged += changed;
      }

      const after = result.join('\n');
      writeFileSync(resolved, after, 'utf-8');

      return { success: true, before, after, linesChanged: totalChanged };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  replaceLine(filePath, startLine, endLine, newContent) {
    return this.applyEdits(filePath, [{
      type: 'replace',
      startLine,
      endLine: endLine || startLine,
      content: newContent,
    }]);
  }

  insertLines(filePath, afterLine, content) {
    return this.applyEdits(filePath, [{
      type: 'insert',
      afterLine: afterLine || 0,
      content,
    }]);
  }

  deleteLines(filePath, startLine, endLine) {
    return this.applyEdits(filePath, [{
      type: 'delete',
      startLine,
      endLine: endLine || startLine,
    }]);
  }

  searchReplace(filePath, search, replace, options = {}) {
    try {
      const resolved = this._resolve(filePath);
      const before = readFileSync(resolved, 'utf-8');
      const lines = before.split('\n');
      const { regex = false, global = true, lineRange } = options;

      let matchCount = 0;
      const startIdx = lineRange ? Math.max(0, lineRange.start - 1) : 0;
      const endIdx = lineRange ? Math.min(lines.length, lineRange.end) : lines.length;

      for (let i = startIdx; i < endIdx; i++) {
        const original = lines[i];
        if (regex) {
          const flags = global ? 'g' : '';
          const re = new RegExp(search, flags);
          const replaced = lines[i].replace(re, replace);
          if (replaced !== original) {
            matchCount += (lines[i].match(re) || []).length;
            lines[i] = replaced;
          }
        } else {
          if (global) {
            while (lines[i].includes(search)) {
              lines[i] = lines[i].replace(search, replace);
              matchCount++;
            }
          } else {
            if (lines[i].includes(search)) {
              lines[i] = lines[i].replace(search, replace);
              matchCount++;
            }
          }
        }
      }

      const after = lines.join('\n');
      if (matchCount > 0) {
        writeFileSync(resolved, after, 'utf-8');
      }

      return { success: true, before, after, matchCount };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _applyEdit(lines, edit) {
    const result = [...lines];
    let changed = 0;

    switch (edit.type) {
      case 'replace': {
        const start = edit.startLine - 1;
        const end = (edit.endLine || edit.startLine) - 1;
        const count = end - start + 1;
        const newLines = (edit.content || '').split('\n');
        result.splice(start, count, ...newLines);
        changed = Math.max(count, newLines.length);
        break;
      }
      case 'insert': {
        const pos = edit.afterLine || 0;
        const newLines = (edit.content || '').split('\n');
        result.splice(pos, 0, ...newLines);
        changed = newLines.length;
        break;
      }
      case 'delete': {
        const start = edit.startLine - 1;
        const end = (edit.endLine || edit.startLine) - 1;
        const count = end - start + 1;
        result.splice(start, count);
        changed = count;
        break;
      }
      case 'search-replace': {
        const { search, replace: rep, regex: isRegex, global: isGlobal = true } = edit;
        for (let i = 0; i < result.length; i++) {
          const original = result[i];
          if (isRegex) {
            result[i] = result[i].replace(new RegExp(search, isGlobal ? 'g' : ''), rep);
          } else if (isGlobal) {
            while (result[i].includes(search)) {
              result[i] = result[i].replace(search, rep);
            }
          } else {
            result[i] = result[i].replace(search, rep);
          }
          if (result[i] !== original) changed++;
        }
        break;
      }
    }

    return { changed, lines: result };
  }

  _validateEdits(lines, edits) {
    const errors = [];
    const ranges = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (!edit.type) {
        errors.push(`Edit ${i}: missing type`);
        continue;
      }
      if (!['replace', 'insert', 'delete', 'search-replace'].includes(edit.type)) {
        errors.push(`Edit ${i}: invalid type '${edit.type}'`);
        continue;
      }

      if (edit.type === 'replace' || edit.type === 'delete') {
        const start = edit.startLine;
        const end = edit.endLine || edit.startLine;
        if (!start || start < 1) {
          errors.push(`Edit ${i}: startLine must be >= 1`);
        } else if (start > lines.length) {
          errors.push(`Edit ${i}: startLine ${start} exceeds file length ${lines.length}`);
        }
        if (end < start) {
          errors.push(`Edit ${i}: endLine ${end} < startLine ${start}`);
        }
        if (end > lines.length) {
          errors.push(`Edit ${i}: endLine ${end} exceeds file length ${lines.length}`);
        }
        ranges.push({ idx: i, start, end });
      }

      if (edit.type === 'insert') {
        const pos = edit.afterLine || 0;
        if (pos < 0) {
          errors.push(`Edit ${i}: afterLine must be >= 0`);
        }
        if (pos > lines.length) {
          errors.push(`Edit ${i}: afterLine ${pos} exceeds file length ${lines.length}`);
        }
      }

      if (edit.type === 'search-replace' && !edit.search) {
        errors.push(`Edit ${i}: search-replace requires 'search' field`);
      }
    }

    // Check for overlapping ranges
    ranges.sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start <= ranges[i - 1].end) {
        errors.push(`Edits ${ranges[i - 1].idx} and ${ranges[i].idx} have overlapping ranges`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  _resolve(filePath) {
    return resolve(this.projectRoot, filePath);
  }
}
