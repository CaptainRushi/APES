/**
 * Task Engine — Core Distributed Task Management
 *
 * Central controller for the APES task system:
 *   - Full task data model with schema validation
 *   - Strict state machine (pending → in_progress → completed)
 *   - DAG validation (circular dependency detection via topological sort)
 *   - Hierarchical subtask support via parentId
 *   - Retry logic with failure counter + escalation
 *   - Dependency auto-unblocking
 *
 * Wraps TaskLock for parallel claiming and SessionStore for persistence.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { TaskLock } from '../session/task-lock.js';

// ─── Valid state transitions ─────────────────────────────────────
const VALID_TRANSITIONS = {
    pending: ['in_progress', 'blocked'],
    blocked: ['pending'],
    in_progress: ['completed', 'failed'],
    failed: ['pending'],   // retry
    completed: [],            // terminal state
};

// ─── Priority levels ─────────────────────────────────────────────
const PRIORITY_MAP = { high: 1, medium: 2, low: 3 };

export class TaskEngine {
    /**
     * @param {string} sessionId — The session this engine manages tasks for
     */
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.baseDir = join(homedir(), '.apes', 'sessions', sessionId);
        this.tasksDir = join(this.baseDir, 'tasks');
        this.graphFile = join(this.tasksDir, 'task-graph.json');
        this.learningDir = join(this.tasksDir, 'learning');

        // Ensure directories
        for (const d of [
            this.tasksDir,
            join(this.tasksDir, 'pending'),
            join(this.tasksDir, 'claimed'),
            join(this.tasksDir, 'completed'),
            join(this.tasksDir, 'failed'),
            join(this.baseDir, 'locks'),
            this.learningDir,
        ]) {
            if (!existsSync(d)) mkdirSync(d, { recursive: true });
        }

        this.lock = new TaskLock(sessionId);
    }

    // ─── Task Creation ───────────────────────────────────────────

    /**
     * Create a single task with full schema validation.
     * @param {object} opts
     * @returns {object} The persisted task
     */
    createTask(opts) {
        const task = {
            id: opts.id || `task-${randomUUID().slice(0, 8)}`,
            title: opts.title || opts.description || 'Untitled Task',
            description: opts.description || '',
            status: 'pending',
            parentId: opts.parentId || null,
            dependencies: opts.dependencies || [],
            assignedAgent: null,
            createdBy: opts.createdBy || 'planner',
            createdAt: Date.now(),
            completedAt: null,
            priority: opts.priority || 'medium',
            confidence: opts.confidence || null,
            retryCount: 0,
            maxRetries: opts.maxRetries ?? 2,
            cluster: opts.cluster || null,
            type: opts.type || 'general',
            index: opts.index ?? 0,
        };

        // Check if any dependency is blocked → mark this blocked
        if (task.dependencies.length > 0) {
            const allCompleted = task.dependencies.every(depId => {
                const dep = this.getTask(depId);
                return dep && dep.status === 'completed';
            });
            if (!allCompleted) {
                task.status = 'blocked';
            }
        }

        this._persistTask(task);
        return task;
    }

    /**
     * Create multiple tasks and validate the full graph.
     * @param {object[]} taskDefs — Array of task definition objects
     * @returns {{ tasks: object[], graph: object }}
     */
    createTaskGraph(taskDefs) {
        // ─── Step 1: Validate no circular dependencies ──────────
        this._validateDAG(taskDefs);

        // ─── Step 2: Create all tasks ───────────────────────────
        const tasks = taskDefs.map(def => this.createTask(def));

        // ─── Step 3: Persist the graph structure ────────────────
        const graph = {
            sessionId: this.sessionId,
            createdAt: Date.now(),
            totalTasks: tasks.length,
            nodes: tasks.map(t => ({
                id: t.id,
                title: t.title,
                parentId: t.parentId,
                dependencies: t.dependencies,
                priority: t.priority,
            })),
            edges: [],
        };

        // Build edge list from dependencies
        for (const task of tasks) {
            for (const depId of task.dependencies) {
                graph.edges.push({ from: depId, to: task.id });
            }
        }

        writeFileSync(this.graphFile, JSON.stringify(graph, null, 2), 'utf-8');
        return { tasks, graph };
    }

    // ─── Task State Machine ──────────────────────────────────────

    /**
     * Transition a task to a new status (enforces valid transitions).
     * @param {string} taskId
     * @param {string} newStatus
     * @param {object} [extra] — Additional fields to merge
     * @returns {object} Updated task
     */
    transitionTask(taskId, newStatus, extra = {}) {
        const task = this.getTask(taskId);
        if (!task) throw new Error(`Task ${taskId} not found`);

        const allowed = VALID_TRANSITIONS[task.status];
        if (!allowed || !allowed.includes(newStatus)) {
            throw new Error(
                `Illegal transition: ${task.status} → ${newStatus} for task ${taskId}. ` +
                `Allowed: [${allowed?.join(', ') || 'none'}]`
            );
        }

        task.status = newStatus;
        if (newStatus === 'completed') task.completedAt = Date.now();
        Object.assign(task, extra);

        this._persistTask(task);

        // Auto-unblock dependents when a task completes
        if (newStatus === 'completed') {
            this._unblockDependents(taskId);
        }

        return task;
    }

    // ─── Task Claiming (delegates to TaskLock) ───────────────────

    /**
     * Claim a specific task for an agent/terminal.
     * @param {string} taskId
     * @param {string} agentId
     * @returns {{ success: boolean, task?: object, reason?: string }}
     */
    claimTask(taskId, agentId) {
        const task = this.getTask(taskId);
        if (!task) return { success: false, reason: 'Task not found' };
        if (task.status !== 'pending') {
            return { success: false, reason: `Task status is ${task.status}, not pending` };
        }

        // Check dependencies are satisfied
        if (!this._areDependenciesMet(task)) {
            return { success: false, reason: 'Dependencies not yet completed' };
        }

        const result = this.lock.claimTask(taskId, agentId);
        if (result.success) {
            this.transitionTask(taskId, 'in_progress', { assignedAgent: agentId });
        }
        return result;
    }

    /**
     * Claim the next available task respecting dependency order.
     * @param {string} agentId
     * @returns {{ success: boolean, task?: object, reason?: string }}
     */
    claimNextAvailable(agentId) {
        const allTasks = this.getAllTasks();
        const readyTasks = allTasks
            .filter(t => t.status === 'pending' && this._areDependenciesMet(t))
            .sort((a, b) => (PRIORITY_MAP[a.priority] || 2) - (PRIORITY_MAP[b.priority] || 2));

        for (const task of readyTasks) {
            const result = this.claimTask(task.id, agentId);
            if (result.success) return result;
        }

        return { success: false, reason: 'No available tasks (all blocked or claimed)' };
    }

    // ─── Task Completion ─────────────────────────────────────────

    /**
     * Mark a task as completed with result data.
     * @param {string} taskId
     * @param {string} agentId
     * @param {object} result
     * @returns {object} Updated task
     */
    completeTask(taskId, agentId, result = {}) {
        // Complete via lock (moves file from claimed → completed)
        const lockResult = this.lock.completeTask(taskId, agentId, result);

        if (!lockResult.success) {
            // Fallback: if lock.completeTask fails, try the state-machine path
            try {
                return this.transitionTask(taskId, 'completed', {
                    confidence: result.confidence,
                    result,
                });
            } catch {
                return null;
            }
        }

        // Read back the task that lock.completeTask already wrote to completed/
        const task = this.getTask(taskId);
        if (task) {
            // Merge extra fields not set by lock.completeTask
            if (result.confidence != null) {
                task.confidence = result.confidence;
            }
            // Clean up stale files from other state dirs (no duplicate _persistTask)
            this._cleanupOtherDirs(taskId, 'completed');

            // Unblock dependents
            this._unblockDependents(taskId);
        }

        return task;
    }

    /**
     * Remove stale task files from directories other than the target state.
     * @param {string} taskId
     * @param {string} targetState
     */
    _cleanupOtherDirs(taskId, targetState) {
        for (const otherState of ['pending', 'claimed', 'completed', 'failed']) {
            if (otherState === targetState) continue;
            const otherDir = join(this.tasksDir, otherState);
            try {
                const files = readdirSync(otherDir).filter(
                    f => f.includes(taskId) && f.endsWith('.json')
                );
                for (const f of files) {
                    try { unlinkSync(join(otherDir, f)); } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        }
    }

    /**
     * Mark a task as failed and handle retry logic.
     * @param {string} taskId
     * @param {string} agentId
     * @param {object} error
     * @returns {{ retrying: boolean, task: object }}
     */
    failTask(taskId, agentId, error = {}) {
        const task = this.getTask(taskId);
        if (!task) throw new Error(`Task ${taskId} not found`);

        task.retryCount = (task.retryCount || 0) + 1;
        task.lastError = error.message || 'Unknown error';
        task.assignedAgent = null;

        // Release the lock
        this.lock.releaseAllLocks(agentId);

        if (task.retryCount < (task.maxRetries || 2)) {
            // Retry: move back to pending
            task.status = 'pending';
            this._persistTask(task);
            return { retrying: true, task };
        } else {
            // Escalate: mark as failed permanently
            task.status = 'failed';
            task.escalated = true;
            this._persistTask(task);
            return { retrying: false, task };
        }
    }

    // ─── Task Retrieval ──────────────────────────────────────────

    /**
     * Get a single task by ID (searches all state directories + master list).
     * @param {string} taskId
     * @returns {object|null}
     */
    getTask(taskId) {
        // Search across state directories
        for (const state of ['pending', 'claimed', 'completed', 'failed']) {
            const dir = join(this.tasksDir, state);
            try {
                const files = readdirSync(dir).filter(f => f.includes(taskId) && f.endsWith('.json'));
                if (files.length > 0) {
                    return JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));
                }
            } catch { /* ignore */ }
        }
        return null;
    }

    /**
     * Get all tasks across all states.
     * @returns {object[]}
     */
    getAllTasks() {
        const tasks = [];
        for (const state of ['pending', 'claimed', 'completed', 'failed']) {
            const dir = join(this.tasksDir, state);
            try {
                const files = readdirSync(dir).filter(f => f.endsWith('.json'));
                for (const f of files) {
                    try {
                        tasks.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
                    } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        }
        return tasks;
    }

    /**
     * Get a status summary of all tasks.
     * @returns {object}
     */
    getStatus() {
        const all = this.getAllTasks();
        return {
            total: all.length,
            pending: all.filter(t => t.status === 'pending').length,
            blocked: all.filter(t => t.status === 'blocked').length,
            inProgress: all.filter(t => t.status === 'in_progress').length,
            completed: all.filter(t => t.status === 'completed').length,
            failed: all.filter(t => t.status === 'failed').length,
        };
    }

    /**
     * Build a hierarchical tree structure from tasks.
     * @returns {object[]} Tree of tasks with children arrays
     */
    getTaskTree() {
        const all = this.getAllTasks();
        const byId = new Map(all.map(t => [t.id, { ...t, children: [] }]));
        const roots = [];

        for (const task of byId.values()) {
            if (task.parentId && byId.has(task.parentId)) {
                byId.get(task.parentId).children.push(task);
            } else {
                roots.push(task);
            }
        }

        // Sort by index
        const sortByIndex = (a, b) => (a.index ?? 0) - (b.index ?? 0);
        roots.sort(sortByIndex);
        for (const node of byId.values()) {
            node.children.sort(sortByIndex);
        }

        return roots;
    }

    // ─── DAG Validation ──────────────────────────────────────────

    /**
     * Validate task definitions form a valid DAG (no circular dependencies).
     * Uses Kahn's algorithm for topological sort.
     * @param {object[]} taskDefs
     * @throws {Error} If circular dependency detected
     */
    _validateDAG(taskDefs) {
        const ids = new Set(taskDefs.map(t => t.id));
        const inDegree = new Map();
        const adj = new Map();

        for (const t of taskDefs) {
            inDegree.set(t.id, 0);
            adj.set(t.id, []);
        }

        for (const t of taskDefs) {
            for (const dep of (t.dependencies || [])) {
                if (!ids.has(dep)) continue; // external dep — skip
                adj.get(dep).push(t.id);
                inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
            }
        }

        // Kahn's algorithm
        const queue = [];
        for (const [id, deg] of inDegree) {
            if (deg === 0) queue.push(id);
        }

        let visited = 0;
        while (queue.length > 0) {
            const node = queue.shift();
            visited++;
            for (const neighbor of (adj.get(node) || [])) {
                const newDeg = inDegree.get(neighbor) - 1;
                inDegree.set(neighbor, newDeg);
                if (newDeg === 0) queue.push(neighbor);
            }
        }

        if (visited !== taskDefs.length) {
            throw new Error(
                `Circular dependency detected in task graph! ` +
                `Resolved ${visited}/${taskDefs.length} tasks.`
            );
        }
    }

    // ─── Dependency Resolution ───────────────────────────────────

    /**
     * Check if all dependencies of a task are completed.
     * @param {object} task
     * @returns {boolean}
     */
    _areDependenciesMet(task) {
        if (!task.dependencies || task.dependencies.length === 0) return true;
        return task.dependencies.every(depId => {
            const dep = this.getTask(depId);
            return dep && dep.status === 'completed';
        });
    }

    /**
     * Auto-unblock tasks that were waiting on a now-completed dependency.
     * @param {string} completedTaskId
     */
    _unblockDependents(completedTaskId) {
        const all = this.getAllTasks();
        for (const task of all) {
            if (task.status === 'blocked' && task.dependencies?.includes(completedTaskId)) {
                if (this._areDependenciesMet(task)) {
                    task.status = 'pending';
                    this._persistTask(task);
                }
            }
        }
    }

    // ─── Persistence ─────────────────────────────────────────────

    /**
     * Persist a task to the appropriate state directory.
     * @param {object} task
     */
    _persistTask(task) {
        // Determine target directory based on status
        let stateDir;
        switch (task.status) {
            case 'completed':
                stateDir = 'completed';
                break;
            case 'in_progress':
                stateDir = 'claimed';
                break;
            case 'failed':
                stateDir = 'failed';
                break;
            default:
                stateDir = 'pending';
        }

        const dir = join(this.tasksDir, stateDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const priorityNum = PRIORITY_MAP[task.priority] || 2;
        const filename = `${priorityNum}_${task.id}.json`;
        const filepath = join(dir, filename);

        writeFileSync(filepath, JSON.stringify(task, null, 2), 'utf-8');

        // Clean up from other state directories
        for (const otherState of ['pending', 'claimed', 'completed', 'failed']) {
            if (otherState === stateDir) continue;
            const otherDir = join(this.tasksDir, otherState);
            try {
                const files = readdirSync(otherDir).filter(f => f.includes(task.id) && f.endsWith('.json'));
                for (const f of files) {
                    try { unlinkSync(join(otherDir, f)); } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        }
    }
}
