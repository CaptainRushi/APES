/**
 * Agent Output — User-Experience Layer
 *
 * Structured output formatting for micro-agent results.
 * Ensures every agent returns a consistent, validated schema.
 *
 * AgentOutput Schema:
 *   result:             any      — the primary output
 *   confidence:         number   — 0.0 to 1.0 self-assessed confidence
 *   risks:              string[] — identified risks or uncertainties
 *   requiresEscalation: boolean  — should this go to Lead/meta-evaluator?
 *   metadata:           object   — timing, skill usage, autonomy state
 */

export class AgentOutput {
    /**
     * Create a structured AgentOutput from raw result data.
     * @param {object} fields
     * @returns {object}
     */
    static create(fields = {}) {
        return {
            result: fields.result ?? null,
            confidence: AgentOutput._clamp(fields.confidence ?? 0.5, 0, 1),
            risks: fields.risks || [],
            requiresEscalation: fields.requiresEscalation ?? false,
            metadata: {
                agentId: fields.agentId || null,
                agentRole: fields.agentRole || null,
                taskId: fields.taskId || null,
                skillsUsed: fields.skillsUsed || [],
                executionTimeMs: fields.executionTimeMs || 0,
                attempts: fields.attempts || 1,
                mode: fields.mode || 'simulation',
                autonomyState: fields.autonomyState || null,
                guardrailsPassed: fields.guardrailsPassed ?? true,
                constraintViolations: fields.constraintViolations || [],
            },
        };
    }

    /**
     * Create a success output.
     * @param {any} result
     * @param {number} confidence
     * @param {object} [meta]
     * @returns {object}
     */
    static success(result, confidence = 0.85, meta = {}) {
        return AgentOutput.create({
            result,
            confidence,
            requiresEscalation: false,
            ...meta,
        });
    }

    /**
     * Create an error output.
     * @param {string} error
     * @param {object} [meta]
     * @returns {object}
     */
    static error(error, meta = {}) {
        return AgentOutput.create({
            result: null,
            confidence: 0,
            risks: [error],
            requiresEscalation: true,
            ...meta,
        });
    }

    /**
     * Create an escalation output.
     * @param {string} reason
     * @param {any} partialResult
     * @param {object} [meta]
     * @returns {object}
     */
    static escalate(reason, partialResult = null, meta = {}) {
        return AgentOutput.create({
            result: partialResult,
            confidence: 0.3,
            risks: [`Escalation: ${reason}`],
            requiresEscalation: true,
            ...meta,
        });
    }

    /**
     * Validate an AgentOutput object.
     * @param {object} output
     * @returns {{ valid: boolean, errors: string[] }}
     */
    static validate(output) {
        const errors = [];
        if (output.confidence === undefined || typeof output.confidence !== 'number') {
            errors.push('confidence must be a number');
        }
        if (output.confidence < 0 || output.confidence > 1) {
            errors.push('confidence must be between 0 and 1');
        }
        if (!Array.isArray(output.risks)) {
            errors.push('risks must be an array');
        }
        if (typeof output.requiresEscalation !== 'boolean') {
            errors.push('requiresEscalation must be boolean');
        }
        return { valid: errors.length === 0, errors };
    }

    /**
     * Convert AgentOutput to a flat string for pipeline output.
     * @param {object} output
     * @returns {string}
     */
    static toOutputString(output) {
        if (typeof output.result === 'string') return output.result;
        if (output.result === null || output.result === undefined) return '';
        return JSON.stringify(output.result);
    }

    static _clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }
}
