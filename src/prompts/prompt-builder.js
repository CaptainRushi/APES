/**
 * PromptBuilder — Controlled LLM Prompt Assembler
 *
 * Takes the structured output from all 5 control agents and assembles a
 * tightly-controlled system + user prompt pair for the LLM.
 *
 * Design contract:
 *   - The LLM NEVER sees the raw user objective as its user message
 *   - The system prompt enforces role, constraints, and output format
 *   - The user message is the precise task spec — not a free-form request
 *   - All anti-hallucination rules are injected as hard constraints
 *   - Temperature and maxTokens are also computed here based on complexity
 *
 * Zero dependencies — Node.js builtins only.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base token budgets by complexity */
const TOKEN_BUDGETS = {
    low: 4096,
    medium: 8192,
    high: 12288,
};

/** Temperature targets by task domain */
const TEMPERATURE_MAP = {
    code_generation: 0.1,
    bug_fix: 0.05,
    refactor: 0.1,
    testing: 0.1,
    documentation: 0.3,
    devops: 0.1,
    security: 0.05,
    database: 0.05,
    api: 0.1,
    frontend: 0.15,
    backend: 0.1,
    general: 0.2,
};

// ─── PromptBuilder ───────────────────────────────────────────────────────────

export class PromptBuilder {
    /**
     * Build a fully controlled system + user prompt from control agent outputs.
     *
     * @param {object} opts
     * @param {object} opts.spec              — SpecificationAgent output
     * @param {object} opts.constraints       — ConstraintAgent output
     * @param {object} opts.guardRules        — HallucinationGuardAgent output
     * @param {object} opts.qualityRules      — CodeQualityAgent output
     * @param {object} opts.verificationCriteria — VerificationAgent output
     * @param {object} opts.workspaceContext  — enriched workspace scan
     * @param {object} [opts.previousFailure] — failure context for regeneration
     * @param {number} [opts.attempt]         — regeneration attempt number (default 1)
     * @returns {{ system: string, user: string, maxTokens: number, temperature: number }}
     */
    static build(opts) {
        const {
            spec,
            constraints,
            guardRules,
            qualityRules,
            verificationCriteria,
            workspaceContext,
            previousFailure = null,
            attempt = 1,
        } = opts;

        const system = PromptBuilder._buildSystemPrompt(
            spec, constraints, guardRules, qualityRules, verificationCriteria, workspaceContext, attempt
        );

        const user = PromptBuilder._buildUserMessage(
            spec, constraints, guardRules, qualityRules, workspaceContext, previousFailure, attempt
        );

        const maxTokens = PromptBuilder._computeMaxTokens(spec, attempt);
        const temperature = PromptBuilder._computeTemperature(spec, attempt);

        return { system, user, maxTokens, temperature };
    }

    // ─── System Prompt ────────────────────────────────────────────────────────

