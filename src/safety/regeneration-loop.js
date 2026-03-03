/**
 * RegenerationLoop — Adaptive LLM Retry with Progressive Constraint Tightening
 *
 * When OutputValidator rejects LLM output, this module:
 *   1. Analyzes the failure: which categories of violations occurred
 *   2. Tightens the relevant constraints (adds more hard limits)
 *   3. Prepends failure context to the next attempt's user message
 *   4. Lowers temperature further each attempt
 *   5. Retries up to maxAttempts times
 *   6. Returns either the first passing result or the best partial result
 *
 * Backoff policy (for transient LLM network failures):
 *   Attempt 1 → immediate
 *   Attempt 2 → 2s delay
 *   Attempt 3 → 4s delay
 *   (configurable via opts.baseDelayMs)
 *
 * Zero dependencies — Node.js builtins only.
 */

import { PromptBuilder } from '../prompts/prompt-builder.js';
import { OutputValidator } from './output-validator.js';

// ─── Default config ────────────────────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 2000;

// ─── Constraint tightening rules per violation category ──────────────────────
// Each entry: { category, additionalHardLimits, additionalBehaviorConstraints }

const TIGHTENING_RULES = {
    placeholder: [
        'CRITICAL: Do NOT use any placeholder text. Every function body must be complete.',
        'CRITICAL: Do NOT end any code block with "..." or truncation comments.',
        'Write all functions in their entirety. No abbreviated implementations.',
    ],
    syntax: [
        'CRITICAL: Ensure all brackets { } ( ) [ ] are perfectly balanced.',
        'CRITICAL: Every string literal must be properly terminated with a matching quote.',
        'CRITICAL: Every function/class/if block must be properly closed.',
    ],
    imports: [
        'CRITICAL: Only import packages that were listed in the APPROVED IMPORTS section.',
        'CRITICAL: Do NOT import any package not explicitly approved.',
        'Use only Node.js built-ins (node:fs, node:path, etc.) if no other packages are listed.',
    ],
    constraints: [
        'CRITICAL: Stay strictly within the allowed file scope.',
        'CRITICAL: Do NOT reference any .env, credentials, or secrets files.',
        'CRITICAL: Do NOT produce path traversal patterns (../).',
    ],
    structural: [
        'CRITICAL: ESM files MUST have at least one export statement.',
        'CRITICAL: Do NOT mix require() and import syntax in the same file.',
        'CRITICAL: Test files MUST contain at least one test case with assertions.',
    ],
    semantic: [
        'CRITICAL: The output MUST include all required identifiers and patterns.',
        'CRITICAL: Match the task specification exactly — no extra features, no missing elements.',
    ],
};

// ─── RegenerationLoop ─────────────────────────────────────────────────────────

export class RegenerationLoop {
    /**
     * @param {object} opts
     * @param {number} [opts.maxAttempts=3]     — max total attempts (including attempt 1)
     * @param {number} [opts.baseDelayMs=2000]  — base delay between retries (doubles each time)
     * @param {Function} [opts.onAttempt]       — callback(attemptNumber, validationResult) for progress reporting
     */
    constructor(opts = {}) {
        this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
        this.onAttempt = opts.onAttempt || null;
    }

