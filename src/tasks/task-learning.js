/**
 * Task Learning Bridge — Performance Recording for Task Engine
 *
 * Records task completion data for the learning engine:
 *   - Task duration
 *   - Agent performance
 *   - Confidence scores
 *   - Issues found
 *
 * Persists to: ~/.apes/sessions/{id}/tasks/learning/
 * Feeds into the existing LearningSystem for:
 *   - Future task estimation
 *   - Agent performance scoring
 *   - Adaptive planning
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class TaskLearningBridge {
    /**
     * @param {string} sessionId
     */
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.learningDir = join(
            homedir(), '.apes', 'sessions', sessionId, 'tasks', 'learning'
        );

        if (!existsSync(this.learningDir)) {
            mkdirSync(this.learningDir, { recursive: true });
        }
    }

    /**
     * Record a task completion event.
     * @param {object} data
     * @param {string} data.taskId
     * @param {number} data.duration — Execution time in ms
     * @param {string} data.agent — Agent ID that executed the task
     * @param {number} data.confidence — 0-1 confidence score
     * @param {number} data.issuesFound — Number of issues detected
     * @param {string} [data.cluster] — Agent cluster
     * @param {string} [data.type] — Task type
     */
    recordCompletion(data) {
        const record = {
            taskId: data.taskId,
            duration: data.duration || 0,
            agent: data.agent || 'unknown',
            confidence: data.confidence ?? 0,
            issuesFound: data.issuesFound || 0,
            cluster: data.cluster || null,
            type: data.type || 'general',
            recordedAt: Date.now(),
        };

        const filename = `${data.taskId}_${Date.now()}.json`;
        writeFileSync(
            join(this.learningDir, filename),
            JSON.stringify(record, null, 2),
            'utf-8',
        );

        return record;
    }

    /**
     * Get performance data for a specific task.
     * @param {string} taskId
     * @returns {object[]} All learning records for this task
     */
    getTaskPerformance(taskId) {
        try {
            return readdirSync(this.learningDir)
                .filter(f => f.startsWith(taskId) && f.endsWith('.json'))
                .map(f => {
                    try {
                        return JSON.parse(readFileSync(join(this.learningDir, f), 'utf-8'));
                    } catch { return null; }
                })
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Get all learning records for this session.
     * @returns {object[]}
     */
    getAllRecords() {
        try {
            return readdirSync(this.learningDir)
                .filter(f => f.endsWith('.json'))
                .map(f => {
                    try {
                        return JSON.parse(readFileSync(join(this.learningDir, f), 'utf-8'));
                    } catch { return null; }
                })
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Get aggregate statistics across all recorded tasks.
     * @returns {object}
     */
    getStats() {
        const records = this.getAllRecords();
        if (records.length === 0) {
            return {
                totalRecords: 0,
                avgDuration: 0,
                avgConfidence: 0,
                totalIssues: 0,
                agentBreakdown: {},
            };
        }

        const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
        const totalConfidence = records.reduce((s, r) => s + (r.confidence || 0), 0);
        const totalIssues = records.reduce((s, r) => s + (r.issuesFound || 0), 0);

        // Agent breakdown
        const agentBreakdown = {};
        for (const r of records) {
            if (!agentBreakdown[r.agent]) {
                agentBreakdown[r.agent] = { tasks: 0, avgDuration: 0, totalDuration: 0 };
            }
            agentBreakdown[r.agent].tasks++;
            agentBreakdown[r.agent].totalDuration += r.duration || 0;
        }
        for (const agent of Object.values(agentBreakdown)) {
            agent.avgDuration = Math.round(agent.totalDuration / agent.tasks);
        }

        return {
            totalRecords: records.length,
            avgDuration: Math.round(totalDuration / records.length),
            avgConfidence: Math.round((totalConfidence / records.length) * 100) / 100,
            totalIssues,
            agentBreakdown,
        };
    }

    /**
     * Build a learning data object compatible with LearningSystem.update().
     * @param {object} taskRecord — A single learning record
     * @param {object} result — The orchestrator execution result
     * @returns {object} Data formatted for LearningSystem.update()
     */
    toLearningData(taskRecord, result = {}) {
        return {
            input: taskRecord.taskId,
            intent: { type: taskRecord.type || 'general', cluster: taskRecord.cluster || 'core' },
            tasks: { tasks: [{ id: taskRecord.taskId, description: taskRecord.taskId }], totalTasks: 1 },
            complexity: { level: 'medium', score: 5 },
            allocation: {
                agents: [{ id: taskRecord.agent, cluster: taskRecord.cluster || 'core' }],
            },
            execution: {
                results: [{
                    agentId: taskRecord.agent,
                    taskId: taskRecord.taskId,
                    duration: taskRecord.duration,
                    status: 'completed',
                }],
            },
            evaluation: {
                successRate: taskRecord.confidence,
                quality: taskRecord.confidence,
                completed: 1,
                failed: 0,
                avgDuration: taskRecord.duration,
            },
            duration: taskRecord.duration,
        };
    }
}
