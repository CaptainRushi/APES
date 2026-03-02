/**
 * AuditLogger — Workspace operation audit trail
 *
 * Logs every workspace operation for traceability.
 * Stored at: ~/.apes/workspace/{sessionId}/audit/
 * Format: JSONL (one JSON object per line, daily rotation)
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export class AuditLogger {
  constructor(sessionId) {
    this.auditDir = join(homedir(), '.apes', 'workspace', sessionId || 'default', 'audit');
    this._ensureDir();
  }

  log(entry) {
    try {
      const record = {
        id: randomUUID().slice(0, 12),
        timestamp: Date.now(),
        pid: process.pid,
        agentId: entry.agentId || 'unknown',
        action: entry.action,
        path: entry.path || null,
        success: entry.success !== false,
        details: entry.details || null,
        diff: entry.diff || null,
        error: entry.error || null,
        txId: entry.txId || null,
        contentHash: entry.contentHash || null,
        verified: entry.verified ?? null,
      };
      const file = this._getCurrentFile();
      appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
      return { auditId: record.id };
    } catch {
      return { auditId: null };
    }
  }

  getEntries(options = {}) {
    const { agentId, action, path, since, limit = 100 } = options;
    const all = this._readAllEntries();
    let filtered = all;
    if (agentId) filtered = filtered.filter(e => e.agentId === agentId);
    if (action) filtered = filtered.filter(e => e.action === action);
    if (path) filtered = filtered.filter(e => e.path === path);
    if (since) filtered = filtered.filter(e => e.timestamp >= since);
    return filtered.slice(-limit);
  }

  getEntriesByTransaction(txId) {
    const all = this._readAllEntries();
    return all.filter(e => e.txId === txId);
  }

  getSummary() {
    const all = this._readAllEntries();
    const byAction = {};
    const byAgent = {};
    const errors = [];
    for (const entry of all) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      byAgent[entry.agentId] = (byAgent[entry.agentId] || 0) + 1;
      if (!entry.success) errors.push(entry);
    }
    return {
      totalEntries: all.length,
      byAction,
      byAgent,
      recentErrors: errors.slice(-5),
    };
  }

  clear() {
    try {
      const files = readdirSync(this.auditDir).filter(f => f.endsWith('.jsonl'));
      for (const f of files) {
        const { unlinkSync } = require('node:fs');
        unlinkSync(join(this.auditDir, f));
      }
    } catch { /* best effort */ }
  }

  _getCurrentFile() {
    const date = new Date().toISOString().slice(0, 10);
    return join(this.auditDir, `audit-${date}.jsonl`);
  }

  _readAllEntries() {
    try {
      const files = readdirSync(this.auditDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort();
      const entries = [];
      for (const f of files) {
        const content = readFileSync(join(this.auditDir, f), 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            entries.push(JSON.parse(line));
          } catch { /* skip malformed */ }
        }
      }
      return entries.sort((a, b) => a.timestamp - b.timestamp);
    } catch {
      return [];
    }
  }

  _ensureDir() {
    if (!existsSync(this.auditDir)) {
      mkdirSync(this.auditDir, { recursive: true });
    }
  }
}
