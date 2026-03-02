/**
 * Constraint Enforcer
 *
 * Rule-based output constraint checking for agent outputs.
 * Validates outputs against a set of rules before they pass through the pipeline.
 *
 * Rules:
 *   1. non_empty_output     — output must not be empty or whitespace
 *   2. no_placeholder_text  — output must not contain placeholder markers
 *   3. reasonable_length    — output must be between 10-50000 chars
 *   4. task_reference       — output should reference the original task context
 */

const PLACEHOLDER_PATTERNS = [
    /\[TODO\]/i,
    /\[INSERT.*HERE\]/i,
    /\[PLACEHOLDER\]/i,
    /\[FILL IN\]/i,
    /Lorem ipsum/i,
    /\.\.\.\s*$/,
    /^TODO:/i,
    /\[YOUR.*HERE\]/i,
];

export class ConstraintEnforcer {
    constructor() {
        this.rules = [
            { id: 'non_empty_output', check: this._checkNonEmpty },
            { id: 'no_placeholder_text', check: this._checkNoPlaceholder },
            { id: 'reasonable_length', check: this._checkLength },
            { id: 'task_reference', check: this._checkTaskReference },
            { id: 'workspace_file_safety', check: this._checkWorkspaceFileSafety },
        ];
    }

    /**
     * Enforce all constraints on an agent output.
     * @param {{ output: string, taskId?: string, description?: string }} result
     * @returns {{ passed: boolean, violations: object[], score: number }}
     */
    enforce(result) {
        const violations = [];
        const output = result.output || '';

        for (const rule of this.rules) {
            const check = rule.check(output, result);
            if (!check.passed) {
                violations.push({
                    rule: rule.id,
                    message: check.message,
                    severity: check.severity || 'warning',
                });
            }
        }

        const score = violations.length === 0
            ? 1.0
            : Math.max(0, 1.0 - violations.length * 0.25);

        return {
            passed: violations.filter(v => v.severity === 'error').length === 0,
            violations,
            score,
        };
    }

    _checkNonEmpty(output) {
        if (!output || output.trim().length === 0) {
            return { passed: false, message: 'Output is empty or whitespace', severity: 'error' };
        }
        return { passed: true };
    }

    _checkNoPlaceholder(output) {
        for (const pattern of PLACEHOLDER_PATTERNS) {
            if (pattern.test(output)) {
                return {
                    passed: false,
                    message: `Output contains placeholder text matching: ${pattern}`,
                    severity: 'warning',
                };
            }
        }
        return { passed: true };
    }

    _checkLength(output) {
        if (output.length < 10) {
            return { passed: false, message: `Output too short (${output.length} chars, min 10)`, severity: 'warning' };
        }
        if (output.length > 50000) {
            return { passed: false, message: `Output too long (${output.length} chars, max 50000)`, severity: 'warning' };
        }
        return { passed: true };
    }

    _checkTaskReference(output, result) {
        // If we have a task description, check the output is at least tangentially related
        if (!result.description) return { passed: true };

        // Extract key words from description (> 3 chars)
        const keywords = result.description
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 3);

        if (keywords.length === 0) return { passed: true };

        const outputLower = output.toLowerCase();
        const matchCount = keywords.filter(kw => outputLower.includes(kw)).length;
        const matchRatio = matchCount / keywords.length;

        if (matchRatio < 0.1 && keywords.length > 2) {
            return {
                passed: false,
                message: `Output may not reference the task (${Math.round(matchRatio * 100)}% keyword overlap)`,
                severity: 'warning',
            };
        }
        return { passed: true };
    }

    _checkWorkspaceFileSafety(output) {
        // Check for dangerous file operation patterns in output
        const dangerousPatterns = [
            { pattern: /\.\.[/\\]/g, label: 'path traversal (../)' },
            { pattern: /writeFile\s*\(\s*['"`]\.env/i, label: 'write to .env' },
            { pattern: /writeFile\s*\(\s*['"`].*credentials/i, label: 'write to credentials' },
            { pattern: /writeFile\s*\(\s*['"`].*secrets/i, label: 'write to secrets' },
            { pattern: /deleteFile\s*\(\s*['"`]node_modules/i, label: 'delete in node_modules' },
            { pattern: /writeFile\s*\(\s*['"`].*\.ssh/i, label: 'write to .ssh' },
            { pattern: /deleteFile\s*\(\s*['"`]\.git[/\\]config/i, label: 'delete .git/config' },
        ];

        for (const { pattern, label } of dangerousPatterns) {
            if (pattern.test(output)) {
                return {
                    passed: false,
                    message: `Workspace safety: output references dangerous file operation (${label})`,
                    severity: 'error',
                };
            }
        }
        return { passed: true };
    }
}
