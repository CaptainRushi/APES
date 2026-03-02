/**
 * Transaction — Multi-file atomic transaction with rollback
 *
 * Groups multiple workspace operations into an atomic unit.
 * If any operation fails, all previously applied operations are rolled back.
 *
 * Usage:
 *   const tx = engine.beginTransaction(agentContext);
 *   tx.addOperation('write', 'src/foo.js', { content: '...' });
 *   tx.addOperation('edit', 'src/bar.js', { edits: [...] });
 *   const result = await tx.commit();
 */

import { randomUUID } from 'node:crypto';

export class Transaction {
  constructor(txId, workspaceEngine, agentContext) {
    this.id = txId || 'tx-' + randomUUID().slice(0, 8);
    this.engine = workspaceEngine;
    this.agentContext = agentContext;
    this.operations = [];
    this.committed = false;
    this.rolledBack = false;
    this._backups = [];   // { index, path, content, existed }
    this._applied = [];   // operations that succeeded
    this.createdAt = Date.now();
  }

  addOperation(type, path, data = {}) {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already finalized');
    }
    const validTypes = ['write', 'edit', 'delete', 'mkdir'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid operation type: ${type}. Must be one of: ${validTypes.join(', ')}`);
    }
    this.operations.push({ type, path, data });
    return this; // chainable
  }

  async commit() {
    if (this.committed) return { success: false, error: 'Already committed' };
    if (this.rolledBack) return { success: false, error: 'Already rolled back' };
    if (this.operations.length === 0) return { success: true, results: [], diffs: [] };

    const results = [];
    const diffs = [];
    const ctx = { ...this.agentContext, txId: this.id };

    for (let i = 0; i < this.operations.length; i++) {
      const op = this.operations[i];

      // Take backup before mutation
      const backup = await this._takeBackup(op);
      this._backups.push({ index: i, ...backup });

      // Execute operation
      let result;
      try {
        result = await this._executeOp(op, ctx);
      } catch (err) {
        result = { success: false, error: err.message };
      }

      if (!result.success) {
        // Rollback everything applied so far
        const rollbackResult = await this.rollback();
        return {
          success: false,
          failedAt: i,
          failedOperation: { type: op.type, path: op.path },
          error: result.error,
          rolledBack: true,
          rollbackResult,
        };
      }

      this._applied.push(op);
      results.push(result);
      if (result.diff) diffs.push({ path: op.path, diff: result.diff });
    }

    this.committed = true;

    // Log transaction commit
    if (this.engine.auditLogger) {
      this.engine.auditLogger.log({
        agentId: this.agentContext.agentId,
        action: 'transaction_commit',
        path: null,
        success: true,
        txId: this.id,
        details: `${this.operations.length} operations committed`,
      });
    }

    return { success: true, results, diffs, txId: this.id };
  }

  async rollback() {
    if (this._applied.length === 0) {
      this.rolledBack = true;
      return { success: true, rolledBack: 0 };
    }

    let rolledBack = 0;

    // Restore in reverse order
    for (let i = this._backups.length - 1; i >= 0; i--) {
      const backup = this._backups[i];
      if (backup.index >= this._applied.length) continue;

      try {
        const op = this._applied[backup.index];
        switch (op.type) {
          case 'write':
            if (backup.existed) {
              // Restore original content
              this.engine.writer.write(op.path, backup.content, { atomic: true });
              if (backup.contentHash && this.engine.writeVerifier) {
                const verifyRes = this.engine.writeVerifier.verifyFile(op.path, backup.contentHash);
                if (!verifyRes.verified) console.warn(`[Transaction Rollback] Hash mismatch for ${op.path}`);
              }
            } else {
              // File didn't exist before — delete it
              this.engine.writer.delete(op.path);
            }
            rolledBack++;
            break;
          case 'edit':
            if (backup.content != null) {
              this.engine.writer.write(op.path, backup.content, { atomic: true });
              if (backup.contentHash && this.engine.writeVerifier) {
                const verifyRes = this.engine.writeVerifier.verifyFile(op.path, backup.contentHash);
                if (!verifyRes.verified) console.warn(`[Transaction Rollback] Hash mismatch for ${op.path}`);
              }
              rolledBack++;
            }
            break;
          case 'delete':
            if (backup.content != null) {
              this.engine.writer.write(op.path, backup.content, { atomic: true });
              if (backup.contentHash && this.engine.writeVerifier) {
                const verifyRes = this.engine.writeVerifier.verifyFile(op.path, backup.contentHash);
                if (!verifyRes.verified) console.warn(`[Transaction Rollback] Hash mismatch for ${op.path}`);
              }
              rolledBack++;
            }
            break;
          case 'mkdir':
            // Leave directories — safe to keep empty dirs
            break;
        }
      } catch (err) {
        console.warn(`[Transaction Rollback] Failed for ${op?.path}:`, err);
        // Best effort — continue rolling back other ops
      }
    }

    this.rolledBack = true;

    // Log rollback
    if (this.engine.auditLogger) {
      this.engine.auditLogger.log({
        agentId: this.agentContext.agentId,
        action: 'transaction_rollback',
        path: null,
        success: true,
        txId: this.id,
        details: `${rolledBack} operations rolled back`,
      });
    }

    return { success: true, rolledBack };
  }

  getStatus() {
    return {
      id: this.id,
      operationCount: this.operations.length,
      appliedCount: this._applied.length,
      committed: this.committed,
      rolledBack: this.rolledBack,
      createdAt: this.createdAt,
    };
  }

  getOperations() {
    return this.operations.map(op => ({
      type: op.type,
      path: op.path,
    }));
  }

  async _takeBackup(op) {
    if (op.type === 'mkdir') {
      return { path: op.path, existed: false, content: null };
    }
    const readResult = this.engine.reader.read(op.path);
    if (readResult.exists && readResult.content != null) {
      const contentHash = this.engine.writeVerifier ? this.engine.writeVerifier.hash(readResult.content) : null;
      return { path: op.path, existed: true, content: readResult.content, contentHash };
    }
    return { path: op.path, existed: false, content: null, contentHash: null };
  }

  async _executeOp(op, ctx) {
    switch (op.type) {
      case 'write':
        return this.engine.writeFile(op.path, op.data.content, ctx);
      case 'edit':
        return this.engine.editLines(op.path, op.data.edits, ctx);
      case 'delete':
        return this.engine.deleteFile(op.path, ctx);
      case 'mkdir':
        return this.engine.createDirectory(op.path, ctx);
      default:
        return { success: false, error: `Unknown operation: ${op.type}` };
    }
  }
}
