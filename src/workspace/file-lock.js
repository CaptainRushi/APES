/**
 * FileLock — File-level mutex for workspace operations
 *
 * Prevents concurrent writes to the same file across agents/terminals.
 * Uses atomic fs.rename pattern (same as TaskLock in src/session/).
 *
 * Lock files stored at: ~/.apes/workspace/{sessionId}/locks/
 * Lock format: { filePath, agentId, pid, lockedAt }
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export class FileLock {
  constructor(sessionId) {
    this.locksDir = join(homedir(), '.apes', 'workspace', sessionId || 'default', 'locks');
    this._ensureDir();
    this.staleThreshold = 30000; // 30s
  }

  async acquire(filePath, agentId, timeout = 5000) {
    // Re-ensure the locks directory exists: it may have been deleted since
    // construction (e.g. by a cleanup routine or on a fresh install).
    this._ensureDir();

    const lockPath = this._lockPath(filePath);
    const startTime = Date.now();
    const backoffBase = 50;

    while (Date.now() - startTime < timeout) {
      // Check for stale lock and clean it
      if (existsSync(lockPath)) {
        try {
          const data = JSON.parse(readFileSync(lockPath, 'utf-8'));
          if (this._isStale(data)) {
            try { unlinkSync(lockPath); } catch { /* race */ }
          } else {
            // Lock held by another agent — wait
            const elapsed = Date.now() - startTime;
            if (elapsed >= timeout) break;
            await this._sleep(Math.min(backoffBase * Math.pow(2, Math.floor(elapsed / backoffBase)), 500));
            continue;
          }
        } catch {
          // Corrupted lock file — remove
          try { unlinkSync(lockPath); } catch { /* race */ }
        }
      }

      // Try to acquire
      try {
        const lockData = {
          filePath,
          agentId,
          pid: process.pid,
          lockedAt: Date.now(),
        };
        // Write atomically using exclusive flag
        writeFileSync(lockPath, JSON.stringify(lockData), { flag: 'wx' });
        return { success: true, lockId: this._hash(filePath) };
      } catch (err) {
        if (err.code === 'EEXIST') {
          // Another process acquired first — retry
          await this._sleep(backoffBase);
          continue;
        }
        return { success: false, reason: err.message };
      }
    }

    // Timeout reached
    let holder = 'unknown';
    try {
      const data = JSON.parse(readFileSync(lockPath, 'utf-8'));
      holder = data.agentId;
    } catch { /* ignore */ }
    return { success: false, reason: `Lock timeout — held by ${holder}` };
  }

  release(filePath) {
    try {
      const lockPath = this._lockPath(filePath);
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
      return { success: true };
    } catch {
      return { success: true }; // Best effort
    }
  }

  releaseAll(agentId) {
    let released = 0;
    try {
      const files = readdirSync(this.locksDir).filter(f => f.endsWith('.lock'));
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(join(this.locksDir, f), 'utf-8'));
          if (data.agentId === agentId) {
            unlinkSync(join(this.locksDir, f));
            released++;
          }
        } catch { /* skip */ }
      }
    } catch { /* dir may not exist */ }
    return { released };
  }

  isLocked(filePath) {
    const lockPath = this._lockPath(filePath);
    if (!existsSync(lockPath)) {
      return { locked: false };
    }
    try {
      const data = JSON.parse(readFileSync(lockPath, 'utf-8'));
      if (this._isStale(data)) {
        try { unlinkSync(lockPath); } catch { /* race */ }
        return { locked: false };
      }
      return { locked: true, holder: data.agentId, lockedAt: data.lockedAt };
    } catch {
      return { locked: false };
    }
  }

  cleanStaleLocks(maxAge) {
    const threshold = maxAge || this.staleThreshold;
    let cleaned = 0;
    try {
      const files = readdirSync(this.locksDir).filter(f => f.endsWith('.lock'));
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(join(this.locksDir, f), 'utf-8'));
          if (this._isStale(data, threshold)) {
            unlinkSync(join(this.locksDir, f));
            cleaned++;
          }
        } catch {
          // Corrupted lock — clean it
          try { unlinkSync(join(this.locksDir, f)); cleaned++; } catch { /* race */ }
        }
      }
    } catch { /* dir may not exist */ }
    return { cleaned };
  }

  getStatus() {
    try {
      const files = readdirSync(this.locksDir).filter(f => f.endsWith('.lock'));
      const locks = [];
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(join(this.locksDir, f), 'utf-8'));
          if (!this._isStale(data)) {
            locks.push(data);
          }
        } catch { /* skip */ }
      }
      return { activeLocks: locks.length, locks };
    } catch {
      return { activeLocks: 0, locks: [] };
    }
  }

  _lockPath(filePath) {
    return join(this.locksDir, this._hash(filePath) + '.lock');
  }

  _hash(filePath) {
    return createHash('md5').update(filePath).digest('hex');
  }

  _isStale(lockData, maxAge) {
    return Date.now() - lockData.lockedAt > (maxAge || this.staleThreshold);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  _ensureDir() {
    if (!existsSync(this.locksDir)) {
      mkdirSync(this.locksDir, { recursive: true });
    }
  }
}
