/**
 * Agent Spawner
 * 
 * Dynamic agent allocation based on:
 *   - Task complexity score
 *   - Intent classification
 *   - Agent confidence scores
 *   - Performance history
 * 
 * Spawning Rules:
 *   Simple  → 1–2 agents
 *   Medium  → 3–5 agents parallel
 *   Complex → DAG execution with staged parallel waves
 */

export class AgentSpawner {
    constructor(registry) {
        /** @type {import('./registry.js').AgentRegistry} */
        this.registry = registry;
    }

    /**
     * Allocate agents for a set of tasks
     * @param {{ tasks: object[] }} decomposition
     * @param {{ level: string, agentCount: number }} complexity
     * @param {{ cluster: string, secondary?: object[] }} intent
     * @returns {{ agents: object[], assignments: Map<string, string[]> }}
     */
    allocate(decomposition, complexity, intent) {
        const { tasks } = decomposition;
        const assignments = new Map();

        // Find candidate agents from primary cluster
        const primaryAgents = this.registry.findAgents({
            cluster: intent.cluster,
            complexity: complexity.level,
        });

        // Find agents from secondary intent clusters
        const secondaryAgents = [];
        if (intent.secondary) {
            for (const sec of intent.secondary) {
                const agents = this.registry.findAgents({ cluster: sec.type, complexity: complexity.level });
                secondaryAgents.push(...agents);
            }
        }

        // Pool all available agents
        const pool = [...primaryAgents, ...secondaryAgents];

        // Deduplicate
        const seen = new Set();
        const uniquePool = pool.filter(a => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
        });

        // Select agents based on complexity level
        const selected = this.selectAgents(uniquePool, complexity, tasks);

        // Assign agents to tasks
        for (const task of tasks) {
            const taskAgents = this.assignToTask(task, selected, complexity);
            assignments.set(task.id, taskAgents.map(a => a.id));
        }

        return {
            agents: selected,
            assignments: Object.fromEntries(assignments),
            strategy: this.getStrategy(complexity.level),
        };
    }

    /**
     * Select agents from pool based on complexity
     */
    selectAgents(pool, complexity, tasks) {
        const count = Math.min(complexity.agentCount, pool.length);

        // For simple tasks, pick the best agent
        if (complexity.level === 'simple') {
            return pool.slice(0, Math.max(1, count));
        }

        // For medium, pick top agents by confidence
        if (complexity.level === 'medium') {
            return pool.slice(0, count);
        }

        // For complex, pick all available agents (they'll be DAG-scheduled)
        return pool.slice(0, Math.min(pool.length, 10));
    }

    /**
     * Assign specific agents to a task
     */
    assignToTask(task, selectedAgents, complexity) {
        // Find agents whose skills match the task type
        const matching = selectedAgents.filter(a => a.cluster === task.cluster);

        if (matching.length > 0) return matching;

        // Fallback: assign first available
        return selectedAgents.slice(0, 1);
    }

    /**
     * Get execution strategy name
     */
    getStrategy(level) {
        switch (level) {
            case 'simple': return 'direct_execution';
            case 'medium': return 'parallel_pool';
            case 'complex': return 'dag_staged_waves';
            default: return 'direct_execution';
        }
    }
}
