/**
 * Control Agents — Deterministic LLM Orchestration Layer
 *
 * These 5 agents run BEFORE any LLM call. They analyze the task and workspace
 * using pure rule-based, deterministic logic to produce structured data that
 * constrains and guides the LLM. No LLM calls, no side effects, no I/O.
 *
 * Pipeline:
 *   SpecificationAgent   → precise task requirements (signatures, files, types)
 *   ConstraintAgent      → what the LLM MUST NOT do
 *   HallucinationGuardAgent → anti-hallucination injection rules
 *   CodeQualityAgent     → naming, complexity, error handling rules
 *   VerificationAgent    → acceptance conditions for post-generation validation
 *
 * All agents implement: analyze(taskAnalysis, workspaceContext) → structured object
 */

// ─── Language / extension helpers ───────────────────────────────────────────

const EXT_TO_LANG = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
    '.py': 'python', '.pyw': 'python',
    '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php',
    '.java': 'java', '.kt': 'kotlin', '.swift': 'swift',
    '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c',
    '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.sql': 'sql', '.graphql': 'graphql',
    '.md': 'markdown', '.mdx': 'markdown',
    '.vue': 'vue', '.svelte': 'svelte',
};

/**
 * Infer primary language from workspace context.
 * @param {object} workspaceContext
 * @returns {string}
 */
function _inferLanguage(workspaceContext) {
    // RepoAnalyzer languages array (sorted by file count)
    if (workspaceContext.languages && workspaceContext.languages.length > 0) {
        return workspaceContext.languages[0].language.toLowerCase();
    }
    // Fall back to framework hints
    if (workspaceContext.frameworks) {
        const fnames = workspaceContext.frameworks.map(f => f.name.toLowerCase());
        if (fnames.some(f => f.includes('next') || f.includes('react'))) return 'javascript';
        if (fnames.some(f => f.includes('typescript'))) return 'typescript';
        if (fnames.some(f => f.includes('django') || f.includes('flask') || f.includes('fastapi'))) return 'python';
    }
    // Fall back to file list scan
    const files = workspaceContext.files || [];
    const exts = files.map(f => {
        const dot = f.lastIndexOf('.');
        return dot > -1 ? f.slice(dot) : '';
    });
    const extCounts = {};
    for (const e of exts) {
        if (EXT_TO_LANG[e]) extCounts[EXT_TO_LANG[e]] = (extCounts[EXT_TO_LANG[e]] || 0) + 1;
    }
    const sorted = Object.entries(extCounts).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? sorted[0][0] : 'unknown';
}

/**
 * Classify the intent of the task objective.
 * Returns a set of domain tags (Set<string>).
 * @param {string} objective
 * @returns {Set<string>}
 */
function _classifyDomains(objective) {
    const text = objective.toLowerCase();
    const domains = new Set();

    if (/(create|build|generate|write|implement|add|make)\s+(a\s+)?(file|class|function|module|component|service|route|endpoint|api|schema)/.test(text)) domains.add('code_generation');
    if (/(fix|debug|resolve|repair|patch|correct)\s+/.test(text)) domains.add('bug_fix');
    if (/(refactor|clean|reorganize|restructure|simplify|improve)\s+/.test(text)) domains.add('refactor');
    if (/(test|spec|jest|mocha|vitest|pytest|coverage)/.test(text)) domains.add('testing');
    if (/(document|readme|comment|jsdoc|docstring)/.test(text)) domains.add('documentation');
    if (/(deploy|ci|cd|docker|kubernetes|pipeline|infra)/.test(text)) domains.add('devops');
    if (/(auth|login|security|encrypt|password|token|jwt|rbac)/.test(text)) domains.add('security');
    if (/(database|schema|migration|model|sql|orm|prisma|sequelize)/.test(text)) domains.add('database');
    if (/(api|rest|graphql|endpoint|route|http)/.test(text)) domains.add('api');
    if (/\b(ui|ux|component|style|css|layout|page|form|button|html|frontend|webpage|website)\b/.test(text)) domains.add('frontend');
    if (/(server|backend|node|express|fastify|django)/.test(text)) domains.add('backend');
    if (/(install|dependency|package|npm|yarn|pip|cargo)/.test(text)) domains.add('dependency');

    if (domains.size === 0) domains.add('general');
    return domains;
}

/**
 * Detect likely output file types from objective and workspace.
 * @param {string} objective
 * @param {object} workspaceContext
 * @param {string} primaryLang
 * @returns {string[]} e.g. ['javascript', 'json', 'html']
 */
function _detectOutputTypes(objective, workspaceContext, primaryLang) {
    const types = new Set([primaryLang]);
    const text = objective.toLowerCase();

    if (/(html|page|website|frontend)/.test(text)) types.add('html');
    if (/(css|style|stylesheet)/.test(text)) types.add('css');
    if (/(json|config|package\.json)/.test(text)) types.add('json');
    if (/(test|spec)/.test(text)) types.add(primaryLang);
    if (/(sql|migration|schema)/.test(text)) types.add('sql');
    if (/(docker|dockerfile)/.test(text)) types.add('dockerfile');
    if (/(shell|script|bash)/.test(text)) types.add('shell');
    if (/(yaml|yml)/.test(text)) types.add('yaml');
    if (/(markdown|readme|docs)/.test(text)) types.add('markdown');

    return [...types].filter(t => t !== 'unknown');
}

