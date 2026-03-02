/**
 * FileReader — Read operations for workspace files
 *
 * Capabilities:
 *   - Read file contents (text + binary detection)
 *   - Read specific line ranges
 *   - List directory contents (recursive + filtered)
 *   - Glob pattern matching (built-in, no deps)
 *   - File metadata (size, modified, encoding)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, resolve, basename } from 'node:path';

export class FileReader {
  constructor(projectRoot) {
    this.projectRoot = resolve(projectRoot);
  }

  read(filePath) {
    try {
      const resolved = this._resolve(filePath);
      if (!existsSync(resolved)) {
        return { exists: false, error: 'File not found', content: null };
      }
      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        return { exists: true, error: 'Path is a directory', content: null };
      }
      const buffer = readFileSync(resolved);
      const encoding = this._detectEncoding(buffer);
      if (encoding === 'binary') {
        return {
          exists: true,
          encoding: 'binary',
          size: stat.size,
          lines: 0,
          content: null,
          error: 'Binary file — cannot read as text',
        };
      }
      const content = buffer.toString('utf-8');
      return {
        exists: true,
        content,
        encoding: 'utf-8',
        size: stat.size,
        lines: content.split('\n').length,
      };
    } catch (err) {
      return { exists: false, error: err.message, content: null };
    }
  }

  readLines(filePath, startLine, endLine) {
    const result = this.read(filePath);
    if (!result.exists || result.error) return result;
    const allLines = result.content.split('\n');
    const start = Math.max(1, startLine);
    const end = Math.min(allLines.length, endLine);
    return {
      lines: allLines.slice(start - 1, end),
      startLine: start,
      endLine: end,
      totalLines: allLines.length,
    };
  }

  readDirectory(dirPath, options = {}) {
    const { recursive = false, filter = null, maxDepth = 5 } = options;
    try {
      const resolved = this._resolve(dirPath || '.');
      if (!existsSync(resolved)) {
        return { error: 'Directory not found', entries: [] };
      }
      const entries = [];
      this._walkDir(resolved, 0, recursive ? maxDepth : 0, entries, filter);
      const totalFiles = entries.filter(e => e.type === 'file').length;
      const totalDirs = entries.filter(e => e.type === 'directory').length;
      return { entries, totalFiles, totalDirs };
    } catch (err) {
      return { error: err.message, entries: [] };
    }
  }

  findFiles(pattern, dirPath) {
    const results = [];
    const resolved = this._resolve(dirPath || '.');
    if (!existsSync(resolved)) return results;
    const regex = this._globToRegex(pattern);
    this._walkForMatch(resolved, resolved, regex, results, 0, 10);
    return results;
  }

  getMetadata(filePath) {
    try {
      const resolved = this._resolve(filePath);
      if (!existsSync(resolved)) {
        return { exists: false, error: 'File not found' };
      }
      const stat = statSync(resolved);
      return {
        exists: true,
        size: stat.size,
        modified: stat.mtimeMs,
        created: stat.birthtimeMs,
        extension: extname(resolved),
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
      };
    } catch (err) {
      return { exists: false, error: err.message };
    }
  }

  exists(filePath) {
    return existsSync(this._resolve(filePath));
  }

  _resolve(filePath) {
    if (!filePath || filePath === '.') return this.projectRoot;
    const abs = resolve(this.projectRoot, filePath);
    return abs;
  }

  _detectEncoding(buffer) {
    const check = buffer.subarray(0, Math.min(1024, buffer.length));
    for (let i = 0; i < check.length; i++) {
      if (check[i] === 0) return 'binary';
    }
    return 'utf-8';
  }

  _walkDir(dirPath, depth, maxDepth, results, filter) {
    try {
      const items = readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (this._shouldExclude(item.name)) continue;
        const fullPath = join(dirPath, item.name);
        const relPath = relative(this.projectRoot, fullPath);
        const entry = {
          name: item.name,
          path: relPath,
          type: item.isDirectory() ? 'directory' : 'file',
        };
        if (item.isFile()) {
          entry.extension = extname(item.name);
          try {
            entry.size = statSync(fullPath).size;
          } catch { /* skip */ }
        }
        if (filter) {
          const regex = this._globToRegex(filter);
          if (item.isFile() && !regex.test(relPath)) continue;
        }
        results.push(entry);
        if (item.isDirectory() && depth < maxDepth) {
          this._walkDir(fullPath, depth + 1, maxDepth, results, filter);
        }
      }
    } catch { /* permission denied etc */ }
  }

  _walkForMatch(dirPath, root, regex, results, depth, maxDepth) {
    if (depth > maxDepth) return;
    try {
      const items = readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (this._shouldExclude(item.name)) continue;
        const fullPath = join(dirPath, item.name);
        const relPath = relative(root, fullPath).replace(/\\/g, '/');
        if (item.isFile() && regex.test(relPath)) {
          results.push(relPath);
        }
        if (item.isDirectory()) {
          this._walkForMatch(fullPath, root, regex, results, depth + 1, maxDepth);
        }
      }
    } catch { /* skip */ }
  }

  _globToRegex(pattern) {
    let regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/\{\{GLOBSTAR\}\}/g, '.*');
    return new RegExp('^' + regex + '$');
  }

  _shouldExclude(name) {
    const excluded = ['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__', '.cache', '.next', '.nuxt'];
    return excluded.includes(name);
  }
}
