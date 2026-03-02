/**
 * Hallucination Detector
 *
 * 4-stage anti-hallucination pipeline for agent outputs:
 *   1. Confidence Check      — is the output self-reported confidence high enough?
 *   2. Consistency Check     — do multiple outputs for same task agree?
 *   3. Constraint Enforcement — does output pass structural rules?
 *   4. Escalation Decision   — should this be reviewed or sent to consensus?
 *
 * Thresholds:
 *   >= 0.75  → PASS (output accepted)
 *   0.50–0.75 → REVIEW (flagged for human or meta-evaluator review)
 *   < 0.50   → CONSENSUS (requires multi-agent consensus voting)
 */

import { ConstraintEnforcer } from './constraint-enforcer.js';

export class HallucinationDetector {
    constructor() {
        this.constraintEnforcer = new ConstraintEnforcer();
        this.thresholds = {
            pass: 0.75,
            review: 0.50,
        };
    }

    /**
     * Run the full hallucination detection pipeline on execution results.
     * @param {{ results: object[] }} executionResult
     * @param {{ tasks: object[] }} decomposition
     * @returns {{ results: object[], flagged: object[], stats: object }}
     */
    detect(executionResult, decomposition) {
        const results = executionResult.results || [];
        const taskMap = new Map((decomposition.tasks || []).map(t => [t.id, t]));

        const processed = [];
        const flagged = [];

        // Group results by taskId for consistency checking
        const byTask = new Map();
        for (const r of results) {
            if (!byTask.has(r.taskId)) byTask.set(r.taskId, []);
            byTask.get(r.taskId).push(r);
        }

        for (const result of results) {
            if (result.status === 'failed') {
                processed.push({ ...result, hallucinationScore: 0, decision: 'failed' });
                continue;
            }

            // Stage 1: Confidence Check
            const confidenceScore = this._checkConfidence(result);

            // Stage 2: Consistency Check (if multiple outputs for same task)
            const peerResults = byTask.get(result.taskId) || [];
            const consistencyScore = this._checkConsistency(result, peerResults);

            // Stage 3: Constraint Enforcement
            const task = taskMap.get(result.taskId);
            const constraintResult = this.constraintEnforcer.enforce({
                output: result.output,
                taskId: result.taskId,
                description: task?.description || result.description,
            });

            // Combine scores (weighted average)
            const combinedScore = (
                confidenceScore * 0.3 +
                consistencyScore * 0.3 +
                constraintResult.score * 0.4
            );

            // Stage 4: Escalation Decision
            let decision;
            if (combinedScore >= this.thresholds.pass) {
                decision = 'pass';
            } else if (combinedScore >= this.thresholds.review) {
                decision = 'review';
            } else {
                decision = 'consensus';
            }

            const enriched = {
                ...result,
                hallucinationScore: Math.round(combinedScore * 100) / 100,
                decision,
                constraintViolations: constraintResult.violations,
            };

            processed.push(enriched);

            if (decision !== 'pass') {
                flagged.push(enriched);
            }
        }

        return {
            results: processed,
            flagged,
            stats: {
                total: processed.length,
                passed: processed.filter(r => r.decision === 'pass').length,
                review: processed.filter(r => r.decision === 'review').length,
                consensus: processed.filter(r => r.decision === 'consensus').length,
                failed: processed.filter(r => r.decision === 'failed').length,
            },
        };
    }

    /**
     * Stage 1: Check self-reported confidence.
     * Uses output metadata if available, otherwise heuristic.
     */
    _checkConfidence(result) {
        // If result has explicit confidence, use it
        if (typeof result.confidence === 'number') {
            return result.confidence;
        }

        // Heuristic: longer, well-structured outputs tend to be more reliable
        const output = result.output || '';
        const length = output.length;

        if (length < 20) return 0.3;
        if (length < 100) return 0.5;
        if (length > 5000) return 0.7;
        return 0.8;
    }

    /**
     * Stage 2: Check consistency among peer outputs for same task.
     * If only one output exists, assume full consistency.
     */
    _checkConsistency(result, peerResults) {
        if (peerResults.length <= 1) return 1.0;

        const output = (result.output || '').toLowerCase();
        const outputWords = new Set(output.split(/\s+/).filter(w => w.length > 3));

        let totalOverlap = 0;
        let peerCount = 0;

        for (const peer of peerResults) {
            if (peer === result) continue;
            const peerOutput = (peer.output || '').toLowerCase();
            const peerWords = new Set(peerOutput.split(/\s+/).filter(w => w.length > 3));

            if (outputWords.size === 0 || peerWords.size === 0) continue;

            // Jaccard similarity
            let intersection = 0;
            for (const w of outputWords) {
                if (peerWords.has(w)) intersection++;
            }
            const union = outputWords.size + peerWords.size - intersection;
            totalOverlap += intersection / union;
            peerCount++;
        }

        if (peerCount === 0) return 1.0;
        return totalOverlap / peerCount;
    }
}
