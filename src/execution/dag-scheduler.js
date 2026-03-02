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
     * Compute parallel execution waves via topological levels.
     *
     * Uses a Kahn's-algorithm-style BFS:
     *   - Track in-degree (unresolved dependency count) for every node.
     *   - Start with all zero-in-degree nodes (first wave).
     *   - Each time a wave completes, decrement in-degree of its dependents and
     *     add any that reach zero to the next wave.
     *   - O(V + E) instead of the previous O(V²) re-scan approach.
     *
     * Does NOT mutate node.status so execution state stays clean.
     */
    computeWaves(nodes) {
        // Build in-degree map and adjacency list using node IDs
        const inDegree = new Map();
        for (const [id] of nodes) {
            inDegree.set(id, 0);
        }
        for (const [, node] of nodes) {
            for (const depId of node.dependsOn) {
                if (nodes.has(depId)) {
                    inDegree.set(node.task.id, (inDegree.get(node.task.id) || 0) + 1);
                }
            }
        }

        const waves = [];
        let currentWave = [];

        // Seed with all root nodes (no dependencies)
        for (const [id, deg] of inDegree) {
            if (deg === 0) currentWave.push(nodes.get(id));
        }

        const visited = new Set();

        while (currentWave.length > 0) {
            waves.push(currentWave);

            const nextWave = [];
            for (const node of currentWave) {
                visited.add(node.task.id);
                // Notify each dependent that one of its deps is now resolved
                for (const depId of node.dependents) {
                    const newDeg = (inDegree.get(depId) || 1) - 1;
                    inDegree.set(depId, newDeg);
                    if (newDeg === 0 && !visited.has(depId)) {
                        nextWave.push(nodes.get(depId));
                    }
                }
            }

            currentWave = nextWave;
        }

        // Cycle detection
        if (visited.size < nodes.size) {
            const remaining = [...nodes.keys()].filter(id => !visited.has(id));
            console.error('DAG cycle detected! Remaining nodes:', remaining);
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
        const anim     = context.animationEngine ?? null;

        // Lazy mode: allocation is null and context carries spawner
        const lazyMode = allocation === null && context.spawner;
        const accumulatedAllocation = lazyMode
            ? { agents: [], assignments: {} }
            : null;
        // Track already-registered agent IDs for deduplication across waves
        const registeredAgentIds = new Set();

        // Use provided allocation or the accumulator for agent lookups
        let currentAllocation = allocation || { agents: [], assignments: {} };

        for (let i = 0; i < waves.length; i++) {
            const wave = waves[i];

            // ── Lazy per-wave agent spawning ──
            if (lazyMode) {
                const waveTasks = wave.map(n => n.task);
                const waveAlloc = context.spawner.allocateForWave(
                    waveTasks, context.complexity, context.intent,
                );

                // Merge into accumulated allocation (deduplicated)
                for (const agent of waveAlloc.agents) {
                    if (!registeredAgentIds.has(agent.id)) {
                        registeredAgentIds.add(agent.id);
                        accumulatedAllocation.agents.push(agent);
                    }
                }
                Object.assign(accumulatedAllocation.assignments, waveAlloc.assignments);

                // Update currentAllocation so wave execution can find assignments
                currentAllocation = {
                    agents: accumulatedAllocation.agents,
                    assignments: { ...accumulatedAllocation.assignments },
                };

                // Register new agents with animation engine
                if (anim) {
                    anim.setStatus('SPAWNING AGENTS');
                    const agentRegistry = context.agentRegistry;

                    for (const agent of waveAlloc.agents) {
                        if (registeredAgentIds.has(agent.id)) {
                            // Already handled above, but check if animation needs it
                        }
                        const cluster = agentRegistry?.clusters?.get(agent.cluster);
                        if (cluster && typeof anim.addCluster === 'function') {
                            anim.addCluster(agent.cluster, cluster.name);
                        }
                        const displayName = agent.role
                            .split('_')
                            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                            .join(' ');
                        if (typeof anim.addCluster === 'function') {
                            anim.addAgent(agent.id, displayName, agent.cluster);
                        } else {
                            anim.addAgent(agent.id, displayName);
                        }
                        anim.setState(agent.id, 'spawning');
                    }
                    // Brief pause for spawn animation visibility
                    await new Promise(r => setTimeout(r, 300));
                    anim.setStatus('EXECUTING');
                }
            }

            // Only print wave header when not in animation mode
            if (renderer && !anim) {
                this.renderWaveStart(renderer, i, wave);
            }

            // Execute all tasks in this wave in parallel
            const wavePromises = wave.map(async (node) => {
                const task = node.task;
                const assignedAgentIds = currentAllocation.assignments[task.id] || [];

                // Animation: mark assigned agents as running
                if (anim) {
                    for (const agentId of assignedAgentIds) {
                        anim.setState(agentId, 'running');
                    }
                }

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

                    // Verify actual output — don't mark as completed if no real output
                    const hasRealOutput = result.output && result.output.length > 0;
                    const resultStatus = hasRealOutput ? 'completed' : 'failed';

                    node.status = resultStatus;
                    node.result = result;

                    // Animation: mark assigned agents based on actual status
                    if (anim) {
                        for (const agentId of assignedAgentIds) {
                            anim.setState(agentId, resultStatus === 'completed' ? 'completed' : 'error');
                        }
                    }

                    const taskResult = {
                        taskId: task.id,
                        description: task.description,
                        status: resultStatus,
                        output: result.output || (resultStatus === 'failed' ? 'No output produced' : 'Task completed'),
                        duration,
                        agentId: assignedAgentIds[0],
                        wave: i,
                    };

                    // Publish task output to message bus
                    context.messageBus?.publish({
                        type: 'task_output',
                        fromAgentId: assignedAgentIds[0],
                        taskId: task.id,
                        channel: `task:${task.id}`,
                        output: taskResult.output,
                        confidence: result.metadata?.confidence ?? 0.8,
                    });

                    return taskResult;
                } catch (error) {
                    node.status = 'failed';
                    node.result = { error: error.message };

                    // Animation: mark assigned agents as error
                    if (anim) {
                        for (const agentId of assignedAgentIds) {
                            anim.setState(agentId, 'error');
                        }
                    }

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

        const result = {
            results: allResults,
            waves: waves.length,
            totalTasks: allResults.length,
        };

        // Attach accumulated allocation for downstream consumers (learning, metrics)
        if (lazyMode && accumulatedAllocation) {
            result.accumulatedAllocation = accumulatedAllocation;
        }

        return result;
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
