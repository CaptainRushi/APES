/**
 * WorkspaceEngine — Central workspace action controller
 *
 * Coordinates all workspace operations for APES agents:
 *   - Delegates read/write/edit/delete to sub-modules
 *   - Enforces permission checks via PermissionGuard
 *   - Acquires file locks via FileLock
 *   - Generates diffs before mutations
 *   - Logs all operations via AuditLogger
 *   - Supports multi-file transactions with rollback
 *
 * Integration:
 *   - Injected into context by Orchestrator (context.workspaceEngine)
 *   - Exposed to agents as workspace skills in SkillsLayer
 */

import { resolve } from 'node:path';
import { FileReader } from './file-reader.js';
import { FileWriter } from './file-writer.js';
import { LineEditor } from './line-editor.js';
import { DiffGenerator } from './diff-generator.js';
import { FileLock } from './file-lock.js';
import { PermissionGuard } from './permission-guard.js';
import { AuditLogger } from './audit-logger.js';
import { Transaction } from './transaction.js';
import { RepoAnalyzer } from './repo-analyzer.js';
import { WriteVerifier } from './write-verifier.js';

export class WorkspaceEngine {
  constructor(projectRoot, options = {}) {
    this.projectRoot = resolve(projectRoot);
    this.reader = new FileReader(this.projectRoot);
    this.writer = new FileWriter(this.projectRoot);
    this.editor = new LineEditor(this.projectRoot);
    this.diffGenerator = new DiffGenerator();
    this.fileLock = new FileLock(options.sessionId);
    this.permissionGuard = new PermissionGuard(this.projectRoot, options);
    this.auditLogger = new AuditLogger(options.sessionId);
    this.repoAnalyzer = new RepoAnalyzer(this.projectRoot);
    this.writeVerifier = new WriteVerifier(this.projectRoot);
    this.messageBus = options.messageBus || null;
    this._activeTransactions = new Map();
    this._operationCount = 0;
  }

  async readFile(filePath, agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    // Permission check
    const perm = this.permissionGuard.checkPermission(agentId, 'read', filePath);
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    const result = this.reader.read(filePath);
    this._operationCount++;

    this.auditLogger.log({
      agentId,
      action: 'read',
      path: filePath,
      success: result.exists,
      txId: agentContext.txId,
    });

    this._publishEvent('workspace', 'workspace:file_read', { agentId, path: filePath });

    return { success: result.exists !== false, ...result };
  }

  async writeFile(filePath, content, agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    // Permission check
    const perm = this.permissionGuard.checkPermission(agentId, 'write', filePath);
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    // Acquire lock
    const lock = await this.fileLock.acquire(filePath, agentId);
    if (!lock.success) {
      return { success: false, error: `Lock failed: ${lock.reason}` };
    }

    try {
      // Read original for diff
      const original = this.reader.read(filePath);
      const beforeContent = original.exists ? original.content : '';

      // Write
      const result = this.writer.write(filePath, content, { verify: true });
      if (!result.success) {
        return result;
      }
      if (result.verified === false) {
        return { success: false, error: 'Verification failed: read-back hash mismatch (possible disk corruption)' };
      }

      // Generate diff
      const diff = this.diffGenerator.unified(beforeContent, content, filePath);
      const diffSummary = this.diffGenerator.summary(beforeContent, content);

      this._operationCount++;

      const { auditId } = this.auditLogger.log({
        agentId,
        action: 'write',
        path: filePath,
        success: true,
        diff,
        txId: agentContext.txId,
        contentHash: result.contentHash,
        verified: result.verified,
        details: `+${diffSummary.additions} -${diffSummary.deletions}`,
      });

      this._publishEvent('workspace', 'workspace:file_written', {
        agentId, path: filePath, diff,
      });

      return { success: true, diff, ...diffSummary, bytesWritten: result.bytesWritten, auditId, contentHash: result.contentHash, verified: result.verified };
    } finally {
      this.fileLock.release(filePath);
    }
  }

  async editLines(filePath, edits, agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    // Permission check
    const perm = this.permissionGuard.checkPermission(agentId, 'edit', filePath);
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    // Acquire lock
    const lock = await this.fileLock.acquire(filePath, agentId);
    if (!lock.success) {
      return { success: false, error: `Lock failed: ${lock.reason}` };
    }

    try {
      const result = this.editor.applyEdits(filePath, edits);
      if (!result.success) {
        return result;
      }

      const verifyResult = this.writeVerifier.verifyWrite(filePath, result.after);
      if (!verifyResult.verified) {
        return { success: false, error: 'Verification failed: read-back hash mismatch after edit (possible disk corruption)' };
      }

      // Generate diff
      const diff = this.diffGenerator.unified(result.before, result.after, filePath);
      const diffSummary = this.diffGenerator.summary(result.before, result.after);

      this._operationCount++;

      const { auditId } = this.auditLogger.log({
        agentId,
        action: 'edit',
        path: filePath,
        success: true,
        diff,
        txId: agentContext.txId,
        contentHash: verifyResult.contentHash,
        verified: verifyResult.verified,
        details: `${result.linesChanged} lines changed`,
      });

      this._publishEvent('workspace', 'workspace:file_edited', {
        agentId, path: filePath, diff, linesChanged: result.linesChanged,
      });

      return { success: true, diff, linesChanged: result.linesChanged, ...diffSummary, auditId, contentHash: verifyResult.contentHash, verified: verifyResult.verified };
    } finally {
      this.fileLock.release(filePath);
    }
  }

