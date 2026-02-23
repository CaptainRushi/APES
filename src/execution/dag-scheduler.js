/**
 * DAG Scheduler
 * 
 * Core execution engine using Directed Acyclic Graph scheduling.
 * 
 * Example DAG:
 *   Task A → Task B → Task D
 *   Task A → Task C → Task D
 * 
 * Execution:
 *   Wave 1: [A]         ← independent, runs first
 *   Wave 2: [B, C]      ← both depend on A, run in parallel
 *   Wave 3: [D]         ← depends on B and C, runs last
 * 
 * Rules:
 *   - Agents execute independent nodes in parallel
 *   - Dependencies block execution until resolved
 *   - Uses worker pool for async execution
 */

export class DAGScheduler {
    /**
     * Build a DAG from task decomposition
     * @param {{ tasks: object[] }} decomposition
     * @returns {{ nodes: Map, waves: object[][] }}
     */
    buildDAG(decomposition) {
        const { tasks } = decomposition;
        const nodes = new Map();

        // Build node map
        for (const task of tasks) {
            nodes.set(task.id, {
                task,
                dependsOn: new Set(task.dependsOn),
                dependents: new Set(),
                status: 'pending',
                result: null,
            });
        }

        // Build reverse dependency map (who depends on me?)
        for (const task of tasks) {
            for (const depId of task.dependsOn) {
                const depNode = nodes.get(depId);
                if (depNode) {
                    depNode.dependents.add(task.id);
                }
            }
        }

        // Compute execution waves (topological sort by levels)
        const waves = this.computeWaves(nodes);

        return { nodes, waves };
    }

    /**
     * Compute parallel execution waves via topological levels
     */
    computeWaves(nodes) {
        const waves = [];
        const completed = new Set();

        while (completed.size < nodes.size) {
            // Find all nodes whose dependencies are satisfied
            const wave = [];

            for (const [id, node] of nodes) {
                if (completed.has(id)) continue;
                if (node.status !== 'pending') continue;

                const depsResolved = [...node.dependsOn].every(depId => completed.has(depId));
                if (depsResolved) {
                    wave.push(node);
                }
            }

            if (wave.length === 0) {
                // Cycle detection — should not happen with valid DAG
                const remaining = [...nodes.keys()].filter(id => !completed.has(id));
                console.error('DAG cycle detected! Remaining nodes:', remaining);
                break;
            }

            waves.push(wave);

            // Mark wave nodes as completed (for scheduling purposes)
            for (const node of wave) {
                completed.add(node.task.id);
                node.status = 'scheduled';
            }
        }

        return waves;
    }

    /**
     * Execute the DAG using the worker pool
     * @param {{ nodes: Map, waves: object[][] }} dag
     * @param {{ agents: object[], assignments: object }} allocation
     * @param {import('./worker-pool.js').WorkerPool} pool
     * @param {object} context
     * @returns {Promise<{ results: object[], waves: number }>}
     */
    async execute(dag, allocation, pool, context = {}) {
        const { waves } = dag;
        const allResults = [];
        const renderer = context.renderer;

        for (let i = 0; i < waves.length; i++) {
            const wave = waves[i];

            if (renderer) {
                this.renderWaveStart(renderer, i, wave);
            }

            // Execute all tasks in this wave in parallel
            const wavePromises = wave.map(async (node) => {
                const task = node.task;
                const assignedAgentIds = allocation.assignments[task.id] || [];

                try {
                    node.status = 'running';
                    const startTime = Date.now();

                    // Execute via worker pool
                    const result = await pool.execute({
                        task,
                        agentIds: assignedAgentIds,
                        context,
                    });

                    const duration = Date.now() - startTime;

                    node.status = 'completed';
                    node.result = result;

                    return {
                        taskId: task.id,
                        description: task.description,
                        status: 'completed',
                        output: result.output || 'Task completed',
                        duration,
                        agentId: assignedAgentIds[0],
                        wave: i,
                    };
                } catch (error) {
                    node.status = 'failed';
                    node.result = { error: error.message };

                    return {
                        taskId: task.id,
                        description: task.description,
                        status: 'failed',
                        error: error.message,
                        duration: 0,
                        agentId: assignedAgentIds[0],
                        wave: i,
                    };
                }
            });

            // Wait for entire wave to complete before moving to next
            const waveResults = await Promise.allSettled(wavePromises);

            for (const result of waveResults) {
                if (result.status === 'fulfilled') {
                    allResults.push(result.value);
                } else {
                    allResults.push({
                        status: 'failed',
                        error: result.reason?.message || 'Unknown error',
                        wave: i,
                    });
                }
            }

            // Check if any critical tasks failed that would block dependents
            const failures = waveResults.filter(r =>
                r.status === 'fulfilled' && r.value.status === 'failed'
            );

            if (failures.length > 0 && i < waves.length - 1) {
                // Skip dependent tasks of failed tasks
                this.skipDependents(dag.nodes, failures.map(f => f.value.taskId));
            }
        }

        return {
            results: allResults,
            waves: waves.length,
            totalTasks: allResults.length,
        };
    }

    /**
     * Skip tasks that depend on failed tasks
     */
    skipDependents(nodes, failedIds) {
        for (const failedId of failedIds) {
            const failedNode = nodes.get(failedId);
            if (!failedNode) continue;

            for (const depId of failedNode.dependents) {
                const depNode = nodes.get(depId);
                if (depNode && depNode.status === 'pending') {
                    depNode.status = 'skipped';
                }
            }
        }
    }

    /**
     * Render wave execution start
     */
    renderWaveStart(renderer, waveIndex, wave) {
        const tasks = wave.map(n => n.task.description).join(', ');
        const c = renderer.c.bind(renderer);
        console.log(`  ${c('cyan', `Wave ${waveIndex + 1}`)} ${c('dim', `[${wave.length} tasks]`)} ${c('dim', tasks.slice(0, 60))}`);
    }
}
