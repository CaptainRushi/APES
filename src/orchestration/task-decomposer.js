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

    /**
     * Async task decomposition using an LLM provider.
     * @param {object} parsed
     * @param {object} intent
     * @param {import('../providers/provider-registry.js').ProviderRegistry} providerRegistry
     */
    async decomposeAsync(parsed, intent, providerRegistry) {
        if (!providerRegistry || !providerRegistry.isReady()) {
            // Fallback to synchronous regex splitting if no AI available
            return this.decompose(parsed, intent);
        }

        const taskDesc = parsed.raw;

        const systemPrompt = `You are the APES (Autonomous Parallel Execution System) Task Decomposer.
Your job is to take a user's complex objective and break it down into a highly modular, parallelizable graph of subtasks.
Each task should represent a specific, actionable chunk of work that can be assigned to an autonomous agent.
Identify dependencies between tasks. Tasks that don't depend on each other will be executed in parallel.

Respond ONLY with a JSON array of task objects. Do not include markdown formatting or markdown code blocks like \`\`\`json. Just the raw JSON array.
Each task object MUST conform to this schema:
{
  "description": "Clear, actionable description of the task",
  "priority": number (1-3, where 3 is highest priority/critical path),
  "dependsOn": [array of indices (0-based) of other tasks in this array that must be completed FIRST],
  "type": "code" | "research" | "devops" | "general" | "analysis",
  "cluster": "engineering" | "strategic_planning" | "research_intelligence" | "code_quality" | "version_control" | "execution_automation" | "memory_learning" | "control_safety"
}`;

        const userMessage = `Decompose this objective into a task graph:\n\nObjective: "${taskDesc}"\nIntent classification: ${JSON.stringify(intent)}`;

        try {
            const input = { systemPrompt, userMessage, maxTokens: 4096, temperature: 0.2 };
            // Empty task context, we act as a generic planner
            const result = await providerRegistry.router.route(input, { id: 'sys-planner', description: 'Decompose constraints' }, 'complex');

            let content = result.content.trim();
            // Remove markdown json block if model ignored instructions
            if (content.startsWith('\`\`\`json')) content = content.substring(7);
            else if (content.startsWith('\`\`\`')) content = content.substring(3);
            if (content.endsWith('\`\`\`')) content = content.substring(0, content.length - 3);
            content = content.trim();

            const parsedJson = JSON.parse(content);
            if (!Array.isArray(parsedJson)) throw new Error('LLM did not return a JSON array');

            const tasks = [];
            for (let i = 0; i < parsedJson.length; i++) {
                const item = parsedJson[i];
                tasks.push({
                    id: randomUUID().slice(0, 8),
                    index: i,
                    description: item.description || `Task ${i + 1}`,
                    type: item.type || intent.type || 'general',
                    cluster: item.cluster || intent.cluster,
                    dependsOnIdx: item.dependsOn || [],
                    status: 'pending',
                    priority: item.priority || 2
                });
            }

            // Map index-based dependencies to UUIDs
            for (const task of tasks) {
                task.dependsOn = [];
                for (const depIdx of task.dependsOnIdx) {
                    if (tasks[depIdx]) {
                        task.dependsOn.push(tasks[depIdx].id);
                    }
                }
                delete task.dependsOnIdx;
            }

            return {
                tasks,
                totalTasks: tasks.length,
                hasParallelizable: tasks.filter(t => t.dependsOn.length === 0).length > 1,
            };

        } catch (e) {
            console.error('\\n  [TaskDecomposer] LLM failed, falling back to regex: ' + e.message);
            return this.decompose(parsed, intent);
        }
    }
}