  async createDirectory(dirPath, agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    const perm = this.permissionGuard.checkPermission(agentId, 'write', dirPath);
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    const result = this.writer.mkdir(dirPath);
    this._operationCount++;

    this.auditLogger.log({
      agentId,
      action: 'mkdir',
      path: dirPath,
      success: result.success,
      txId: agentContext.txId,
    });

    return result;
  }

  async deleteFile(filePath, agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    // Permission check
    const perm = this.permissionGuard.checkPermission(agentId, 'delete', filePath);
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    // Acquire lock
    const lock = await this.fileLock.acquire(filePath, agentId);
    if (!lock.success) {
      return { success: false, error: `Lock failed: ${lock.reason}` };
    }

    try {
      // Read content for audit backup
      const original = this.reader.read(filePath);
      const beforeContent = original.exists ? original.content : '';

      const result = this.writer.delete(filePath);
      if (!result.success) {
        return result;
      }

      const stillExists = this.writeVerifier.fileExists(filePath);
      if (stillExists) {
        return { success: false, error: 'Verification failed: file still exists after deletion' };
      }

      const diff = this.diffGenerator.unified(beforeContent, '', filePath);

      this._operationCount++;

      const { auditId } = this.auditLogger.log({
        agentId,
        action: 'delete',
        path: filePath,
        success: true,
        diff,
        txId: agentContext.txId,
        contentHash: null,
        verified: true,
        details: `Deleted file (${beforeContent.length} bytes)`,
      });

      this._publishEvent('workspace', 'workspace:file_deleted', { agentId, path: filePath });

      return { success: true, diff, auditId, verified: true };
    } finally {
      this.fileLock.release(filePath);
    }
  }

  async previewDiff(filePath, edits, agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    // Only needs read permission — preview doesn't mutate
    const perm = this.permissionGuard.checkPermission(agentId, 'read', filePath);
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    const original = this.reader.read(filePath);
    if (!original.exists) {
      return { success: false, error: 'File not found' };
    }

    const { diff, after } = this.diffGenerator.fromEdits(original.content, edits);
    const summary = this.diffGenerator.summary(original.content, after);
    const colorized = this.diffGenerator.colorized(diff);

    return { success: true, diff, colorized, ...summary };
  }

  async analyzeRepo(agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    const perm = this.permissionGuard.checkPermission(agentId, 'read', '.');
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    const analysis = this.repoAnalyzer.analyze();
    this._operationCount++;

    this.auditLogger.log({
      agentId,
      action: 'analyze',
      path: '.',
      success: true,
      txId: agentContext.txId,
    });

    return { success: true, ...analysis };
  }

  async findFiles(pattern, directory, agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    const perm = this.permissionGuard.checkPermission(agentId, 'read', directory || '.');
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    const files = this.reader.findFiles(pattern, directory);
    return { success: true, files, count: files.length };
  }

  async readLines(filePath, startLine, endLine, agentContext = {}) {
    const agentId = agentContext.agentId || 'system';

    const perm = this.permissionGuard.checkPermission(agentId, 'read', filePath);
    if (!perm.allowed) {
      return { success: false, error: perm.reason };
    }

    const result = this.reader.readLines(filePath, startLine, endLine);
    return { success: !result.error, ...result };
  }

  beginTransaction(agentContext = {}) {
    const tx = new Transaction(null, this, agentContext);
    this._activeTransactions.set(tx.id, tx);
    return tx;
  }

  async commitTransaction(txId) {
    const tx = this._activeTransactions.get(txId);
    if (!tx) return { success: false, error: `Transaction ${txId} not found` };
    const result = await tx.commit();
    if (result.success || result.rolledBack) {
      this._activeTransactions.delete(txId);
    }

    if (result.success) {
      this._publishEvent('workspace', 'workspace:transaction_committed', {
        agentId: tx.agentContext.agentId,
        txId,
        operationCount: tx.operations.length,
      });
    }

    return result;
  }

  async rollbackTransaction(txId) {
    const tx = this._activeTransactions.get(txId);
    if (!tx) return { success: false, error: `Transaction ${txId} not found` };
    const result = await tx.rollback();
    this._activeTransactions.delete(txId);

    this._publishEvent('workspace', 'workspace:transaction_rolledback', {
      agentId: tx.agentContext.agentId,
      txId,
      reason: 'manual',
    });

    return result;
  }

  getStatus() {
    return {
      projectRoot: this.projectRoot,
      activeLocks: this.fileLock.getStatus().activeLocks,
      activeTransactions: this._activeTransactions.size,
      totalOperations: this._operationCount,
      permissions: this.permissionGuard.getSummary(),
      audit: this.auditLogger.getSummary(),
    };
  }

  _publishEvent(channel, type, data) {
    if (this.messageBus) {
      try {
        this.messageBus.publish({
          type,
          channel,
          timestamp: Date.now(),
          ...data,
        });
      } catch { /* best effort */ }
    }
  }
}
