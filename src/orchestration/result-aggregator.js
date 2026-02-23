/**
 * Result Aggregator
 * 
 * Stage 8 of the Cognitive Pipeline.
 * Aggregates results from multiple agents into a unified response.
 */

export class ResultAggregator {
    /**
     * Aggregate execution results into a summary
     * @param {object} executionResult - Raw results from DAG execution
     * @param {object} evaluation - Evaluation metrics
     * @returns {{ summary: string, details: object[] }}
     */
    aggregate(executionResult, evaluation) {
        const results = executionResult.results || [];

        // Build individual task summaries
        const details = results.map(r => ({
            taskId: r.taskId,
            description: r.description,
            status: r.status,
            output: r.output,
            duration: r.duration,
            agentId: r.agentId,
        }));

        // Generate executive summary
        const summary = this.generateSummary(evaluation, details);

        return { summary, details };
    }

    generateSummary(evaluation, details) {
        const parts = [];

        if (evaluation.completed > 0) {
            parts.push(`✓ ${evaluation.completed}/${evaluation.total} tasks completed`);
        }

        if (evaluation.failed > 0) {
            parts.push(`✗ ${evaluation.failed} failed`);
        }

        if (evaluation.totalDuration > 0) {
            parts.push(`⏱ ${evaluation.totalDuration}ms total`);
        }

        parts.push(`Quality: ${Math.round(evaluation.quality * 100)}%`);

        // Add individual results
        const outputs = details
            .filter(d => d.output && d.status === 'completed')
            .map(d => `  • ${d.description}: ${d.output}`)
            .join('\n');

        if (outputs) {
            return parts.join(' | ') + '\n\n' + outputs;
        }

        return parts.join(' | ');
    }
}