    /**
     * Build the system prompt with all injected constraints.
     * @private
     */
    static _buildSystemPrompt(spec, constraints, guardRules, qualityRules, verificationCriteria, workspaceContext, attempt) {
        const parts = [];

        // ── SECTION 1: ROLE DEFINITION ─────────────────────────────────────
        parts.push(PromptBuilder._section('ROLE', [
            'You are a deterministic code generation engine.',
            'Your ONLY output is production-ready code that satisfies the task specification exactly.',
            'You do not explain. You do not describe your approach. You produce code.',
            `Primary language: ${spec.primaryLanguage}`,
            `Module style: ${qualityRules.moduleStyle || 'esm'}`,
            attempt > 1 ? `REGENERATION ATTEMPT ${attempt}: Previous output failed validation. Constraints are tightened.` : null,
        ].filter(Boolean)));

        // ── SECTION 2: WORKSPACE CONTEXT ──────────────────────────────────
        const workspaceLines = PromptBuilder._buildWorkspaceSection(workspaceContext);
        if (workspaceLines.length > 0) {
            parts.push(PromptBuilder._section('WORKSPACE CONTEXT', workspaceLines));
        }

        // ── SECTION 3: HARD CONSTRAINTS ───────────────────────────────────
        parts.push(PromptBuilder._section('HARD CONSTRAINTS — VIOLATION = IMMEDIATE REJECTION', [
            ...constraints.hardLimits,
            ...constraints.securityConstraints,
        ]));

        // ── SECTION 4: CODE QUALITY RULES ─────────────────────────────────
        const qualityLines = [
            `Naming: ${JSON.stringify(qualityRules.namingConventions)}`,
            `Max function length: ${qualityRules.complexityLimits?.maxFunctionLines} lines`,
            `Max file length: ${qualityRules.complexityLimits?.maxFileLines} lines`,
            `Max parameters: ${qualityRules.complexityLimits?.maxParameters}`,
            ...qualityRules.requiredPatterns,
            ...qualityRules.forbiddenPatterns,
        ];
        parts.push(PromptBuilder._section('CODE QUALITY RULES', qualityLines));

        // ── SECTION 5: ANTI-HALLUCINATION GROUNDING ───────────────────────
        parts.push(PromptBuilder._section('GROUNDING RULES — ANTI-HALLUCINATION', [
            ...guardRules.groundingInstructions,
            '',
            'UNCERTAINTY PROTOCOL (when you are unsure):',
            ...guardRules.uncertaintyProtocols.map(p => `  - ${p}`),
        ]));

        // ── SECTION 6: IMPORT RESTRICTIONS ────────────────────────────────
        if (constraints.allowedImports && constraints.allowedImports.length > 0) {
            const importSection = [
                'Only import from the following approved packages and Node.js builtins:',
                constraints.allowedImports.slice(0, 40).join(', '),
            ];
            if (constraints.zeroDepMode) {
                importSection.unshift('ZERO DEPENDENCY MODE: This project uses ONLY Node.js built-in modules. No npm packages.');
            }
            parts.push(PromptBuilder._section('APPROVED IMPORTS', importSection));
        }

        // ── SECTION 7: BEHAVIORAL CONSTRAINTS ─────────────────────────────
        if (constraints.behaviorConstraints && constraints.behaviorConstraints.length > 0) {
            parts.push(PromptBuilder._section('BEHAVIORAL CONSTRAINTS', constraints.behaviorConstraints));
        }

        // ── SECTION 8: OUTPUT FORMAT ───────────────────────────────────────
        parts.push(PromptBuilder._section('REQUIRED OUTPUT FORMAT', [
            'Output ONLY the requested file(s). No prose, no explanations.',
            'Each file MUST begin with a comment indicating its path:',
            '  For JS/TS: // filename: path/to/file.js',
            '  For Python: # filename: path/to/file.py',
            '  For HTML/CSS: <!-- filename: path/to/file.html -->',
            'Write COMPLETE file contents. No truncation. No "// rest of code here".',
            'If creating multiple files, output them sequentially — one after another.',
            'No markdown fences around the output unless you are writing a .md file.',
        ]));

        // ── SECTION 9: VERIFICATION CONDITIONS ────────────────────────────
        const verificationLines = PromptBuilder._buildVerificationSection(verificationCriteria);
        if (verificationLines.length > 0) {
            parts.push(PromptBuilder._section('VERIFICATION CONDITIONS (output will be validated against these)', verificationLines));
        }

        // ── SECTION 10: ERROR HANDLING REQUIREMENTS ───────────────────────
        if (spec.errorHandling && spec.errorHandling.length > 0) {
            parts.push(PromptBuilder._section('REQUIRED ERROR HANDLING', spec.errorHandling));
        }

        return parts.join('\n\n');
    }

    // ─── User Message ─────────────────────────────────────────────────────────

