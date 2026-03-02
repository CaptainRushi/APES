/**
 * FileWriter — Write operations for workspace files
 *
 * Capabilities:
 *   - Write new files (auto-create parent dirs)
 *   - Overwrite existing files
 *   - Atomic write via temp-file + rename
 *   - Create directories
 *   - Delete files
 *   - Backup files for rollback
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export class FileWriter {
  constructor(projectRoot) {
    this.projectRoot = resolve(projectRoot);
  }

  write(filePath, content, options = {}) {
    const { createDirs = true, atomic = true } = options;
    try {
      const resolved = this._resolve(filePath);
      const existed = existsSync(resolved);

      if (createDirs) {
        const dir = dirname(resolved);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }

      if (atomic) {
        this._atomicWrite(resolved, content);
      } else {
        writeFileSync(resolved, content, 'utf-8');
      }

      const contentHash = createHash('sha256').update(content, 'utf-8').digest('hex');

      let verified = undefined;
      if (options.verify) {
        try {
          const ondisk = readFileSync(resolved, 'utf-8');
          const ondiskHash = createHash('sha256').update(ondisk, 'utf-8').digest('hex');
          verified = ondiskHash === contentHash;
        } catch {
          verified = false;
        }
      }

      return {
        success: true,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
        created: !existed,
        overwritten: existed,
        contentHash,
        verified,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  mkdir(dirPath) {
    try {
      const resolved = this._resolve(dirPath);
      const existed = existsSync(resolved);
      if (!existed) {
        mkdirSync(resolved, { recursive: true });
      }
      return { success: true, created: !existed, existed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  delete(filePath) {
    try {
      const resolved = this._resolve(filePath);
      if (!existsSync(resolved)) {
        return { success: false, error: 'File not found' };
      }
      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        return { success: false, error: 'Cannot delete directory — use rmdir for safety' };
      }
      unlinkSync(resolved);
      return { success: true, deleted: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  backup(filePath) {
    try {
      const resolved = this._resolve(filePath);
      if (!existsSync(resolved)) {
        return { success: false, error: 'File not found', content: null };
      }
      const content = readFileSync(resolved, 'utf-8');
      const contentHash = createHash('sha256').update(content, 'utf-8').digest('hex');
      const backupPath = resolved + '.bak.' + Date.now();
      writeFileSync(backupPath, content, 'utf-8');
      return { success: true, backupPath, content, contentHash };
    } catch (err) {
      return { success: false, error: err.message, content: null };
    }
  }

  rename(oldPath, newPath) {
    try {
      const resolvedOld = this._resolve(oldPath);
      const resolvedNew = this._resolve(newPath);
      if (!existsSync(resolvedOld)) {
        return { success: false, error: 'Source file not found' };
      }
      const dir = dirname(resolvedNew);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      renameSync(resolvedOld, resolvedNew);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _atomicWrite(resolvedPath, content) {
    const tmpPath = resolvedPath + '.tmp.' + randomUUID().slice(0, 8);
    try {
      writeFileSync(tmpPath, content, 'utf-8');
      renameSync(tmpPath, resolvedPath);
    } catch (err) {
      // Cleanup temp file on failure
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  _resolve(filePath) {
    return resolve(this.projectRoot, filePath);
  }
}
