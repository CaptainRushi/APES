/**
 * Agent Guardrails — Per-Agent Safety Layer
 *
 * Every agent must pass guardrails before returning output.
 *
 * Pipeline:
 *   1. Validate output structure
 *   2. Check knowledge grounding (output relates to task)
 *   3. Score confidence (is confidence claim realistic?)
 *   4. Context boundary enforcement (stays within scope)
 *   5. Hallucination detection (per-agent level)
 *
 * If any guardrail fails critically, output is flagged for escalation.
 */

import { ConstraintEnforcer } from '../safety/constraint-enforcer.js';

export class AgentGuardrails {
    /**
     * @param {object} config
     * @param {string} config.agentId
     * @param {string} config.cluster
     * @param {string[]} [config.skills]
     */
    constructor(config) {
        this.agentId = config.agentId;
        this.cluster = config.cluster;
        this.skills = config.skills || [];
        this.constraintEnforcer = new ConstraintEnforcer();
    }

    /**
     * Run all guardrails on an agent's output.
     * @param {object} agentOutput - The structured AgentOutput
     * @param {object} agentInput  - The original AgentInput
     * @returns {{ passed: boolean, score: number, violations: object[], adjustedConfidence: number }}
     */
    check(agentOutput, agentInput) {
        const violations = [];
        let score = 1.0;

        // 1. Validate output structure
        const structureCheck = this._validateStructure(agentOutput);
        if (!structureCheck.passed) {
            violations.push(...structureCheck.violations);
            score -= 0.2;
        }

        // 2. Knowledge grounding check
        const groundingCheck = this._checkGrounding(agentOutput, agentInput);
        if (!groundingCheck.passed) {
            violations.push(...groundingCheck.violations);
            score -= 0.15;
        }

        // 3. Confidence calibration
        const confidenceCheck = this._calibrateConfidence(agentOutput);
        if (!confidenceCheck.passed) {
            violations.push(...confidenceCheck.violations);
            score -= 0.1;
        }

        // 4. Context boundary enforcement
        const boundaryCheck = this._checkBoundaries(agentOutput, agentInput);
        if (!boundaryCheck.passed) {
            violations.push(...boundaryCheck.violations);
            score -= 0.15;
        }

        // 5. Constraint enforcement (reuse global enforcer)
        const outputText = typeof agentOutput.result === 'string'
            ? agentOutput.result
            : JSON.stringify(agentOutput.result || '');
        const constraintCheck = this.constraintEnforcer.enforce({
            output: outputText,
            taskId: agentInput.taskId,
            description: agentInput.objective,
        });
        if (!constraintCheck.passed) {
            violations.push(...constraintCheck.violations.map(v => ({
                rule: v.rule,
                message: v.message,
                severity: v.severity,
            })));
            score -= 0.1;
        }

        score = Math.max(0, Math.min(1, score));

        // Adjust confidence based on guardrail findings
        const adjustedConfidence = Math.min(
            agentOutput.confidence,
            score * agentOutput.confidence + (1 - score) * 0.3
        );

        const criticalViolations = violations.filter(v => v.severity === 'error');

        return {
            passed: criticalViolations.length === 0,
            score,
            violations,
            adjustedConfidence,
        };
    }

    /**
     * 1. Validate output structure meets AgentOutput schema.
     */
    _validateStructure(output) {
        const violations = [];

        if (output.result === undefined) {
            violations.push({ rule: 'structure', message: 'Output result is undefined', severity: 'error' });
        }
        if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
            violations.push({ rule: 'structure', message: 'Invalid confidence value', severity: 'warning' });
        }
        if (!Array.isArray(output.risks)) {
            violations.push({ rule: 'structure', message: 'risks must be an array', severity: 'warning' });
        }

