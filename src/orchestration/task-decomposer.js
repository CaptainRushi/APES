/**
 * Task Decomposer
 * 
 * Stage 3 of the Cognitive Pipeline.
 * Breaks down user input into a structured task graph (DAG).
 * Each task has dependencies, enabling parallel execution
 * of independent tasks.
 */

import { randomUUID } from 'node:crypto';

export class TaskDecomposer {
    constructor() {
        // Task decomposition heuristics
        this.connectors = ['and', 'then', 'also', 'plus', 'with', 'after'];
        this.sequenceMarkers = ['then', 'after', 'once', 'when', 'finally', 'next'];
    }

    /**
     * Decompose parsed input into a task graph
     * @param {object} parsed - Parsed input from Stage 1
     * @param {object} intent - Intent classification from Stage 2
     * @returns {{ tasks: Task[], dependencies: Map<string, string[]> }}
     * 
     * @typedef {object} Task
     * @property {string} id - Unique task identifier
     * @property {string} description - Task description
     * @property {string} type - Task type (from intent)
     * @property {string[]} dependsOn - Task IDs this depends on
     * @property {string} status - 'pending' | 'running' | 'completed' | 'failed'
     */
    decompose(parsed, intent) {
        const subtasks = this.splitIntoSubtasks(parsed.raw);

        // Build task objects with dependency tracking
        const tasks = [];
        let prevId = null;

        for (let i = 0; i < subtasks.length; i++) {
            const subtask = subtasks[i];
            const id = randomUUID().slice(0, 8);
            const isSequential = this.isSequentialMarker(subtask.connector);

            const task = {
                id,
                index: i,
                description: subtask.text.trim(),
                type: intent.type,
                cluster: intent.cluster,
                dependsOn: isSequential && prevId ? [prevId] : [],
                status: 'pending',
                priority: this.calculatePriority(subtask.text, intent),
            };

            tasks.push(task);
            prevId = id;
        }

        // If only one task, keep it simple
        if (tasks.length === 0) {
            tasks.push({
                id: randomUUID().slice(0, 8),
                index: 0,
                description: parsed.raw,
                type: intent.type,
                cluster: intent.cluster,
                dependsOn: [],
                status: 'pending',
                priority: 1,
            });
        }

        return {
            tasks,
            totalTasks: tasks.length,
            hasParallelizable: tasks.filter(t => t.dependsOn.length === 0).length > 1,
        };
    }

    /**
     * Split input into subtask segments
     */
    splitIntoSubtasks(input) {
        const results = [];

        // Split on connectors and sentence boundaries
        const pattern = new RegExp(
            `\\b(${this.connectors.join('|')})\\b|[.;]\\s*`,
            'gi'
        );

        const parts = input.split(pattern).filter(p => p && p.trim().length > 2);

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();

            // Check if this part is a connector
            if (this.connectors.includes(part.toLowerCase())) {
                continue;
            }

            results.push({
                text: part,
                connector: i > 0 ? (parts[i - 1]?.toLowerCase() || '') : '',
            });
        }

        return results.length > 0 ? results : [{ text: input, connector: '' }];
    }

    /**
     * Check if a connector implies sequential execution
     */
    isSequentialMarker(connector) {
        return this.sequenceMarkers.includes(connector.toLowerCase());
    }

    /**
     * Calculate a priority score for the task
     */
    calculatePriority(text, intent) {
        let priority = 1;

        // Higher priority for code tasks
        if (intent.type === 'code' || intent.type === 'devops') priority += 1;

        // Longer descriptions might indicate more complex tasks
        if (text.split(/\s+/).length > 10) priority += 1;

        return Math.min(priority, 5);
    }
}
