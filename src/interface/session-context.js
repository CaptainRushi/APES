/**
 * Session Context
 * 
 * Manages the current session state — tracks active tasks,
 * execution history, and provides context to the orchestrator.
 */

import { randomUUID } from 'node:crypto';

export class SessionContext {
    constructor() {
        this.sessionId = randomUUID();
        this.startedAt = Date.now();
        this.currentTask = null;

        /** @type {Array<{id: string, input: string, startedAt: number, endedAt?: number, result?: object}>} */
        this.taskHistory = [];

        /** @type {Map<string, any>} */
        this.context = new Map();
    }

    startTask(input) {
        this.currentTask = {
            id: randomUUID(),
            input,
            startedAt: Date.now(),
            status: 'running',
        };
        return this.currentTask;
    }

    endTask(result) {
        if (this.currentTask) {
            this.currentTask.endedAt = Date.now();
            this.currentTask.result = result;
            this.currentTask.status = result.error ? 'failed' : 'completed';
            this.currentTask.duration = this.currentTask.endedAt - this.currentTask.startedAt;
            this.taskHistory.push({ ...this.currentTask });
            this.currentTask = null;
        }
    }

    set(key, value) {
        this.context.set(key, value);
    }

    get(key) {
        return this.context.get(key);
    }

    getStatus() {
        return {
            sessionId: this.sessionId,
            uptime: Date.now() - this.startedAt,
            currentTask: this.currentTask,
            tasksCompleted: this.taskHistory.filter(t => t.status === 'completed').length,
            tasksFailed: this.taskHistory.filter(t => t.status === 'failed').length,
            totalTasks: this.taskHistory.length,
        };
    }
}