        return { passed: violations.length === 0, violations };
    }

    /**
     * 2. Check that output is grounded in the task objective.
     */
    _checkGrounding(output, input) {
        const violations = [];
        const result = String(output.result || '');
        const objective = (input.objective || '').toLowerCase();

        if (result.length === 0 && output.confidence > 0.5) {
            violations.push({
                rule: 'grounding',
                message: 'Empty result with high confidence — likely hallucination',
                severity: 'error',
            });
        }

        // Check keyword overlap between objective and result
        if (result.length > 0 && objective.length > 0) {
            const objWords = objective.split(/\s+/).filter(w => w.length > 3);
            const resultLower = result.toLowerCase();
            const matchCount = objWords.filter(w => resultLower.includes(w)).length;

            if (objWords.length > 3 && matchCount === 0) {
                violations.push({
                    rule: 'grounding',
                    message: 'Output appears unrelated to task objective',
                    severity: 'warning',
                });
            }
        }

        return { passed: violations.length === 0, violations };
    }

    /**
     * 3. Calibrate confidence — detect unrealistic confidence claims.
     */
    _calibrateConfidence(output) {
        const violations = [];
        const result = String(output.result || '');

        // Short outputs with high confidence are suspicious
        if (result.length < 30 && output.confidence > 0.9) {
            violations.push({
                rule: 'confidence_calibration',
                message: `Suspiciously high confidence (${output.confidence}) for short output (${result.length} chars)`,
                severity: 'warning',
            });
        }

        // Very high confidence on first attempt is unusual for complex tasks
        if (output.confidence >= 0.99 && output.metadata?.attempts <= 1) {
            violations.push({
                rule: 'confidence_calibration',
                message: 'Near-perfect confidence on first attempt — may indicate uncalibrated self-assessment',
                severity: 'warning',
            });
        }

        return { passed: violations.length === 0, violations };
    }

    /**
     * 4. Enforce context boundaries — agent stays within scope.
     */
    _checkBoundaries(output, input) {
        const violations = [];
        const result = String(output.result || '').toLowerCase();

        // Check for scope creep indicators
        const scopeIndicators = [
            { pattern: /i recommend changing the entire/i, msg: 'Scope creep: recommending full system change' },
            { pattern: /rewrite everything/i, msg: 'Scope creep: suggesting complete rewrite' },
            { pattern: /beyond the scope of this task/i, msg: 'Agent acknowledged scope boundary' },
        ];

        for (const { pattern, msg } of scopeIndicators) {
            if (pattern.test(result)) {
                violations.push({
                    rule: 'boundary',
                    message: msg,
                    severity: 'warning',
                });
            }
        }

        // Cluster boundary check — agent shouldn't produce outputs far outside its domain
        const clusterKeywords = {
            engineering: ['code', 'function', 'class', 'api', 'implementation'],
            code_quality: ['review', 'bug', 'test', 'lint', 'refactor'],
            execution_automation: ['deploy', 'docker', 'infrastructure', 'monitor'],
            research_intelligence: ['research', 'analysis', 'findings', 'data'],
            strategic_planning: ['plan', 'architecture', 'design', 'strategy'],
            version_control: ['git', 'branch', 'commit', 'merge', 'release'],
            memory_learning: ['pattern', 'metric', 'optimization', 'benchmark'],
            control_safety: ['security', 'validation', 'compliance', 'audit'],
        };

        // Only warn if output is long and contains zero cluster keywords
        const keywords = clusterKeywords[this.cluster] || [];
        if (result.length > 100 && keywords.length > 0) {
            const hasRelevant = keywords.some(kw => result.includes(kw));
            if (!hasRelevant) {
                violations.push({
                    rule: 'boundary',
                    message: `Output may be outside ${this.cluster} domain scope`,
                    severity: 'warning',
                });
            }
        }

        return { passed: violations.length === 0, violations };
    }

    /**
     * Get guardrails summary.
     */
    getSummary() {
        return {
            agentId: this.agentId,
            cluster: this.cluster,
            checks: ['structure', 'grounding', 'confidence_calibration', 'boundary', 'constraints'],
        };
    }
}