// ─── SpecificationAgent ──────────────────────────────────────────────────────

/**
 * Converts a vague objective into a precise, structured specification.
 *
 * Produces:
 *   - taskType: the category of work
 *   - primaryLanguage: detected or inferred language
 *   - outputFiles: expected file names/patterns
 *   - functionSignatures: inferred signatures where deterministically possible
 *   - returnTypes: expected return types
 *   - errorHandling: required error handling patterns
 *   - entryPoints: expected entry points
 *   - scopeKeywords: key terms extracted from objective
 */
export class SpecificationAgent {
    /**
     * @param {object} taskAnalysis — from ClaudeExecutor._analyzeTask()
     * @param {object} workspaceContext — enriched workspace scan result
     * @returns {object} structured specification
     */
    analyze(taskAnalysis, workspaceContext) {
        const objective = taskAnalysis.objective || '';
        const primaryLang = _inferLanguage(workspaceContext);
        const domains = _classifyDomains(objective);
        const outputTypes = _detectOutputTypes(objective, workspaceContext, primaryLang);

        // Extract scope keywords (3+ char words that appear to be names/paths)
        const scopeKeywords = this._extractScopeKeywords(objective);

        // Infer likely output files from the objective
        const outputFiles = this._inferOutputFiles(objective, workspaceContext, primaryLang, domains);

        // Infer function signatures where possible
        const functionSignatures = this._inferSignatures(objective, primaryLang, domains);

        // Determine error-handling requirements
        const errorHandling = this._determineErrorHandling(primaryLang, domains, workspaceContext);

        // Identify entry points
        const entryPoints = this._identifyEntryPoints(workspaceContext, primaryLang);

        // Task complexity hint (used by regeneration loop for token budget)
        const complexity = this._estimateComplexity(objective, workspaceContext, domains);

        return {
            objective,
            primaryLanguage: primaryLang,
            taskDomains: [...domains],
            outputTypes,
            outputFiles,
            functionSignatures,
            returnTypes: this._inferReturnTypes(objective, primaryLang, domains),
            errorHandling,
            entryPoints,
            scopeKeywords,
            complexity,
            isModification: this._isModification(objective, workspaceContext),
        };
    }

    /** @private */
    _extractScopeKeywords(objective) {
        // Extract identifiers: camelCase, snake_case, file paths, extensions
        const identifiers = [];
        const words = objective.match(/\b[a-zA-Z_][a-zA-Z0-9_./-]*[a-zA-Z0-9]\b/g) || [];
        for (const w of words) {
            if (w.length >= 3 && !/^(the|and|for|from|with|that|this|have|will|should|must|into|more|some|each|only|also|then|when|where)$/i.test(w)) {
                identifiers.push(w);
            }
        }
        return [...new Set(identifiers)].slice(0, 20);
    }

    /** @private */
    _inferOutputFiles(objective, workspaceContext, primaryLang, domains) {
        const files = [];
        const text = objective.toLowerCase();

        // Explicit file references in the objective
        const explicitPaths = objective.match(/[\w./-]+\.(?:js|ts|jsx|tsx|py|go|rs|html|css|json|yaml|yml|sh|sql|md|vue|svelte)\b/gi) || [];
        for (const p of explicitPaths) {
            files.push({ path: p, role: 'explicit', confidence: 'high' });
        }

        // Infer based on domains
        if (domains.has('api') && primaryLang === 'javascript') {
            if (!files.some(f => /route|api|handler/.test(f.path))) {
                files.push({ path: 'src/routes/api.js', role: 'inferred_api', confidence: 'medium' });
            }
        }
        if (domains.has('testing')) {
            const ext = primaryLang === 'python' ? '.py' : '.js';
            files.push({ path: `tests/test_generated${ext}`, role: 'test', confidence: 'medium' });
        }
        if (domains.has('frontend') && !files.some(f => /\.html/.test(f.path))) {
            if (/website|webpage|page/.test(text)) {
                files.push({ path: 'index.html', role: 'inferred_html', confidence: 'medium' });
            }
        }

        // Check if objective targets an existing file
        const existingFiles = workspaceContext.files || [];
        for (const existing of existingFiles) {
            const existingLower = existing.toLowerCase();
            if (objective.toLowerCase().includes(existingLower.replace('.', ''))) {
                files.push({ path: existing, role: 'modification_target', confidence: 'high' });
            }
        }

        return files;
    }

    /** @private */
    _inferSignatures(objective, primaryLang, domains) {
        const sigs = [];
        const text = objective.toLowerCase();

        // Look for explicit function/class mentions
        const funcMentions = objective.match(/(?:function|method|class|component|hook|util|helper|service)\s+(\w+)/gi) || [];
        for (const mention of funcMentions) {
            const parts = mention.split(/\s+/);
            const name = parts[1];
            if (name && name.length > 2) {
                sigs.push({
                    type: parts[0].toLowerCase(),
                    name,
                    params: 'unknown',
                    returnType: 'unknown',
                    confidence: 'medium',
                });
            }
        }

        // Infer from domain patterns
        if (domains.has('api') && sigs.length === 0) {
            sigs.push({ type: 'function', name: 'handler', params: '(req, res)', returnType: 'void', confidence: 'low' });
        }
        if (domains.has('testing') && sigs.length === 0) {
            sigs.push({ type: 'function', name: 'describe/it', params: '(string, fn)', returnType: 'void', confidence: 'low' });
        }

        return sigs;
    }

