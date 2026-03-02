/**
 * Task Lock — Atomic File-Based Mutex for Distributed Task Claiming
 *
 * Prevents race conditions when multiple terminals try to claim the same task.
 * Uses atomic fs.rename() — only one terminal can successfully rename a file.
 *
 * Lock files stored in:  ~/.apes/sessions/{sessionId}/locks/
 * Task files moved from: tasks/pending → tasks/claimed → tasks/completed
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class TaskLock {
    /**
     * @param {string} sessionId
     */
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.baseDir = join(homedir(), '.apes', 'sessions', sessionId);
        this.locksDir = join(this.baseDir, 'locks');
        this.pendingDir = join(this.baseDir, 'tasks', 'pending');
        this.claimedDir = join(this.baseDir, 'tasks', 'claimed');
        this.completedDir = join(this.baseDir, 'tasks', 'completed');

        for (const d of [this.locksDir, this.pendingDir, this.claimedDir, this.completedDir]) {
            if (!existsSync(d)) mkdirSync(d, { recursive: true });
        }
    }

    /**
     * Attempt to claim a task atomically.
     * @param {string} taskId
     * @param {string} terminalId — The terminal claiming the task
     * @returns {{ success: boolean, task?: object, reason?: string }}
     */
    claimTask(taskId, terminalId) {
        const lockFile = join(this.locksDir, `${taskId}.lock`);

        // Check if already locked
        if (existsSync(lockFile)) {
            try {
                const lock = JSON.parse(readFileSync(lockFile, 'utf-8'));
                return { success: false, reason: `Already claimed by ${lock.terminalId}` };
            } catch {
                return { success: false, reason: 'Lock file exists but unreadable' };
            }
        }

        // Try to create lock atomically by writing lock + renaming task
        try {
            // Write lock file
            writeFileSync(lockFile, JSON.stringify({
                taskId,
                terminalId,
                lockedAt: Date.now(),
                pid: process.pid,
            }, null, 2), 'utf-8');

            // Move from pending → claimed
            const pendingFiles = readdirSync(this.pendingDir).filter(f => f.includes(taskId));
            if (pendingFiles.length > 0) {
                const src = join(this.pendingDir, pendingFiles[0]);
                const dst = join(this.claimedDir, `${terminalId}_${pendingFiles[0]}`);
                renameSync(src, dst);

                const taskData = JSON.parse(readFileSync(dst, 'utf-8'));
                taskData.claimedBy = terminalId;
                taskData.claimedAt = Date.now();
                writeFileSync(dst, JSON.stringify(taskData, null, 2), 'utf-8');

                return { success: true, task: taskData };
            }

            // Task not in pending — maybe already claimed
            unlinkSync(lockFile);
            return { success: false, reason: 'Task not found in pending queue' };
        } catch (err) {
            // Clean up lock file on failure
            try { unlinkSync(lockFile); } catch { /* ignore */ }
            return { success: false, reason: err.message };
        }
    }

    /**
     * Claim the next available pending task (highest priority first).
     * @param {string} terminalId
     * @returns {{ success: boolean, task?: object, reason?: string }}
     */
    claimNext(terminalId) {
        try {
            const pending = readdirSync(this.pendingDir)
                .filter(f => f.endsWith('.json'))
                .sort(); // Priority prefix sorts naturally (lower = higher priority)

            for (const file of pending) {
                // Extract taskId from filename like "5_task-001.json"
                const taskId = file.replace(/^\d+_/, '').replace('.json', '');

                // Skip if already locked
                if (existsSync(join(this.locksDir, `${taskId}.lock`))) continue;

                const result = this.claimTask(taskId, terminalId);
                if (result.success) return result;
            }

            return { success: false, reason: 'No pending tasks available' };
        } catch {
            return { success: false, reason: 'Error scanning pending tasks' };
        }
    }

    /**
     * Complete a claimed task (move to completed, release lock).
     * @param {string} taskId
     * @param {string} terminalId
     * @param {object} result
     */
    completeTask(taskId, terminalId, result = {}) {
        try {
            // Find the claimed file
            const claimed = readdirSync(this.claimedDir).filter(f => f.includes(taskId) && f.startsWith(terminalId));
            if (claimed.length === 0) return { success: false, reason: 'Task not found in claimed' };

            const src = join(this.claimedDir, claimed[0]);
            const dst = join(this.completedDir, claimed[0]);

            const data = JSON.parse(readFileSync(src, 'utf-8'));
            data.completedAt = Date.now();
            data.result = result;
            data.status = 'completed';
            writeFileSync(src, JSON.stringify(data, null, 2), 'utf-8');
            renameSync(src, dst);

            // Release lock
            const lockFile = join(this.locksDir, `${taskId}.lock`);
            try { unlinkSync(lockFile); } catch { /* ignore */ }

            return { success: true, task: data };
        } catch (err) {
            return { success: false, reason: err.message };
        }
    }

    /**
     * Release all locks held by a given terminal (cleanup on disconnect).
     */
    releaseAllLocks(terminalId) {
        try {
            const locks = readdirSync(this.locksDir).filter(f => f.endsWith('.lock'));
            let released = 0;
            for (const lockFile of locks) {
                try {
                    const data = JSON.parse(readFileSync(join(this.locksDir, lockFile), 'utf-8'));
                    if (data.terminalId === terminalId) {
                        unlinkSync(join(this.locksDir, lockFile));
                        released++;
                    }
                } catch { /* ignore */ }
            }
            return { released };
        } catch {
            return { released: 0 };
        }
    }

    /**
     * Check for stale locks (locks from crashed terminals).
     * @param {number} maxAge — Max lock age in ms (default 5 min)
     */
    cleanStaleLocks(maxAge = 300000) {
        try {
            const locks = readdirSync(this.locksDir).filter(f => f.endsWith('.lock'));
            let cleaned = 0;
            for (const lockFile of locks) {
                try {
                    const data = JSON.parse(readFileSync(join(this.locksDir, lockFile), 'utf-8'));
                    if (Date.now() - data.lockedAt > maxAge) {
                        unlinkSync(join(this.locksDir, lockFile));
                        cleaned++;
                    }
                } catch { /* ignore */ }
            }
            return { cleaned };
        } catch {
            return { cleaned: 0 };
        }
    }

    /**
     * Get lock status summary.
     */
    getStatus() {
        try {
            const locks = readdirSync(this.locksDir).filter(f => f.endsWith('.lock'));
            const pending = readdirSync(this.pendingDir).filter(f => f.endsWith('.json'));
            const claimed = readdirSync(this.claimedDir).filter(f => f.endsWith('.json'));
            const completed = readdirSync(this.completedDir).filter(f => f.endsWith('.json'));

            return {
                activeLocks: locks.length,
                pending: pending.length,
                claimed: claimed.length,
                completed: completed.length,
            };
        } catch {
            return { activeLocks: 0, pending: 0, claimed: 0, completed: 0 };
        }
    }
}
