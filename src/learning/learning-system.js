/**
 * Learning System
 * 
 * Controlled learning through reinforcement scoring.
 * NOT retraining the LLM — training:
 *   - Agent selection policy
 *   - Task routing policy
 *   - Execution heuristics
 * 
 * After Task Completion:
 *   1. Compare expected vs actual output
 *   2. Measure: time efficiency, accuracy, error count
 *   3. Store optimization pattern
 *   4. Update agent confidence score
 * 
 * Scoring Rule:
 *   if execution_time < cluster_avg → confidence += 0.02
 *   if execution failed             → confidence -= 0.05
 */

export class LearningSystem {
    constructor(memory) {
        /** @type {import('../memory/memory-system.js').MemorySystem} */
        this.memory = memory;

        // Learning parameters
        this.config = {
            confidenceBoost: 0.02,
            confidencePenalty: 0.05,
            minConfidence: 0.1,
            maxConfidence: 1.0,
            patternThreshold: 3, // Minimum occurrences to consider a pattern
        };

        // Accumulated update queue (batch updates)
        this.updateQueue = [];
    }

    /**
     * Process learning update after task completion
     * @param {object} executionData - Full pipeline data
     */
    update(executionData) {
        const {
            input,
            intent,
            tasks,
            complexity,
            allocation,
            execution,
            evaluation,
            duration,
        } = executionData;

        // ─── Step 1: Record Performance ──────────────
        this.recordPerformanceMetrics(allocation, execution, complexity);

        // ─── Step 2: Analyze Patterns ────────────────
        this.analyzePatterns(input, intent, complexity, evaluation);

        // ─── Step 3: Generate Confidence Updates ─────
        const updates = this.generateConfidenceUpdates(allocation, execution, complexity);
        this.updateQueue.push(...updates);

        // ─── Step 4: Store Task Solution ─────────────
        if (evaluation.successRate > 0.8) {
            this.memory.storeTaskSolution(input, JSON.stringify({
                intent: intent.type,
                complexity: complexity.level,
                agents: allocation.agents.map(a => a.id),
                duration,
                quality: evaluation.quality,
            }));
        }
    }

    /**
     * Record performance metrics for all agents involved
     */
    recordPerformanceMetrics(allocation, execution, complexity) {
        const results = execution.results || [];

        for (const result of results) {
            this.memory.recordPerformance({
                agentId: result.agentId,
                taskId: result.taskId,
                duration: result.duration || 0,
                success: result.status === 'completed',
                complexity: complexity.level,
                cluster: allocation.agents.find(a => a.id === result.agentId)?.cluster,
            });
        }
    }

    /**
     * Analyze execution patterns for optimization
     */
    analyzePatterns(input, intent, complexity, evaluation) {
        // Pattern: Intent + Complexity → Performance
        const patternKey = `${intent.type}:${complexity.level}`;

        if (evaluation.quality > 0.8) {
            this.memory.recordPattern({
                pattern: patternKey,
                optimization: `High quality (${evaluation.quality}) for ${intent.type}/${complexity.level}`,
                quality: evaluation.quality,
            });
        }

        // Pattern: Fast execution optimization
        if (evaluation.avgDuration > 0 && evaluation.avgDuration < 100) {
            this.memory.recordPattern({
                pattern: `fast_execution:${intent.type}`,
                optimization: `Fast execution detected for ${intent.type} tasks`,
                avgDuration: evaluation.avgDuration,
            });
        }
    }

    /**
     * Generate confidence score updates
     * @returns {Array<{agentId: string, delta: number, reason: string}>}
     */
    generateConfidenceUpdates(allocation, execution, complexity) {
        const updates = [];
        const results = execution.results || [];

        for (const result of results) {
            if (!result.agentId) continue;

            const agentPerf = this.memory.getAgentPerformance(result.agentId);
            const clusterPerf = this.memory.getClusterPerformance(
                allocation.agents.find(a => a.id === result.agentId)?.cluster
            );

            if (result.status === 'completed') {
                // Reward: faster than cluster average
                const clusterAvg = clusterPerf?.avgDuration || result.duration;

                if (result.duration < clusterAvg) {
                    updates.push({
                        agentId: result.agentId,
                        delta: this.config.confidenceBoost,
                        reason: `Faster than cluster avg (${result.duration}ms < ${clusterAvg}ms)`,
                    });
                }
            } else if (result.status === 'failed') {
                // Penalty: task failed
                updates.push({
                    agentId: result.agentId,
                    delta: -this.config.confidencePenalty,
                    reason: `Task failed: ${result.error || 'unknown'}`,
                });
            }
        }

        return updates;
    }

    /**
     * Apply all queued confidence updates to the registry
     * @param {import('../agents/registry.js').AgentRegistry} registry
     */
    applyUpdates(registry) {
        for (const update of this.updateQueue) {
            const agent = registry.getAgent(update.agentId);
            if (!agent) continue;

            const newConfidence = Math.max(
                this.config.minConfidence,
                Math.min(this.config.maxConfidence, agent.confidenceScore + update.delta)
            );

            agent.confidenceScore = Math.round(newConfidence * 1000) / 1000;
        }

        // Clear the queue
        const applied = this.updateQueue.length;
        this.updateQueue = [];
        return applied;
    }

    /**
     * Get learning statistics
     */
    getStats() {
        return {
            pendingUpdates: this.updateQueue.length,
            learnedPatterns: this.memory.getLearnedPatterns().length,
            performanceEntries: this.memory.performanceMemory.length,
        };
    }
}
