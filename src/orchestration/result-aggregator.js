/**
 * Result Aggregator
 *
 * Stage 8 of the Cognitive Pipeline.
 * Aggregates results from multiple agents into a unified response.
 * Includes conflict detection and resolution for multi-agent disagreements.
 */

import { ConflictResolver } from '../safety/conflict-resolver.js';

export class ResultAggregator {
    constructor() {
        this.conflictResolver = new ConflictResolver();
    }

    /**
     * Aggregate execution results into a summary
     * @param {object} executionResult - Raw results from DAG execution
     * @param {object} evaluation - Evaluation metrics
     * @returns {{ summary: string, details: object[], conflicts: object }}
     */
    aggregate(executionResult, evaluation) {
        const results = executionResult.results || [];

        // Detect conflicts
        const { conflicts, noConflict } = this.conflictResolver.detect(executionResult);

        // Resolve any conflicts
        let resolvedConflicts = [];
        if (conflicts.length > 0) {
            resolvedConflicts = this.conflictResolver.resolve(conflicts);
        }

        // Merge resolved + no-conflict results
        const finalResults = [...noConflict, ...resolvedConflicts];

        // Build individual task summaries — verify status against actual output
        const details = finalResults.map(r => {
            // Don't trust 'completed' status if there's no real output
            const hasOutput = r.output && r.output.length > 0 && r.output !== 'Task completed';
            const verifiedStatus = r.status === 'completed' && !hasOutput ? 'failed' : r.status;
            return {
                taskId: r.taskId,
                description: r.description,
                status: verifiedStatus,
                output: r.output,
                duration: r.duration,
                agentId: r.agentId,
                resolution: r.resolution || null,
            };
        });

        // Generate executive summary
        const summary = this.generateSummary(evaluation, details);

        return {
            summary,
            details,
            conflicts: {
                detected: conflicts.length,
                resolved: resolvedConflicts.length,
                details: conflicts.map(c => ({
                    taskId: c.taskId,
                    alternativeCount: c.uniqueCount,
                })),
            },
        };
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