    /**
     * Build the structured user message — a precise task spec, not the raw objective.
     * @private
     */
    static _buildUserMessage(spec, constraints, guardRules, qualityRules, workspaceContext, previousFailure, attempt) {
        const parts = [];

        // ── TASK SPECIFICATION ────────────────────────────────────────────
        parts.push('## TASK SPECIFICATION');
        parts.push(`Objective: ${spec.objective}`);
        parts.push(`Language: ${spec.primaryLanguage}`);
        parts.push(`Task domains: ${spec.taskDomains.join(', ')}`);
        parts.push(`Complexity: ${spec.complexity}`);
        parts.push(`Is modification (edit existing): ${spec.isModification}`);

        // ── SCOPE RESTRICTIONS ────────────────────────────────────────────
        if (spec.outputFiles && spec.outputFiles.length > 0) {
            parts.push('\n## FILE SCOPE');
            parts.push('Files to produce or modify:');
            for (const file of spec.outputFiles) {
                parts.push(`  - ${file.path} (${file.role}, confidence: ${file.confidence})`);
            }
        }

        if (constraints.allowedFileScope && !constraints.allowedFileScope.includes('*')) {
            parts.push('\nAllowed file paths (stay within these):');
            parts.push('  ' + constraints.allowedFileScope.join(', '));
        }

        parts.push('\nForbidden file paths (never touch these):');
        parts.push('  ' + constraints.forbiddenFilePaths.join(', '));

        // ── FUNCTION SIGNATURES ───────────────────────────────────────────
        if (spec.functionSignatures && spec.functionSignatures.length > 0) {
            parts.push('\n## INFERRED SIGNATURES (implement these)');
            for (const sig of spec.functionSignatures) {
                parts.push(`  ${sig.type} ${sig.name}${sig.params !== 'unknown' ? sig.params : '(...args)'}: ${sig.returnType}`);
            }
        }

        // ── RETURN TYPES ──────────────────────────────────────────────────
        if (spec.returnTypes && !spec.returnTypes.includes('unknown')) {
            parts.push(`\nExpected return types: ${spec.returnTypes.join(' | ')}`);
        }

        // ── ENTRY POINTS ──────────────────────────────────────────────────
        if (spec.entryPoints && spec.entryPoints.length > 0) {
            parts.push(`\nKnown entry points: ${spec.entryPoints.join(', ')}`);
        }

        // ── SCOPE KEYWORDS ────────────────────────────────────────────────
        if (spec.scopeKeywords && spec.scopeKeywords.length > 0) {
            parts.push(`\nKey identifiers from task: ${spec.scopeKeywords.join(', ')}`);
        }

        // ── KNOWN APIs ────────────────────────────────────────────────────
        const knownAPIs = guardRules.knownAPIs || {};
        const apiKeys = Object.keys(knownAPIs);
        if (apiKeys.length > 0) {
            parts.push('\n## AVAILABLE APIs (use ONLY these — no invented methods)');
            for (const [apiName, methods] of Object.entries(knownAPIs)) {
                if (methods.length > 0) {
                    parts.push(`  ${apiName}: ${methods.slice(0, 8).join(', ')}`);
                }
            }
        }

        // ── STRUCTURAL REQUIREMENTS ───────────────────────────────────────
        if (qualityRules.structuralRequirements && qualityRules.structuralRequirements.length > 0) {
            parts.push('\n## STRUCTURAL REQUIREMENTS');
            for (const req of qualityRules.structuralRequirements) {
                parts.push(`  - ${req}`);
            }
        }

        // ── PREVIOUS FAILURE CONTEXT ──────────────────────────────────────
        if (previousFailure) {
            parts.push('\n## PREVIOUS ATTEMPT FAILURE — FIX THESE ISSUES');
            parts.push(`Attempt ${attempt - 1} failed validation with:`);
            for (const violation of (previousFailure.violations || [])) {
                parts.push(`  [${violation.type || violation.rule}] ${violation.message}`);
            }
            if (previousFailure.syntaxErrors && previousFailure.syntaxErrors.length > 0) {
                parts.push('\nSyntax errors found:');
                for (const err of previousFailure.syntaxErrors) {
                    parts.push(`  ${err}`);
                }
            }
            parts.push('\nDo NOT repeat the previous mistakes. Address each violation above.');
        }

        // ── ANTI-HALLUCINATION MARKERS ────────────────────────────────────
        parts.push('\n## FINAL REMINDERS');
        for (const marker of (guardRules.promptMarkers || [])) {
            parts.push(`- ${marker}`);
        }

        // ── EXECUTION COMMAND ─────────────────────────────────────────────
        parts.push('\nBEGIN GENERATION NOW. Write the first file immediately.');

        return parts.join('\n');
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Format a prompt section with a header and bulleted items.
     * @private
     */
    static _section(title, lines) {
        const content = lines.map(line => {
            if (!line) return '';
            if (line.startsWith('  ') || line.startsWith('- ') || line === '') return line;
            return `- ${line}`;
        }).join('\n');
        return `### ${title}\n${content}`;
    }

    /**
     * Build workspace context lines from the enriched workspace scan.
     * @private
     */
    static _buildWorkspaceSection(workspaceContext) {
        const lines = [];

        if (workspaceContext.projectRoot) {
            lines.push(`Project root: ${workspaceContext.projectRoot}`);
        }

        // Language stats
        if (workspaceContext.languages && workspaceContext.languages.length > 0) {
            const top3 = workspaceContext.languages.slice(0, 3);
            lines.push(`Languages: ${top3.map(l => `${l.language} (${l.percentage}%)`).join(', ')}`);
        }

        // Framework detection
        if (workspaceContext.frameworks && workspaceContext.frameworks.length > 0) {
            const fwNames = workspaceContext.frameworks
                .filter(f => f.type !== 'quality')  // skip linter/formatter noise
                .map(f => f.name)
                .slice(0, 8);
            if (fwNames.length > 0) {
                lines.push(`Frameworks/runtimes: ${fwNames.join(', ')}`);
            }
        }

        // Package info
        if (workspaceContext.packageInfo) {
            const pkg = workspaceContext.packageInfo;
            if (pkg.name) lines.push(`Package name: ${pkg.name}`);
            if (pkg.type) lines.push(`Module type: ${pkg.type}`);
            if (pkg.scripts && pkg.scripts.length > 0) {
                lines.push(`Available scripts: ${pkg.scripts.slice(0, 6).join(', ')}`);
            }
        }

        // Directory structure
        if (workspaceContext.fileTree) {
            lines.push('');
            lines.push('File structure:');
            // Limit to first 30 lines to avoid bloat
            const treeLines = workspaceContext.fileTree.split('\n').slice(0, 30);
            for (const line of treeLines) {
                lines.push(`  ${line}`);
            }
        } else if (workspaceContext.files || workspaceContext.directories) {
            const dirs = (workspaceContext.directories || []).slice(0, 10).map(d => `[DIR] ${d}/`);
            const files = (workspaceContext.files || []).slice(0, 20).map(f => `[FILE] ${f}`);
            for (const d of dirs) lines.push(`  ${d}`);
            for (const f of files) lines.push(`  ${f}`);
        }

        return lines;
    }

    /**
     * Build verification section lines from VerificationAgent output.
     * @private
     */
    static _buildVerificationSection(verificationCriteria) {
        const lines = [];

        if (verificationCriteria.syntaxChecks && verificationCriteria.syntaxChecks.length > 0) {
            lines.push('Syntax checks that will be run:');
            for (const check of verificationCriteria.syntaxChecks) {
                lines.push(`  - ${check.description}`);
            }
        }

        if (verificationCriteria.requiredContent && verificationCriteria.requiredContent.length > 0) {
            const patternChecks = verificationCriteria.requiredContent
                .filter(c => c.type === 'pattern_present');
            if (patternChecks.length > 0) {
                lines.push('Required patterns in output:');
                for (const check of patternChecks) {
                    lines.push(`  - ${check.description}`);
                }
            }
        }

        if (verificationCriteria.forbiddenContent && verificationCriteria.forbiddenContent.length > 0) {
            lines.push('Forbidden content (will cause rejection):');
            for (const check of verificationCriteria.forbiddenContent) {
                lines.push(`  - ${check.description}`);
            }
        }

        return lines;
    }

    /**
     * Compute maxTokens based on task complexity and attempt number.
     * Higher attempts get more tokens since constraints are tighter.
     * @private
     */
    static _computeMaxTokens(spec, attempt) {
        const base = TOKEN_BUDGETS[spec.complexity] || TOKEN_BUDGETS.medium;
        // Each retry gets 25% more tokens to allow more verbose but correct output
        const attemptMultiplier = 1 + ((attempt - 1) * 0.25);
        return Math.round(base * attemptMultiplier);
    }

    /**
     * Compute temperature — lower for more deterministic output, even lower on retries.
     * @private
     */
    static _computeTemperature(spec, attempt) {
        // Pick the lowest temperature among all active domains
        let temp = 0.2;
        for (const domain of (spec.taskDomains || [])) {
            const domainTemp = TEMPERATURE_MAP[domain];
            if (domainTemp !== undefined && domainTemp < temp) {
                temp = domainTemp;
            }
        }
        // Each retry lowers temperature by 0.02, minimum 0.01
        const retryReduction = (attempt - 1) * 0.02;
        return Math.max(0.01, temp - retryReduction);
    }
}
