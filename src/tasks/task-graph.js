/**
 * Task Graph Generator — Planner-Driven Task Decomposition
 *
 * Takes a user objective and generates a structured task graph:
 *   1. Uses TaskDecomposer to split the objective into subtasks
 *   2. Enriches each subtask into the full Task schema
 *   3. Validates the DAG (no circular dependencies)
 *   4. Persists all tasks via TaskEngine
 *   5. Returns the complete task graph for rendering
 */

import { TaskDecomposer } from '../orchestration/task-decomposer.js';
import { IntentClassifier } from '../orchestration/intent-classifier.js';
import { TaskEngine } from './task-engine.js';

export class TaskGraphGenerator {
    /**
     * @param {string} sessionId
     */
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.decomposer = new TaskDecomposer();
        this.classifier = new IntentClassifier();
        this.engine = new TaskEngine(sessionId);
    }

    /**
     * Generate a complete task graph from a user objective.
     *
     * @param {string} objective — The user's high-level goal
     * @param {object} [opts] — Options
     * @param {string} [opts.createdBy='planner'] — Agent that created the tasks
     * @param {string} [opts.parentId] — Parent task ID for subtask graphs
     * @param {import('../providers/provider-registry.js').ProviderRegistry} [opts.providerRegistry] — Provider registry for LLM Decomposition
     * @returns {Promise<{ tasks: object[], graph: object, tree: object[], intent: object }>}
     */
    async generate(objective, opts = {}) {
        const createdBy = opts.createdBy || 'planner';

        // ─── Step 1: Parse and classify the objective ────────────
        const parsed = {
            raw: objective,
            tokens: objective.split(/\s+/),
            length: objective.length,
            wordCount: objective.split(/\s+/).length,
        };
        const intent = this.classifier.classify(parsed);

        // ─── Step 2: Decompose into subtasks via TaskDecomposer ──
        const decomposition = await this.decomposer.decomposeAsync(parsed, intent, opts.providerRegistry);

        // ─── Step 3: Build full task definitions ─────────────────
        const taskDefs = decomposition.tasks.map((subtask, idx) => {
            const taskId = `task-${String(idx + 1).padStart(3, '0')}`;

            // Map decomposer dependsOn (short UUIDs) → our task-XXX format
            const dependencies = [];
            if (subtask.dependsOn && subtask.dependsOn.length > 0) {
                for (const depUuid of subtask.dependsOn) {
                    // Find the index of the dependency by matching the decomposer's ID
                    const depIdx = decomposition.tasks.findIndex(t => t.id === depUuid || t.id === String(depUuid));
                    // Prevent circular dependencies by ONLY allowing dependencies on earlier tasks
                    if (depIdx >= 0 && depIdx < idx) {
                        dependencies.push(`task-${String(depIdx + 1).padStart(3, '0')}`);
                    }
                }
            }

            return {
                id: taskId,
                title: subtask.description,
                description: subtask.description,
                priority: this._mapPriority(subtask.priority),
                dependencies,
                parentId: opts.parentId || null,
                createdBy,
                type: subtask.type || intent.type,
                cluster: subtask.cluster || intent.cluster,
                index: idx,
            };
        });

        // ─── Step 4: Create the task graph via TaskEngine ────────
        const { tasks, graph } = this.engine.createTaskGraph(taskDefs);

        // ─── Step 5: Build tree structure for rendering ──────────
        const tree = this.engine.getTaskTree();

        return { tasks, graph, tree, intent };
    }

    /**
     * Generate subtasks under an existing parent task.
     * @param {string} parentTaskId
     * @param {string} objective
     * @param {import('../providers/provider-registry.js').ProviderRegistry} [providerRegistry]
     * @returns {Promise<{ tasks: object[], graph: object, tree: object[] }>}
     */
    async generateSubtasks(parentTaskId, objective, providerRegistry) {
        return this.generate(objective, {
            parentId: parentTaskId,
            createdBy: 'planner',
            providerRegistry
        });
    }

    /**
     * Map numeric priority to named priority.
     * @param {number} numPriority
     * @returns {'high'|'medium'|'low'}
     */
    _mapPriority(numPriority) {
        if (numPriority >= 3) return 'high';
        if (numPriority >= 2) return 'medium';
        return 'low';
    }
}
