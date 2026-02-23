/**
 * Result Evaluator
 * 
 * Stage 7 of the Cognitive Pipeline.
 * Evaluates execution results against expected outcomes.
 * Measures: time efficiency, accuracy, error count.
 */

export class ResultEvaluator {
    /**
     * Evaluate execution results
     * @param {object} executionResult - Results from DAG execution
     * @param {{ tasks: object[] }} decomposition - Original task decomposition
     * @returns {object} Evaluation metrics  
     */
    evaluate(executionResult, decomposition) {
        const results = executionResult.results || [];
        const tasks = decomposition.tasks || [];

        const completed = results.filter(r => r.status === 'completed').length;
        const failed = results.filter(r => r.status === 'failed').length;
        const skipped = results.filter(r => r.status === 'skipped').length;

        // Time efficiency: compare actual vs estimated
        const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
        const avgDuration = results.length > 0 ? totalDuration / results.length : 0;

        // Success rate
        const successRate = results.length > 0 ? completed / results.length : 0;

        // Error analysis
        const errors = results
            .filter(r => r.error)
            .map(r => ({
                taskId: r.taskId,
                error: r.error,
                recoverable: !r.error.includes('fatal'),
            }));

        return {
            completed,
            failed,
            skipped,
            total: results.length,
            successRate: Math.round(successRate * 100) / 100,
            totalDuration,
            avgDuration: Math.round(avgDuration),
            errors,
            quality: this.calculateQuality(successRate, avgDuration, errors.length),
        };
    }

    /**
     * Calculate overall quality score (0-1)
     */
    calculateQuality(successRate, avgDuration, errorCount) {
        const successWeight = 0.6;
        const speedWeight = 0.2;
        const errorWeight = 0.2;

        const speedScore = Math.max(0, 1 - (avgDuration / 10000)); // Normalize against 10s
        const errorScore = Math.max(0, 1 - (errorCount / 5));

        return Math.round(
            (successRate * successWeight + speedScore * speedWeight + errorScore * errorWeight) * 100
        ) / 100;
    }
}