    /** @private */
    _inferReturnTypes(objective, primaryLang, domains) {
        const text = objective.toLowerCase();
        const types = [];

        if (/returns?\s+(\w+)/i.test(objective)) {
            const m = objective.match(/returns?\s+(\w+)/i);
            if (m) types.push(m[1]);
        }
        if (domains.has('api')) types.push('Response | Error');
        if (domains.has('testing')) types.push('void');
        if (/boolean|bool|true|false/.test(text)) types.push('boolean');
        if (/number|count|sum|total/.test(text)) types.push('number');
        if (/string|text|message/.test(text)) types.push('string');
        if (/array|list|collection/.test(text)) types.push('array');
        if (/object|record|map/.test(text)) types.push('object');

        return types.length > 0 ? types : ['unknown'];
    }

    /** @private */
    _determineErrorHandling(primaryLang, domains, workspaceContext) {
        const patterns = [];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            patterns.push('try/catch blocks around async operations');
            patterns.push('explicit error messages — no silent failures');
            if (domains.has('api')) {
                patterns.push('HTTP status codes in responses (4xx/5xx)');
                patterns.push('error response body: { error: string, code?: string }');
            }
        } else if (primaryLang === 'python') {
            patterns.push('try/except with specific exception types');
            patterns.push('raise with descriptive error messages');
        } else if (primaryLang === 'go') {
            patterns.push('explicit error returns — no panic in library code');
            patterns.push('if err != nil patterns');
        }

        // Framework-specific patterns
        const frameworks = (workspaceContext.frameworks || []).map(f => f.name.toLowerCase());
        if (frameworks.some(f => f.includes('express') || f.includes('fastify'))) {
            patterns.push('next(err) for Express middleware error propagation');
        }
        if (frameworks.some(f => f.includes('react') || f.includes('next'))) {
            patterns.push('Error boundary components for UI error handling');
        }

        return patterns;
    }

    /** @private */
    _identifyEntryPoints(workspaceContext, primaryLang) {
        const files = workspaceContext.files || [];
        const entryPoints = [];

        const commonEntries = ['index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.ts',
            'server.js', 'server.ts', 'index.html', 'main.py', 'app.py', 'main.go'];

        for (const entry of commonEntries) {
            if (files.includes(entry)) {
                entryPoints.push(entry);
            }
        }

        // Check package.json main/module
        if (workspaceContext.packageInfo?.name) {
            entryPoints.push('(from package.json)');
        }

        return entryPoints;
    }

    /** @private */
    _estimateComplexity(objective, workspaceContext, domains) {
        let score = 0;
        const wordCount = objective.split(/\s+/).length;

        if (wordCount > 30) score += 2;
        else if (wordCount > 15) score += 1;

        score += Math.min(domains.size, 4);

        const fileCount = (workspaceContext.files || []).length + (workspaceContext.directories || []).length;
        if (fileCount > 20) score += 2;
        else if (fileCount > 5) score += 1;

        if (score <= 2) return 'low';
        if (score <= 5) return 'medium';
        return 'high';
    }

    /** @private */
    _isModification(objective, workspaceContext) {
        const text = objective.toLowerCase();
        const isEdit = /(edit|update|modify|change|fix|refactor|improve|extend|add to|enhance)\s/.test(text);
        const hasExistingFiles = (workspaceContext.files || []).length > 0;
        return isEdit && hasExistingFiles;
    }
}

// ─── ConstraintAgent ─────────────────────────────────────────────────────────

/**
 * Defines hard constraints on what the LLM MUST NOT do.
 *
 * Produces:
 *   - forbiddenPatterns: regex-testable strings the output must not contain
 *   - allowedFileOperations: which file ops are permitted
 *   - forbiddenImports: packages/modules that do not exist in this project
 *   - scopeLimits: the LLM must stay within these files/directories
 *   - formatConstraints: structural constraints on output format
 *   - hardLimits: absolute rules that cause immediate rejection if violated
 */