    /**
     * Run the adaptive regeneration loop.
     *
     * @param {object} opts
     * @param {object} opts.spec                — SpecificationAgent output
     * @param {object} opts.constraints         — ConstraintAgent output (mutated safely per attempt)
     * @param {object} opts.guardRules          — HallucinationGuardAgent output
     * @param {object} opts.qualityRules        — CodeQualityAgent output
     * @param {object} opts.verificationCriteria — VerificationAgent output
     * @param {object} opts.workspaceContext    — workspace scan
     * @param {object} opts.initialValidation  — ValidationResult from the first failed attempt
     * @param {string} opts.initialOutput      — LLM output that failed the first validation
     * @param {Function} opts.llmCall          — async (promptObj) => { content: string, ... }
     * @returns {Promise<{ output: string, passed: boolean, attempts: number, finalValidation: object }>}
     */
    async run(opts) {
        const {
            spec,
            constraints,
            guardRules,
            qualityRules,
            verificationCriteria,
            workspaceContext,
            initialValidation,
            initialOutput,
            llmCall,
        } = opts;

        // Track the best output seen so far (by score)
        let bestOutput = initialOutput;
        let bestValidation = initialValidation;
        let bestScore = initialValidation.score;

        // Start from attempt 2 (attempt 1 already happened outside this loop)
        for (let attempt = 2; attempt <= this.maxAttempts; attempt++) {
            // Build the previous failure context to inject into the next prompt
            const failureContext = OutputValidator.summarize(
                attempt === 2 ? initialValidation : bestValidation
            );

            // Tighten constraints based on which categories failed
            const tightenedConstraints = RegenerationLoop._tightenConstraints(
                constraints,
                failureContext,
                attempt
            );

            // Build the controlled prompt for this retry attempt
            const controlledPrompt = PromptBuilder.build({
                spec,
                constraints: tightenedConstraints,
                guardRules,
                qualityRules,
                verificationCriteria,
                workspaceContext,
                previousFailure: failureContext,
                attempt,
            });

            // Notify progress listener
            if (this.onAttempt) {
                try {
                    this.onAttempt(attempt, {
                        previousScore: bestScore,
                        tightenedConstraints,
                        temperature: controlledPrompt.temperature,
                        maxTokens: controlledPrompt.maxTokens,
                        violationSummary: failureContext.topIssues,
                    });
                } catch { /* swallow listener errors */ }
            }

            // Exponential backoff before retry (skip for attempt 2 to keep it fast)
            if (attempt > 2) {
                const delay = this.baseDelayMs * Math.pow(2, attempt - 3);
                await RegenerationLoop._sleep(delay);
            }

            // Call the LLM with tightened constraints
            let llmResult;
            try {
                llmResult = await llmCall({
                    systemPrompt: controlledPrompt.system,
                    userMessage: controlledPrompt.user,
                    maxTokens: controlledPrompt.maxTokens,
                    temperature: controlledPrompt.temperature,
                });
            } catch (llmErr) {
                // LLM call itself failed (network/timeout) — retry if attempts remain
                if (attempt < this.maxAttempts) {
                    const retryDelay = this.baseDelayMs * Math.pow(2, attempt - 1);
                    await RegenerationLoop._sleep(retryDelay);
                    continue;
                }
                // Exhausted retries — return best we have
                break;
            }

            const output = llmResult?.content || llmResult?.thinking || '';

            // Validate this new attempt
            const validation = OutputValidator.validate(output, verificationCriteria, tightenedConstraints);

            // Update best if this attempt improved the score
            if (validation.score > bestScore) {
                bestOutput = output;
                bestValidation = validation;
                bestScore = validation.score;
            }

            // If it passes, we are done
            if (validation.passed) {
                return {
                    output,
                    passed: true,
                    attempts: attempt,
                    finalValidation: validation,
                };
            }
        }

        // All attempts exhausted — return best partial result
        return {
            output: bestOutput,
            passed: bestValidation.passed,
            attempts: this.maxAttempts,
            finalValidation: bestValidation,
            exhausted: true,
        };
    }

    // ─── Constraint tightening ─────────────────────────────────────────────────

    /**
     * Produce a tightened copy of the constraints by adding extra hard limits
     * targeting the specific categories that failed.
     *
     * @private
     * @param {object} baseConstraints — original ConstraintAgent output
     * @param {object} failureContext  — summarized validation failure
     * @param {number} attempt         — attempt number (higher = tighter)
     * @returns {object} new constraints object (original not mutated)
     */
    static _tightenConstraints(baseConstraints, failureContext, attempt) {
        // Shallow clone to avoid mutating the original
        const tightened = {
            ...baseConstraints,
            hardLimits: [...(baseConstraints.hardLimits || [])],
            behaviorConstraints: [...(baseConstraints.behaviorConstraints || [])],
            formatConstraints: [...(baseConstraints.formatConstraints || [])],
        };

        // Add rules based on which categories failed
        const { categories } = failureContext;

        if (categories.placeholder.length > 0) {
            tightened.hardLimits.push(...TIGHTENING_RULES.placeholder);
        }
        if (categories.syntax.length > 0) {
            tightened.hardLimits.push(...TIGHTENING_RULES.syntax);
        }
        if (categories.imports.length > 0) {
            tightened.hardLimits.push(...TIGHTENING_RULES.imports);
        }
        if (categories.constraints.length > 0) {
            tightened.hardLimits.push(...TIGHTENING_RULES.constraints);
        }
        if (categories.structural.length > 0) {
            tightened.hardLimits.push(...TIGHTENING_RULES.structural);
        }
        if (categories.semantic.length > 0) {
            tightened.hardLimits.push(...TIGHTENING_RULES.semantic);
        }

        // On attempt 3+, add universal ultra-strict mode
        if (attempt >= 3) {
            tightened.hardLimits.push(
                'ULTRA-STRICT MODE: Every single line of code will be validated.',
                'Do NOT output ANYTHING that is not valid, complete, working code.',
                'If you cannot complete the task, write the minimum valid skeleton — never truncate.',
            );
            // Force zero-temperature thinking: remove all creative latitude
            tightened._forceMinimalTemperature = true;
        }

        // Deduplicate hard limits
        tightened.hardLimits = [...new Set(tightened.hardLimits)];

        return tightened;
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /** @private */
    static _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Convenience factory for constructing the loop with a simple config.
     *
     * @param {object} opts — same as constructor opts
     * @returns {RegenerationLoop}
     */
    static create(opts = {}) {
        return new RegenerationLoop(opts);
    }
}
