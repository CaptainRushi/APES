/**
 * Complexity Scorer
 * 
 * Stage 4 of the Cognitive Pipeline.
 * Scores task complexity to determine agent allocation strategy.
 * 
 * Scoring Formula:
 *   Score = (subtask_count × dependency_weight × risk_factor)
 * 
 *   0–3  → Simple   → 1–2 agents
 *   4–7  → Medium   → 3–5 agents parallel  
 *   8+   → Complex  → DAG execution with staged parallel waves
 */

export class ComplexityScorer {
    constructor() {
        this.thresholds = {
            simple: { max: 3, agentRange: [1, 2] },
            medium: { max: 7, agentRange: [3, 5] },
            complex: { max: Infinity, agentRange: [5, 10] },
        };

        // Risk keywords increase complexity
        this.riskKeywords = [
            'deploy', 'delete', 'production', 'database', 'migration',
            'security', 'authentication', 'payment', 'critical', 'infrastructure',
        ];
    }

    /**
     * Score task complexity
     * @param {{ tasks: object[], totalTasks: number }} decomposition
     * @returns {{ score: number, level: string, agentCount: number, waves: number, details: object }}
     */
    score(decomposition) {
        const { tasks } = decomposition;

        // Factor 1: Number of subtasks
        const subtaskCount = tasks.length;

        // Factor 2: Dependency weight (more deps = more complex)
        const totalDeps = tasks.reduce((sum, t) => sum + t.dependsOn.length, 0);
        const dependencyWeight = 1 + (totalDeps / Math.max(subtaskCount, 1));

        // Factor 3: Risk factor
        const riskFactor = this.calculateRiskFactor(tasks);

        // Final score
        const score = Math.round(subtaskCount * dependencyWeight * riskFactor * 10) / 10;

        // Determine level
        let level, agentRange;
        if (score <= this.thresholds.simple.max) {
            level = 'simple';
            agentRange = this.thresholds.simple.agentRange;
        } else if (score <= this.thresholds.medium.max) {
            level = 'medium';
            agentRange = this.thresholds.medium.agentRange;
        } else {
            level = 'complex';
            agentRange = this.thresholds.complex.agentRange;
        }

        // Calculate recommended agent count within range
        const normalizedScore = Math.min(score / 10, 1);
        const agentCount = Math.round(
            agentRange[0] + normalizedScore * (agentRange[1] - agentRange[0])
        );

        // Calculate execution waves (for complex tasks)
        const waves = this.calculateWaves(tasks);

        return {
            score,
            level,
            agentCount,
            waves,
            details: {
                subtaskCount,
                dependencyWeight: Math.round(dependencyWeight * 100) / 100,
                riskFactor: Math.round(riskFactor * 100) / 100,
            },
        };
    }

    /**
     * Calculate risk factor based on task descriptions
     */
    calculateRiskFactor(tasks) {
        let risk = 1.0;
        for (const task of tasks) {
            const description = task.description.toLowerCase();
            for (const keyword of this.riskKeywords) {
                if (description.includes(keyword)) {
                    risk += 0.2;
                }
            }
        }
        return Math.min(risk, 3.0); // Cap at 3x
    }

    /**
     * Calculate execution waves based on dependency structure
     * A wave = set of tasks that can run in parallel
     */
    calculateWaves(tasks) {
        const taskMap = new Map(tasks.map(t => [t.id, t]));
        const levels = new Map();

        const getLevel = (task) => {
            if (levels.has(task.id)) return levels.get(task.id);

            if (task.dependsOn.length === 0) {
                levels.set(task.id, 0);
                return 0;
            }

            const maxDepLevel = Math.max(
                ...task.dependsOn
                    .map(depId => taskMap.get(depId))
                    .filter(Boolean)
                    .map(dep => getLevel(dep))
            );

            const level = maxDepLevel + 1;
            levels.set(task.id, level);
            return level;
        };

        tasks.forEach(t => getLevel(t));

        const maxLevel = Math.max(0, ...levels.values());
        return maxLevel + 1;
    }
}