export class ConstraintAgent {
    /**
     * @param {object} taskAnalysis
     * @param {object} workspaceContext
     * @returns {object} constraint set
     */
    analyze(taskAnalysis, workspaceContext) {
        const objective = taskAnalysis.objective || '';
        const domains = new Set(taskAnalysis.domains || []);
        const primaryLang = workspaceContext.primaryLanguage
            || _inferLanguage(workspaceContext);

        // Determine which packages are actually available
        const availablePackages = this._extractAvailablePackages(workspaceContext);
        const availableFiles = new Set(workspaceContext.files || []);
        const availableDirs = new Set(workspaceContext.directories || []);

        // Derive allowed file scope
        const allowedFileScope = this._deriveFileScope(objective, workspaceContext);

        return {
            // Structural output constraints
            hardLimits: [
                'Do NOT include explanatory prose outside of code comments',
                'Do NOT wrap code in markdown fences unless explicitly outputting markdown documentation',
                'Do NOT use placeholder text such as "// TODO", "...", "[INSERT HERE]", "rest of code"',
                'Do NOT invent or hallucinate API methods, library functions, or class names',
                'Do NOT reference files that do not exist in the workspace unless creating them',
                'Do NOT produce partial or truncated code — all functions must be complete',
                'Do NOT add unrequested features or files outside the task scope',
            ],

            // Import restrictions — only these package namespaces are real
            allowedImports: availablePackages,
            forbiddenImportPatterns: this._buildForbiddenImportPatterns(primaryLang, availablePackages),

            // File scope
            allowedFileScope,
            forbiddenFilePaths: this._buildForbiddenFilePaths(),

            // Format: no bare markdown, specific output structure expected
            formatConstraints: this._buildFormatConstraints(primaryLang),

            // Code behavior constraints
            behaviorConstraints: this._buildBehaviorConstraints(primaryLang, domains),

            // Security constraints always applied
            securityConstraints: [
                'Never output actual secrets, passwords, API keys, or tokens',
                'Never produce code that reads/writes outside the project directory',
                'Never include eval() or dynamic code execution unless explicitly in scope',
                'Never reference ../  path traversal patterns',
            ],

            // Zero-dependency constraint (for APES itself when working on itself)
            zeroDepMode: this._detectZeroDepMode(workspaceContext),
        };
    }

    /** @private */
    _extractAvailablePackages(workspaceContext) {
        const packages = new Set(['node:fs', 'node:path', 'node:crypto', 'node:os',
            'node:child_process', 'node:http', 'node:https', 'node:url',
            'node:util', 'node:events', 'node:stream', 'node:buffer',
            'node:net', 'node:dns', 'node:readline', 'node:worker_threads']);

        // Add packages from package.json if available
        if (workspaceContext.packageInfo) {
            const info = workspaceContext.packageInfo;
            for (const dep of (info.dependencyNames || [])) {
                packages.add(dep);
            }
        }

        // Add from parsed frameworks
        for (const framework of (workspaceContext.frameworks || [])) {
            const n = framework.name.toLowerCase();
            if (n.includes('react')) { packages.add('react'); packages.add('react-dom'); }
            if (n.includes('next')) packages.add('next');
            if (n.includes('express')) packages.add('express');
            if (n.includes('vue')) packages.add('vue');
            if (n.includes('prisma')) { packages.add('@prisma/client'); packages.add('prisma'); }
            if (n.includes('mongoose')) packages.add('mongoose');
            if (n.includes('jest')) packages.add('jest');
            if (n.includes('vitest')) packages.add('vitest');
            if (n.includes('vite')) packages.add('vite');
            if (n.includes('webpack')) packages.add('webpack');
            if (n.includes('tailwind')) packages.add('tailwindcss');
        }

        return [...packages];
    }

