/**
 * Task Claimer
 *
 * Atomic file-lock based autonomous task claiming.
 * Uses fs.rename() for atomic claim operations.
 * Agents claim tasks from a shared queue; each task is claimed by exactly one agent.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class TaskClaimer {
    /**
     * @param {string} [teamId='default']
     */
    constructor(teamId = 'default') {
        this.teamId = teamId;
        this.baseDir = join(homedir(), '.apes', 'teams', teamId, 'tasks');
        this.pendingDir = join(this.baseDir, 'pending');
        this.claimedDir = join(this.baseDir, 'claimed');
        this.completedDir = join(this.baseDir, 'completed');
        this._ensureDirs();
    }

    _ensureDirs() {
        for (const dir of [this.pendingDir, this.claimedDir, this.completedDir]) {
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
        }
    }

    /**
     * Add a task to the pending queue.
     * @param {{ id: string, description: string, priority?: number, cluster?: string }} task
     */
    addTask(task) {
        const filename = `${task.priority ?? 5}_${task.id}.json`;
        const filepath = join(this.pendingDir, filename);
        writeFileSync(filepath, JSON.stringify({ ...task, addedAt: Date.now() }, null, 2), 'utf-8');
    }

    /**
     * Claim the highest-priority pending task for an agent.
     * Uses atomic rename for lock-free claiming.
     * @param {string} agentId
     * @returns {object|null} The claimed task, or null if none available
     */
    claim(agentId) {
        const pending = this._listPending();
        if (pending.length === 0) return null;

        // Sort by priority (lower number = higher priority), then by name
        pending.sort();

        for (const filename of pending) {
            const src = join(this.pendingDir, filename);
            const dst = join(this.claimedDir, `${agentId}_${filename}`);

            try {
                // Atomic rename — only one agent can succeed
                renameSync(src, dst);

                // Read the task data
                const data = JSON.parse(readFileSync(dst, 'utf-8'));
                return { ...data, claimedBy: agentId, claimedAt: Date.now() };
            } catch {
                // Another agent claimed it first — try next
                continue;
            }
        }

        return null;
    }

    /**
     * Mark a claimed task as completed.
     * @param {string} agentId
     * @param {string} taskId
     * @param {object} [result]
     */
    complete(agentId, taskId, result = {}) {
        const claimed = this._listClaimed();
        const match = claimed.find(f => f.includes(taskId) && f.startsWith(agentId));
        if (!match) return;

        const src = join(this.claimedDir, match);
        const dst = join(this.completedDir, match);

        try {
            const data = JSON.parse(readFileSync(src, 'utf-8'));
            data.completedAt = Date.now();
            data.result = result;
            writeFileSync(src, JSON.stringify(data, null, 2), 'utf-8');
            renameSync(src, dst);
        } catch {
            // Best effort
        }
    }

    /**
     * List pending task files.
     * @returns {string[]}
     */
    _listPending() {
        try {
            return readdirSync(this.pendingDir).filter(f => f.endsWith('.json'));
        } catch {
            return [];
        }
    }

    /**
     * List claimed task files.
     * @returns {string[]}
     */
    _listClaimed() {
        try {
            return readdirSync(this.claimedDir).filter(f => f.endsWith('.json'));
        } catch {
            return [];
        }
    }

    /**
     * Get queue status.
     */
    getStatus() {
        return {
            pending: this._listPending().length,
            claimed: this._listClaimed().length,
            completed: (() => {
                try { return readdirSync(this.completedDir).filter(f => f.endsWith('.json')).length; } catch { return 0; }
            })(),
        };
    }
}
