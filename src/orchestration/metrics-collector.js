/**
 * Metrics Collector — Observability & Resource Management
 *
 * Tracks agent CPU/time/tokens, provides alerts, session dashboards,
 * and performance benchmarking reports.
 */

import { EventEmitter } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class MetricsCollector extends EventEmitter {
    constructor({ storagePath } = {}) {
        super();
        this.storagePath = storagePath || join(homedir(), '.apes', 'metrics');

        /** @type {Map<string, object>} agentId → metrics */
        this.agentMetrics = new Map();

        /** @type {object[]} time-series events */
        this.events = [];
        this.maxEvents = 5000;

        /** @type {Map<string, object>} alertId → alert config */
        this.alerts = new Map();

        /** Session-level aggregated counters */
        this.session = {
            startTime: Date.now(),
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            totalTokens: 0,
            totalCostUsd: 0,
            totalDurationMs: 0,
        };

        this._setupDefaultAlerts();
    }

    // ─── Recording ────────────────────────────────────────────────

    recordAgentTask(agentId, { taskId, durationMs, tokensUsed = 0, costUsd = 0, success = true }) {
        if (!this.agentMetrics.has(agentId)) {
            this.agentMetrics.set(agentId, { agentId, tasks: 0, successes: 0, failures: 0, totalDurationMs: 0, totalTokens: 0, totalCost: 0 });
        }
        const m = this.agentMetrics.get(agentId);
        m.tasks++;
        if (success) m.successes++; else m.failures++;
        m.totalDurationMs += durationMs;
        m.totalTokens += tokensUsed;
        m.totalCost += costUsd;

        // Session-level
        this.session.totalTasks++;
        if (success) this.session.completedTasks++; else this.session.failedTasks++;
        this.session.totalTokens += tokensUsed;
        this.session.totalCostUsd += costUsd;
        this.session.totalDurationMs += durationMs;

        const event = { type: 'task', agentId, taskId, durationMs, tokensUsed, costUsd, success, timestamp: Date.now() };
        this.events.push(event);
        if (this.events.length > this.maxEvents) this.events = this.events.slice(-this.maxEvents);

        this._checkAlerts(event);
        this.emit('metrics:task', event);
    }

    recordEvent(type, data) {
        const event = { type, ...data, timestamp: Date.now() };
        this.events.push(event);
        if (this.events.length > this.maxEvents) this.events = this.events.slice(-this.maxEvents);
        this.emit(`metrics:${type}`, event);
    }

    // ─── Alerts ───────────────────────────────────────────────────

    registerAlert(id, { metric, threshold, comparator = 'gt', message }) {
        this.alerts.set(id, { metric, threshold, comparator, message, triggered: false, lastTriggered: null });
    }

    _checkAlerts(event) {
        for (const [id, alert] of this.alerts) {
            const value = event[alert.metric];
            if (value === undefined) continue;
            let triggered = false;
            if (alert.comparator === 'gt' && value > alert.threshold) triggered = true;
            if (alert.comparator === 'lt' && value < alert.threshold) triggered = true;
            if (triggered && !alert.triggered) {
                alert.triggered = true;
                alert.lastTriggered = Date.now();
                this.emit('metrics:alert', { alertId: id, message: alert.message, value, threshold: alert.threshold });
            }
        }
    }

    _setupDefaultAlerts() {
        this.registerAlert('high-latency', { metric: 'durationMs', threshold: 60000, comparator: 'gt', message: 'Agent task exceeded 60 seconds' });
        this.registerAlert('high-token', { metric: 'tokensUsed', threshold: 50000, comparator: 'gt', message: 'Agent used > 50k tokens in a single task' });
    }

    // ─── Reports ──────────────────────────────────────────────────

    getAgentReport(agentId) {
        const m = this.agentMetrics.get(agentId);
        if (!m) return null;
        return { ...m, avgDurationMs: m.tasks > 0 ? Math.round(m.totalDurationMs / m.tasks) : 0, successRate: m.tasks > 0 ? (m.successes / m.tasks).toFixed(2) : 'N/A' };
    }

    getSessionReport() {
        const elapsed = Date.now() - this.session.startTime;
        return {
            ...this.session,
            elapsedMs: elapsed,
            elapsedFormatted: `${Math.round(elapsed / 1000)}s`,
            avgTaskDuration: this.session.totalTasks > 0 ? Math.round(this.session.totalDurationMs / this.session.totalTasks) : 0,
            successRate: this.session.totalTasks > 0 ? (this.session.completedTasks / this.session.totalTasks * 100).toFixed(1) + '%' : 'N/A',
            agentCount: this.agentMetrics.size,
        };
    }

    getBenchmark() {
        const agents = [...this.agentMetrics.values()].sort((a, b) => {
            const rateA = a.tasks > 0 ? a.successes / a.tasks : 0;
            const rateB = b.tasks > 0 ? b.successes / b.tasks : 0;
            return rateB - rateA;
        });
        return {
            topPerformers: agents.slice(0, 10).map(a => ({ agentId: a.agentId, tasks: a.tasks, successRate: (a.successes / a.tasks * 100).toFixed(1) + '%', avgMs: Math.round(a.totalDurationMs / a.tasks) })),
            bottomPerformers: agents.slice(-5).map(a => ({ agentId: a.agentId, tasks: a.tasks, failureRate: (a.failures / a.tasks * 100).toFixed(1) + '%' })),
        };
    }

    // ─── Persistence ──────────────────────────────────────────────

    async save() {
        try {
            await mkdir(this.storagePath, { recursive: true });
            await writeFile(join(this.storagePath, 'session-metrics.json'), JSON.stringify({ session: this.session, agents: [...this.agentMetrics.entries()], savedAt: new Date().toISOString() }), 'utf-8');
        } catch { /* non-critical */ }
    }

    getStatus() {
        return { agents: this.agentMetrics.size, totalEvents: this.events.length, activeAlerts: [...this.alerts.values()].filter(a => a.triggered).length, session: this.getSessionReport() };
    }
}