    /** @private */
    _buildForbiddenImportPatterns(primaryLang, allowedPackages) {
        // Patterns that indicate hallucinated imports
        const patterns = [
            // Generic hallucination patterns
            /from ['"]@fictional\//,
            /from ['"]invented-/,
            /require\(['"]nonexistent/,
        ];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            patterns.push(
                // Common hallucinated packages
                /from ['"]node-fetch['"]/,       // use native fetch in Node 18+
                /from ['"]lodash['"]/,            // only if not in package.json
                /from ['"]axios['"]/,             // only if not in package.json
                /from ['"]moment['"]/,            // deprecated and not commonly available
            );
        }

        return patterns;
    }

    /** @private */
    _deriveFileScope(objective, workspaceContext) {
        const scope = [];
        const text = objective.toLowerCase();

        // If objective mentions specific files, restrict scope to those
        const explicitFiles = objective.match(/[\w./-]+\.(?:js|ts|jsx|tsx|py|go|rs|html|css|json|yaml|yml|sh|sql|md)\b/gi) || [];
        scope.push(...explicitFiles);

        // Add parent directories of explicit files
        for (const file of explicitFiles) {
            const parts = file.split('/');
            if (parts.length > 1) {
                scope.push(parts.slice(0, -1).join('/') + '/');
            }
        }

        // Restrict to src/ if present
        if ((workspaceContext.directories || []).includes('src')) {
            if (/src\/|source\//.test(text) || scope.length === 0) {
                scope.push('src/');
            }
        }

        // If no scope constraints found, allow entire workspace (open scope)
        return scope.length > 0 ? scope : ['*'];
    }

    /** @private */
    _buildForbiddenFilePaths() {
        return [
            '.env', '.env.local', '.env.production', '.env.development',
            '.git/', 'node_modules/', '.ssh/', '~/', '/etc/', '/root/',
            'credentials.json', 'secrets.json', '*.pem', '*.key',
        ];
    }

    /** @private */
    _buildFormatConstraints(primaryLang) {
        const constraints = [
            'Output ONLY the requested code files',
            'Each file must be clearly delimited with its path',
            'Do not add commentary between files',
        ];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            constraints.push('Use consistent quote style (single quotes preferred for JS)');
            constraints.push('Use 4-space indentation unless project uses 2-space');
        } else if (primaryLang === 'python') {
            constraints.push('Use 4-space indentation (PEP 8)');
            constraints.push('Type hints required on all function signatures');
        }

        return constraints;
    }

    /** @private */
    _buildBehaviorConstraints(primaryLang, domains) {
        const constraints = [];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            constraints.push('All async functions must use async/await, not raw .then() chains');
            constraints.push('No var declarations — use const and let only');
        }

        if (domains.has('api')) {
            constraints.push('API routes must validate inputs before processing');
            constraints.push('Return consistent error response shapes');
        }

        if (domains.has('database')) {
            constraints.push('All database queries must handle connection errors');
            constraints.push('Never construct SQL strings via concatenation — use parameterized queries');
        }

        if (domains.has('security')) {
            constraints.push('Never store passwords in plaintext');
            constraints.push('Always validate and sanitize user inputs');
        }

        return constraints;
    }

    /** @private */
    _detectZeroDepMode(workspaceContext) {
        // Detect if the project itself is zero-dependency (like APES)
        const pkg = workspaceContext.packageInfo;
        if (!pkg) return false;
        const hasNoDeps = pkg.dependencies === 0 || pkg.dependencyNames?.length === 0;
        return hasNoDeps;
    }
}

// ─── HallucinationGuardAgent ─────────────────────────────────────────────────

/**
 * Injects anti-hallucination rules into the controlled prompt.
 *
 * Produces:
 *   - groundingInstructions: text injected into system prompt
 *   - uncertaintyProtocols: what to do when information is missing
 *   - verificationTriggers: patterns that indicate hallucination risk
 *   - confidenceRequirements: thresholds for different output types
 */
export class HallucinationGuardAgent {
    /**
     * @param {object} taskAnalysis
     * @param {object} workspaceContext
     * @returns {object} hallucination guard configuration
     */
    analyze(taskAnalysis, workspaceContext) {
        const objective = taskAnalysis.objective || '';
        const domains = _classifyDomains(objective);
        const primaryLang = _inferLanguage(workspaceContext);
        const knownAPIs = this._buildKnownAPIMap(workspaceContext);

        return {
            // Rules injected verbatim into system prompt
            groundingInstructions: this._buildGroundingInstructions(primaryLang, domains),

            // What the LLM MUST do when it is uncertain
            uncertaintyProtocols: [
                'If a function signature, class name, or API method is unclear, use the most widely-accepted, standard pattern — do NOT invent a name',
                'If a file path is uncertain, place the file in the project root and note it with a comment',
                'If framework version is unknown, write code compatible with the most common stable version',
                'If a config value is unknown, use a sensible default and mark it with: // CONFIG: describe what this should be',
                'Never generate plausible-sounding but incorrect function names — if unknown, use a generic name',
            ],

            // Known-good API surface to ground the LLM's output
            knownAPIs,

            // Patterns that indicate high hallucination risk in output
            verificationTriggers: this._buildVerificationTriggers(primaryLang),

            // Confidence thresholds
            confidenceRequirements: {
                imports: 'Only import packages known to exist in this project',
                functionCalls: 'Only call functions that are defined in this output or are standard language builtins',
                fileReferences: 'Only reference files that exist in the workspace or are being created in this output',
                configKeys: 'Only reference env vars or config keys that follow the project\'s naming conventions',
            },

            // Anti-hallucination markers to inject at the bottom of user prompts
            promptMarkers: [
                'IMPORTANT: If you are uncertain about any API, method name, or file path — use the most conservative standard approach.',
                'IMPORTANT: Do NOT use any external package or module not listed in the constraints.',
                'IMPORTANT: All function and method names must be real. No invented APIs.',
            ],
        };
    }

    /** @private */
    _buildGroundingInstructions(primaryLang, domains) {
        const instructions = [
            'You are a deterministic code generator. Your output is code, not explanations.',
            'Ground every decision in what is visible in the workspace context provided.',
            'Do not assume the presence of packages, modules, or utilities not listed.',
        ];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            instructions.push('Use only standard Node.js built-ins (node:fs, node:path, etc.) unless package.json dependencies explicitly list something else.');
            instructions.push('For async operations, use the standard Promise-based Node.js APIs unless otherwise specified.');
        } else if (primaryLang === 'python') {
            instructions.push('Use only the Python standard library unless requirements.txt lists additional packages.');
        } else if (primaryLang === 'go') {
            instructions.push('Use only the Go standard library unless go.mod lists additional modules.');
        }

        if (domains.has('api')) {
            instructions.push('Do not reference API endpoints, middleware, or authentication systems not described in the task.');
        }
        if (domains.has('database')) {
            instructions.push('Do not invent database column names or table structures not mentioned in the task.');
        }

        return instructions;
    }

    /** @private */
    _buildKnownAPIMap(workspaceContext) {
        const apis = {};
        const frameworks = (workspaceContext.frameworks || []).map(f => f.name.toLowerCase());

        if (frameworks.some(f => f.includes('express'))) {
            apis.express = ['app.get', 'app.post', 'app.put', 'app.delete', 'app.use',
                'router.get', 'router.post', 'req.body', 'req.params', 'req.query',
                'res.json', 'res.send', 'res.status', 'next'];
        }
        if (frameworks.some(f => f.includes('react'))) {
            apis.react = ['useState', 'useEffect', 'useContext', 'useRef', 'useMemo',
                'useCallback', 'useReducer', 'useLayoutEffect', 'forwardRef',
                'createContext', 'memo', 'Fragment', 'StrictMode'];
        }
        if (frameworks.some(f => f.includes('next'))) {
            apis.nextjs = ['getServerSideProps', 'getStaticProps', 'getStaticPaths',
                'useRouter', 'Link', 'Image', 'Head', 'NextApiRequest', 'NextApiResponse'];
        }
        if (frameworks.some(f => f.includes('prisma'))) {
            apis.prisma = ['prisma.create', 'prisma.findUnique', 'prisma.findMany',
                'prisma.update', 'prisma.delete', 'prisma.upsert', 'prisma.$connect', 'prisma.$disconnect'];
        }

        // Always include Node.js core APIs
        apis.nodeFs = ['readFileSync', 'writeFileSync', 'existsSync', 'mkdirSync',
            'readdirSync', 'statSync', 'unlinkSync', 'renameSync',
            'readFile', 'writeFile', 'mkdir', 'readdir', 'stat'];
        apis.nodePath = ['join', 'resolve', 'dirname', 'basename', 'extname', 'relative', 'isAbsolute'];
        apis.nodeCrypto = ['createHash', 'randomBytes', 'createHmac', 'pbkdf2Sync', 'scryptSync'];
        apis.nodeChildProcess = ['execSync', 'spawnSync', 'exec', 'spawn', 'execFile'];

        return apis;
    }

    /** @private */
    _buildVerificationTriggers(primaryLang) {
        // Regex patterns — if output matches these, it's suspicious and warrants validation
        const triggers = [
            // Common hallucination: importing from packages that don't exist
            /from ['"][^'"]+Magic['"]/i,
            /from ['"][^'"]+Helper['"]/i,
            /import\s+\{\s*[a-z]+\s*\}\s+from\s+['"][^'"]{20,}['"]/,  // very long package paths are suspicious
            // Invented methods
            /\.\w+Magic\(/,
            /\.\w+Auto\(/,
            /\.autoGenerate\(/,
            /\.smartProcess\(/,
        ];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            triggers.push(
                /require\(['"][^)]+['"]\)\.default\.default/,  // double .default is always wrong
                /import\s+\*\s+as\s+\w+\s+from\s+['"]node:/,  // namespace import of node builtins is unusual
            );
        }

        return triggers;
    }
}

// ─── CodeQualityAgent ────────────────────────────────────────────────────────

/**
 * Defines code quality standards to be enforced in generated output.
 *
 * Produces:
 *   - namingConventions: required naming patterns
 *   - complexityLimits: max function/file sizes
 *   - requiredPatterns: patterns that MUST appear in the output
 *   - forbiddenPatterns: anti-patterns that must never appear
 *   - structuralRequirements: file/module structure rules
 */
export class CodeQualityAgent {
    /**
     * @param {object} taskAnalysis
     * @param {object} workspaceContext
     * @returns {object} quality rule set
     */
    analyze(taskAnalysis, workspaceContext) {
        const objective = taskAnalysis.objective || '';
        const primaryLang = _inferLanguage(workspaceContext);
        const domains = _classifyDomains(objective);
        const frameworks = (workspaceContext.frameworks || []).map(f => f.name.toLowerCase());
        const isESM = this._detectESM(workspaceContext);
        const isTypeScript = primaryLang === 'typescript'
            || frameworks.some(f => f.includes('typescript'));

        return {
            namingConventions: this._buildNamingConventions(primaryLang, frameworks),
            complexityLimits: {
                maxFunctionLines: 60,
                maxFileLines: 500,
                maxParameters: 5,
                maxNestingDepth: 4,
                maxCyclomaticComplexity: 10,
            },
            requiredPatterns: this._buildRequiredPatterns(primaryLang, domains, isESM, isTypeScript),
            forbiddenPatterns: this._buildForbiddenPatterns(primaryLang, isESM),
            structuralRequirements: this._buildStructuralRequirements(primaryLang, domains, frameworks),
            moduleStyle: isESM ? 'esm' : 'commonjs',
            strictMode: isTypeScript,
            commentRequirements: {
                publicFunctions: 'JSDoc/docstring comment required on exported/public functions',
                complexLogic: 'Inline comment required for non-obvious logic blocks',
                fileHeader: 'Brief file-level comment describing purpose',
            },
        };
    }

    /** @private */
    _detectESM(workspaceContext) {
        const pkg = workspaceContext.packageInfo;
        return pkg?.type === 'module';
    }

    /** @private */
    _buildNamingConventions(primaryLang, frameworks) {
        if (['javascript', 'typescript'].includes(primaryLang)) {
            const isReact = frameworks.some(f => f.includes('react') || f.includes('next') || f.includes('vue'));
            return {
                variables: 'camelCase',
                functions: 'camelCase',
                classes: 'PascalCase',
                constants: 'UPPER_SNAKE_CASE for module-level, camelCase for local',
                files: isReact ? 'PascalCase for components, camelCase for utilities' : 'camelCase or kebab-case',
                typeInterfaces: 'PascalCase (TS)',
            };
        }
        if (primaryLang === 'python') {
            return {
                variables: 'snake_case',
                functions: 'snake_case',
                classes: 'PascalCase',
                constants: 'UPPER_SNAKE_CASE',
                files: 'snake_case',
            };
        }
        if (primaryLang === 'go') {
            return {
                variables: 'camelCase',
                functions: 'camelCase (unexported) or PascalCase (exported)',
                types: 'PascalCase',
                constants: 'PascalCase or camelCase',
                files: 'snake_case',
            };
        }
        return { style: 'follow language conventions' };
    }

    /** @private */
    _buildRequiredPatterns(primaryLang, domains, isESM, isTypeScript) {
        const patterns = [];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            if (isESM) {
                patterns.push('Use "import" / "export" (ES module syntax)');
                patterns.push('File extensions required in relative imports: ./module.js not ./module');
            } else {
                patterns.push('Use require() / module.exports (CommonJS syntax)');
            }
            patterns.push('Arrow functions for callbacks, function declarations for named top-level functions');
        }

        if (isTypeScript) {
            patterns.push('All function parameters must have explicit type annotations');
            patterns.push('Return types required on public functions');
            patterns.push('Interfaces preferred over type aliases for object shapes');
        }

        if (domains.has('api')) {
            patterns.push('Input validation at the start of every route handler');
            patterns.push('Consistent error response shape: { error: string, code?: string }');
        }

        if (domains.has('testing')) {
            patterns.push('Describe blocks group related tests');
            patterns.push('Test names describe expected behavior: "should return X when Y"');
            patterns.push('Setup and teardown in beforeEach/afterEach where state is needed');
        }

        return patterns;
    }

    /** @private */
    _buildForbiddenPatterns(primaryLang, isESM) {
        const forbidden = [
            'No magic numbers — use named constants',
            'No commented-out code blocks',
            'No console.log in production code (use a logger utility)',
            'No deeply nested callbacks (>3 levels)',
            'No empty catch blocks without at minimum a comment explaining why',
        ];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            if (isESM) {
                forbidden.push('No require() calls — this is an ESM project');
                forbidden.push('No module.exports — use named/default exports');
            } else {
                forbidden.push('No import/export syntax — this is a CommonJS project');
            }
            forbidden.push('No var declarations — use const or let');
            forbidden.push('No == comparisons — use === always');
        }

        if (primaryLang === 'python') {
            forbidden.push('No mutable default arguments (def foo(x=[])');
            forbidden.push('No bare except: — always specify exception type');
            forbidden.push('No from module import * — use explicit imports');
        }

        return forbidden;
    }

    /** @private */
    _buildStructuralRequirements(primaryLang, domains, frameworks) {
        const reqs = ['One primary responsibility per file (single-responsibility principle)'];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            reqs.push('Exports at the bottom of the file or using named exports inline');
        }

        if (domains.has('api')) {
            const hasExpress = frameworks.some(f => f.includes('express') || f.includes('fastify'));
            if (hasExpress) {
                reqs.push('Route handlers must be thin — business logic extracted to service/utility functions');
            }
        }

        if (domains.has('frontend')) {
            const isReact = frameworks.some(f => f.includes('react') || f.includes('next'));
            if (isReact) {
                reqs.push('Component files export exactly one default component');
                reqs.push('Hooks must start with "use" prefix');
                reqs.push('Props must be destructured in function signature');
            }
        }

        return reqs;
    }
}

// ─── VerificationAgent ───────────────────────────────────────────────────────

/**
 * Defines the acceptance criteria and validation logic for generated output.
 *
 * Produces:
 *   - syntaxChecks: which syntax validators to run
 *   - contentChecks: what the output must contain
 *   - structuralChecks: file/export structure requirements
 *   - forbiddenContentChecks: what must NOT be in the output
 *   - completenessThreshold: minimum content size expectations
 *   - testConditions: what the output should be able to do if executed
 */
export class VerificationAgent {
    /**
     * @param {object} taskAnalysis
     * @param {object} workspaceContext
     * @returns {object} verification criteria
     */
    analyze(taskAnalysis, workspaceContext) {
        const objective = taskAnalysis.objective || '';
        const primaryLang = _inferLanguage(workspaceContext);
        const domains = _classifyDomains(objective);
        const isESM = workspaceContext.packageInfo?.type === 'module';

        return {
            // Syntax validation methods to apply
            syntaxChecks: this._buildSyntaxChecks(primaryLang),

            // Content that MUST be present
            requiredContent: this._buildRequiredContent(objective, primaryLang, domains),

            // Structural checks
            structuralChecks: this._buildStructuralChecks(primaryLang, isESM, domains),

            // Content that must NOT be present
            forbiddenContent: this._buildForbiddenContent(primaryLang, isESM),

            // Minimum size thresholds (in characters) per file type
            completenessThresholds: {
                default: 50,
                javascript: 80,
                typescript: 100,
                python: 60,
                html: 150,
                css: 40,
                json: 10,
            },

            // Semantic checks
            semanticChecks: this._buildSemanticChecks(objective, domains),

            // Import validity checks
            importChecks: {
                checkRelativeImportsExist: true,
                checkNodeBuiltinsUsedCorrectly: ['javascript', 'typescript'].includes(primaryLang),
                checkNoInventedPackages: true,
            },

            // Pass/fail scoring weights
            weights: {
                syntax: 0.4,        // syntax errors are hard failures
                forbiddenContent: 0.3,  // placeholder / truncated code
                requiredContent: 0.2,   // expected identifiers present
                structural: 0.1,        // structural conventions
            },
        };
    }

    /** @private */
    _buildSyntaxChecks(primaryLang) {
        const checks = [];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            checks.push({ type: 'bracket_balance', description: 'All { } ( ) [ ] must be balanced' });
            checks.push({ type: 'string_termination', description: 'All string literals must be terminated' });
            checks.push({ type: 'arrow_function_validity', description: 'Arrow functions must have valid syntax' });
            checks.push({ type: 'template_literal_balance', description: 'Template literals `` must be balanced' });
            checks.push({ type: 'import_statement_validity', description: 'Import statements must be syntactically valid' });
        }
        if (primaryLang === 'json') {
            checks.push({ type: 'json_parseable', description: 'Output must be valid JSON' });
        }
        if (primaryLang === 'html') {
            checks.push({ type: 'tag_balance', description: 'HTML tags must be properly opened and closed' });
            checks.push({ type: 'doctype_present', description: 'HTML files should start with <!DOCTYPE html>' });
        }
        if (primaryLang === 'css') {
            checks.push({ type: 'bracket_balance', description: 'CSS rule braces must be balanced' });
        }
        if (primaryLang === 'python') {
            checks.push({ type: 'indentation_consistency', description: 'Indentation must be consistent' });
            checks.push({ type: 'colon_after_blocks', description: 'def/class/if/for/while must end with :' });
        }

        return checks;
    }

    /** @private */
    _buildRequiredContent(objective, primaryLang, domains) {
        const required = [];

        // Extract explicit identifiers from the objective that should appear in output
        const identifiers = objective.match(/\b[A-Z][a-zA-Z]+\b|\b[a-z]+[A-Z][a-zA-Z]+\b/g) || [];
        for (const id of identifiers.slice(0, 5)) {
            required.push({ type: 'identifier_present', value: id, confidence: 'medium' });
        }

        // Domain-specific required elements
        if (domains.has('api')) {
            required.push({ type: 'pattern_present', pattern: /router|app\.(get|post|put|delete|patch)/, description: 'Route definition' });
        }
        if (domains.has('testing')) {
            required.push({ type: 'pattern_present', pattern: /describe|it\(|test\(|def test_/, description: 'Test function' });
            required.push({ type: 'pattern_present', pattern: /expect|assert/, description: 'Assertion' });
        }
        if (domains.has('frontend') && primaryLang === 'javascript') {
            required.push({ type: 'pattern_present', pattern: /return\s*[(<]/, description: 'Return statement with JSX or element' });
        }
        if (primaryLang === 'html') {
            required.push({ type: 'pattern_present', pattern: /<!DOCTYPE\s+html>/i, description: 'DOCTYPE declaration' });
            required.push({ type: 'pattern_present', pattern: /<html/, description: 'HTML root element' });
            required.push({ type: 'pattern_present', pattern: /<body/, description: 'Body element' });
        }

        return required;
    }

    /** @private */
    _buildStructuralChecks(primaryLang, isESM, domains) {
        const checks = [];

        if (['javascript', 'typescript'].includes(primaryLang)) {
            if (isESM) {
                checks.push({ type: 'has_export', description: 'ESM files should export at least one symbol' });
                checks.push({ type: 'no_require', description: 'ESM files must not use require()' });
            }
        }

        if (domains.has('testing')) {
            checks.push({ type: 'has_test_structure', description: 'Test file must have at least one test case' });
        }

        return checks;
    }

    /** @private */
    _buildForbiddenContent(primaryLang, isESM) {
        const forbidden = [
            { type: 'placeholder_text', patterns: [/\.\.\.\s*(\/\/.*)?$/, /TODO.*implement/i, /\[INSERT.*HERE\]/i, /placeholder/i, /your.*code.*here/i], description: 'Placeholder or incomplete code' },
            { type: 'truncated_output', patterns: [/\/\/ rest of (?:the )?(?:code|file|function)/i, /\/\/ more code here/i, /# rest of/i, /# \.\.\.more/i], description: 'Truncated implementation' },
            { type: 'mixed_module_style', patterns: isESM ? [/\brequire\s*\(/] : [/\bimport\s+.*\bfrom\b/], description: isESM ? 'require() in ESM module' : 'import syntax in CommonJS module' },
        ];

        return forbidden;
    }

    /** @private */
    _buildSemanticChecks(objective, domains) {
        const checks = [];
        const text = objective.toLowerCase();

        // Check that the output's apparent purpose matches the objective
        if (domains.has('api')) {
            checks.push({ type: 'api_endpoint_present', description: 'Output must define at least one API endpoint' });
        }
        if (domains.has('testing')) {
            checks.push({ type: 'test_count_min', value: 1, description: 'At least one test case must be present' });
        }
        if (/create.*class/.test(text) || /class.*create/.test(text)) {
            checks.push({ type: 'class_definition_present', description: 'A class definition must be present' });
        }
        if (/create.*function/.test(text) || /function.*create/.test(text)) {
            checks.push({ type: 'function_definition_present', description: 'A function definition must be present' });
        }

        return checks;
    }
}
