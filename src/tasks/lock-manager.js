/**
 * Distributed Lock Manager — Parallel-Safe Task Execution
 *
 * Provides mutual exclusion for shared resources across agents/terminals:
 *   - Task-level locks (only one agent works on a task at a time)
 *   - File-level locks (prevents concurrent file writes)
 *   - Session-level locks (coordinates shared session state)
 *
 * Supports lock acquisition, release, timeout-based auto-release,
 * and deadlock detection via wait-for graph analysis.
 */

import { EventEmitter } from 'node:events';

export class LockManager extends EventEmitter {
    constructor({ defaultTimeoutMs = 30000 } = {}) {
        super();
        this.defaultTimeoutMs = defaultTimeoutMs;

        /** @type {Map<string, { owner: string, acquiredAt: number, timeoutMs: number, timer: any }>} */
        this.locks = new Map();

        /** @type {Map<string, { resolve: Function, reject: Function, agentId: string }[]>} */
        this.waitQueues = new Map();
    }

    /**
     * Acquire a lock. Returns true if acquired, false if already held by another agent.
     * @param {string} resourceId
     * @param {string} agentId
     * @param {number} [timeoutMs]
     * @returns {boolean}
     */
    acquire(resourceId, agentId, timeoutMs) {
        const existing = this.locks.get(resourceId);

        if (existing) {
            if (existing.owner === agentId) return true; // re-entrant
            return false;
        }

        const timeout = timeoutMs || this.defaultTimeoutMs;
        const timer = setTimeout(() => this._autoRelease(resourceId), timeout);
        if (timer.unref) timer.unref();

        this.locks.set(resourceId, { owner: agentId, acquiredAt: Date.now(), timeoutMs: timeout, timer });
        this.emit('lock:acquired', { resourceId, agentId });
        return true;
    }

    /**
     * Acquire a lock, waiting if necessary.
     * @param {string} resourceId
     * @param {string} agentId
     * @param {number} [waitTimeoutMs=10000]
     * @returns {Promise<boolean>}
     */
    async acquireAsync(resourceId, agentId, waitTimeoutMs = 10000) {
        if (this.acquire(resourceId, agentId)) return true;

        return new Promise((resolve, reject) => {
            if (!this.waitQueues.has(resourceId)) this.waitQueues.set(resourceId, []);
            const entry = { resolve, reject, agentId };
            this.waitQueues.get(resourceId).push(entry);

            const timer = setTimeout(() => {
                const queue = this.waitQueues.get(resourceId);
                if (queue) {
                    const idx = queue.indexOf(entry);
                    if (idx >= 0) queue.splice(idx, 1);
                }
                resolve(false);
            }, waitTimeoutMs);
            if (timer.unref) timer.unref();
        });
    }

    /**
     * Release a lock.
     * @param {string} resourceId
     * @param {string} agentId
     * @returns {boolean}
     */
    release(resourceId, agentId) {
        const lock = this.locks.get(resourceId);
        if (!lock) return false;
        if (lock.owner !== agentId) return false;

        clearTimeout(lock.timer);
        this.locks.delete(resourceId);
        this.emit('lock:released', { resourceId, agentId });

        // Wake next waiter
        this._processWaitQueue(resourceId);
        return true;
    }

    /**
     * Force-release a lock (admin/failover).
     * @param {string} resourceId
     */
    forceRelease(resourceId) {
        const lock = this.locks.get(resourceId);
        if (lock) clearTimeout(lock.timer);
        this.locks.delete(resourceId);
        this.emit('lock:force-released', { resourceId });
        this._processWaitQueue(resourceId);
    }

    /**
     * Check if a resource is locked.
     * @param {string} resourceId
     * @returns {{ locked: boolean, owner?: string }}
     */
    isLocked(resourceId) {
        const lock = this.locks.get(resourceId);
        return lock ? { locked: true, owner: lock.owner } : { locked: false };
    }

    /** @private */
    _autoRelease(resourceId) {
        const lock = this.locks.get(resourceId);
        if (lock) {
            this.emit('lock:timeout', { resourceId, owner: lock.owner });
            this.locks.delete(resourceId);
            this._processWaitQueue(resourceId);
        }
    }

    /** @private */
    _processWaitQueue(resourceId) {
        const queue = this.waitQueues.get(resourceId);
        if (!queue || queue.length === 0) return;
        const next = queue.shift();
        if (this.acquire(resourceId, next.agentId)) {
            next.resolve(true);
        } else {
            next.resolve(false);
        }
    }

    /**
     * Detect potential deadlocks using a wait-for graph cycle check.
     * @returns {{ hasDeadlock: boolean, cycle?: string[] }}
     */
    detectDeadlocks() {
        // Build wait-for graph: agentId → set of agentIds it's waiting on
        const graph = new Map();
        for (const [resourceId, queue] of this.waitQueues) {
            const lock = this.locks.get(resourceId);
            if (!lock || !queue) continue;
            for (const waiter of queue) {
                if (!graph.has(waiter.agentId)) graph.set(waiter.agentId, new Set());
                graph.get(waiter.agentId).add(lock.owner);
            }
        }

        // DFS cycle detection
        const visited = new Set();
        const stack = new Set();
        const path = [];

        const dfs = (node) => {
            visited.add(node);
            stack.add(node);
            path.push(node);

            const neighbors = graph.get(node) || new Set();
            for (const n of neighbors) {
                if (stack.has(n)) return [...path, n];
                if (!visited.has(n)) {
                    const cycle = dfs(n);
                    if (cycle) return cycle;
                }
            }

            stack.delete(node);
            path.pop();
            return null;
        };

        for (const node of graph.keys()) {
            if (!visited.has(node)) {
                const cycle = dfs(node);
                if (cycle) return { hasDeadlock: true, cycle };
            }
        }

        return { hasDeadlock: false };
    }

    getStatus() {
        return {
            activeLocks: this.locks.size,
            waitingRequests: [...this.waitQueues.values()].reduce((s, q) => s + q.length, 0),
            locks: [...this.locks.entries()].map(([r, l]) => ({ resource: r, owner: l.owner, heldMs: Date.now() - l.acquiredAt })),
        };
    }
}
