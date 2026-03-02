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
 *   Simple  → 1–3 agents
 *   Medium  → 3–8 agents parallel
 *   Complex → DAG execution with staged parallel waves (up to 24 agents)
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
                const cluster = sec.cluster || sec.type;
                const agents = this.registry.findAgents({ cluster, complexity: complexity.level });
                secondaryAgents.push(...agents);
            }
        }

        // For complex tasks, also pull from related clusters
        if (complexity.level === 'complex') {
            // Always include code_quality and control_safety for complex tasks
            const qualityAgents = this.registry.findAgents({ cluster: 'code_quality', complexity: 'complex' });
            const safetyAgents = this.registry.findAgents({ cluster: 'control_safety', complexity: 'complex' });
            secondaryAgents.push(...qualityAgents, ...safetyAgents);
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
     * Allocate agents for a single wave of tasks (lazy per-wave spawning).
     * Same logic as allocate() but scoped to only the provided wave tasks.
     * @param {object[]} waveTasks - Array of task objects in this wave
     * @param {{ level: string, agentCount: number }} complexity
     * @param {{ cluster: string, secondary?: object[] }} intent
     * @returns {{ agents: object[], assignments: Map<string, string[]> }}
     */
    allocateForWave(waveTasks, complexity, intent) {
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
                const cluster = sec.cluster || sec.type;
                const agents = this.registry.findAgents({ cluster, complexity: complexity.level });
                secondaryAgents.push(...agents);
            }
        }

        // For complex tasks, also pull from related clusters
        if (complexity.level === 'complex') {
            const qualityAgents = this.registry.findAgents({ cluster: 'code_quality', complexity: 'complex' });
            const safetyAgents = this.registry.findAgents({ cluster: 'control_safety', complexity: 'complex' });
            secondaryAgents.push(...qualityAgents, ...safetyAgents);
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

        // Select agents scoped to this wave's tasks
        const selected = this.selectAgents(uniquePool, complexity, waveTasks);

        // Assign agents to wave tasks
        for (const task of waveTasks) {
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

        // For simple tasks, pick the best agent(s)
        if (complexity.level === 'simple') {
            return pool.slice(0, Math.max(1, Math.min(count, 3)));
        }

        // For medium, pick top agents by confidence
        if (complexity.level === 'medium') {
            return pool.slice(0, Math.min(count, 8));
        }

        // For complex, pick up to 24 agents (they'll be DAG-scheduled)
        return pool.slice(0, Math.min(pool.length, 24));
    }

    /**
     * Assign specific agents to a task
     */
    assignToTask(task, selectedAgents, complexity) {
        // Find agents whose skills match the task type
        const resolved = this.registry.resolveCluster(task.cluster);
        const matching = selectedAgents.filter(a => a.cluster === resolved);

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
