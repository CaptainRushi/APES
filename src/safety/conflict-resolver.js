/**
 * Conflict Resolver
 *
 * Detects and resolves conflicts when multiple agents produce
 * different outputs for the same task.
 *
 * Resolution strategies:
 *   1. Weighted Confidence Voting — pick output with highest weighted confidence
 *   2. Arbitration Fallback       — if votes are too close, merge outputs
 */

export class ConflictResolver {
    constructor() {
        /** Minimum confidence gap to declare a clear winner (avoids tie) */
        this.minGap = 0.15;
    }

    /**
     * Detect conflicts in execution results.
     * A conflict exists when multiple different outputs exist for the same task.
     * @param {{ results: object[] }} executionResult
     * @returns {{ conflicts: object[], noConflict: object[] }}
     */
    detect(executionResult) {
        const results = executionResult.results || [];

        // Group by taskId
        const byTask = new Map();
        for (const r of results) {
            if (r.status === 'failed') continue;
            if (!byTask.has(r.taskId)) byTask.set(r.taskId, []);
            byTask.get(r.taskId).push(r);
        }

        const conflicts = [];
        const noConflict = [];

        for (const [taskId, taskResults] of byTask) {
            if (taskResults.length <= 1) {
                noConflict.push(...taskResults);
                continue;
            }

            // Check if outputs are meaningfully different
            const unique = this._uniqueOutputs(taskResults);
            if (unique.length <= 1) {
                noConflict.push(taskResults[0]);
            } else {
                conflicts.push({
                    taskId,
                    outputs: taskResults,
                    uniqueCount: unique.length,
                });
            }
        }

        return { conflicts, noConflict };
    }

    /**
     * Resolve a set of conflicting outputs.
     * @param {object[]} conflicts - From detect()
     * @returns {object[]} Resolved results (one per conflicted task)
     */
    resolve(conflicts) {
        const resolved = [];

        for (const conflict of conflicts) {
            const winner = this._weightedVote(conflict.outputs);

            if (winner) {
                resolved.push({
                    ...winner,
                    resolution: 'confidence_vote',
                    alternativeCount: conflict.uniqueCount - 1,
                });
            } else {
                // Arbitration fallback: merge outputs
                const merged = this._arbitrate(conflict.outputs);
                resolved.push({
                    taskId: conflict.taskId,
                    description: conflict.outputs[0].description,
                    status: 'completed',
                    output: merged,
                    duration: Math.max(...conflict.outputs.map(o => o.duration || 0)),
                    agentId: conflict.outputs.map(o => o.agentId).join('+'),
                    wave: conflict.outputs[0].wave,
                    resolution: 'arbitration',
                    alternativeCount: conflict.uniqueCount,
                });
            }
        }

        return resolved;
    }

    /**
     * Weighted confidence voting: pick the output with highest score.
     * Returns null if no clear winner (gap < minGap).
     */
    _weightedVote(outputs) {
        // Sort by hallucinationScore or confidence
        const scored = outputs.map(o => ({
            ...o,
            score: o.hallucinationScore ?? o.confidence ?? 0.5,
        }));

        scored.sort((a, b) => b.score - a.score);

        if (scored.length < 2) return scored[0] || null;

        const gap = scored[0].score - scored[1].score;
        if (gap >= this.minGap) {
            return scored[0];
        }

        return null; // Too close — needs arbitration
    }

    /**
     * Arbitration: merge outputs from multiple agents.
     * Takes the longest/most detailed output as primary,
     * appends unique insights from others.
     */
    _arbitrate(outputs) {
        // Sort by output length (longest first = most detailed)
        const sorted = [...outputs].sort((a, b) =>
            (b.output || '').length - (a.output || '').length
        );

        const primary = sorted[0].output || '';
        const extras = sorted.slice(1)
            .map(o => o.output || '')
            .filter(o => o.length > 0);

        if (extras.length === 0) return primary;

        return primary + '\n\n--- Additional perspectives ---\n' +
            extras.map((e, i) => `[Agent ${i + 2}]: ${e}`).join('\n');
    }

    /**
     * Identify unique outputs (by content hash).
     */
    _uniqueOutputs(results) {
        const seen = new Set();
        const unique = [];
        for (const r of results) {
            const key = (r.output || '').trim().toLowerCase().slice(0, 200);
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }
        return unique;
    }
}
