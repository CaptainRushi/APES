/**
 * OutputValidator — Post-Generation Static Code Validator
 *
 * Runs AFTER the LLM generates code, BEFORE it is accepted as output.
 *
 * Validation pipeline (in order):
 *   1. Basic content checks      — non-empty, not truncated
 *   2. Forbidden content checks  — placeholder text, truncation markers
 *   3. Syntax validation         — bracket balance, string termination, JSON parse
 *   4. Import validation         — no invented/unavailable packages
 *   5. Constraint compliance     — checks against ConstraintAgent rules
 *   6. Structural checks         — ESM vs CJS, exports, test structure
 *   7. Semantic checks           — required patterns, identifiers
 *
 * Returns a ValidationResult:
 *   { passed: boolean, score: number, violations: object[], syntaxErrors: string[], warnings: string[] }
 *
 * Zero dependencies — Node.js builtins only.
 */

// ─── Placeholder / truncation patterns ──────────────────────────────────────

const PLACEHOLDER_PATTERNS = [
    { re: /\.\.\.\s*(?:\/\/.*)?$/m,           label: 'Trailing ellipsis (truncated code)' },
    { re: /\/\/\s*\.\.\.(?:\s*more)?/i,       label: '// ... continuation placeholder' },
    { re: /\/\/\s*rest of (?:the )?(?:code|file|function|implementation)/i, label: 'Truncation comment' },
    { re: /\/\/\s*more code here/i,            label: 'Explicit placeholder comment' },
    { re: /\/\/\s*(?:TODO|FIXME|IMPLEMENT):\s*implement/i, label: 'TODO: implement placeholder' },
    { re: /\[INSERT.*?HERE\]/i,                label: '[INSERT HERE] placeholder' },
    { re: /\[YOUR.*?HERE\]/i,                  label: '[YOUR CODE HERE] placeholder' },
    { re: /Lorem ipsum/i,                      label: 'Lorem ipsum placeholder text' },
    { re: /#\s*rest of/i,                      label: '# rest of ... placeholder (Python)' },
    { re: /#\s*\.\.\.\s*more/i,               label: '# ...more placeholder (Python)' },
    { re: /\/\*\s*\.\.\.\s*\*\//,             label: '/* ... */ block truncation placeholder' },
    { re: /pass\s*#\s*TODO/i,                  label: 'pass # TODO placeholder (Python)' },
    { re: /throw new Error\(['"]Not implemented['"]\)/i, label: 'Not implemented stub' },
    { re: /raise NotImplementedError/i,        label: 'raise NotImplementedError stub' },
];

// ─── Common inventable packages (hallucination-prone) ───────────────────────

const KNOWN_REAL_PACKAGES = new Set([
    // Node built-ins (both styles)
    'fs', 'path', 'crypto', 'os', 'child_process', 'http', 'https', 'url',
    'util', 'events', 'stream', 'buffer', 'net', 'dns', 'readline', 'worker_threads',
    'node:fs', 'node:path', 'node:crypto', 'node:os', 'node:child_process',
    'node:http', 'node:https', 'node:url', 'node:util', 'node:events',
    'node:stream', 'node:buffer', 'node:net', 'node:dns', 'node:readline',
    'node:worker_threads', 'node:assert', 'node:test', 'node:timers',
    'node:perf_hooks', 'node:v8', 'node:zlib',
    // Common npm packages
    'react', 'react-dom', 'react-router-dom', 'react-router',
    'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit',
    'express', 'fastify', 'koa', 'hapi', '@hapi/hapi',
    'lodash', 'axios', 'dotenv', 'cors', 'body-parser', 'helmet',
    'jsonwebtoken', 'bcrypt', 'bcryptjs',
    'mongoose', 'pg', 'mysql2', 'sqlite3', 'better-sqlite3',
    '@prisma/client', 'prisma', 'sequelize', 'typeorm', 'drizzle-orm',
    'zod', 'joi', 'yup', 'ajv',
    'jest', 'vitest', 'mocha', 'chai', 'supertest', '@testing-library/react',
    'webpack', 'vite', 'rollup', 'esbuild', 'parcel',
    'tailwindcss', 'postcss', 'autoprefixer',
    'stripe', 'nodemailer', 'twilio', '@sendgrid/mail',
    'redis', 'ioredis', '@upstash/redis',
    'bullmq', 'bull', 'agenda',
    'socket.io', 'ws',
    'typescript', 'ts-node', 'tsx',
    'eslint', 'prettier', 'husky', 'lint-staged',
    '@tanstack/react-query', '@tanstack/react-table',
    'zustand', 'jotai', 'recoil', '@reduxjs/toolkit', 'redux',
    'framer-motion', 'gsap', 'three',
    'class-validator', 'class-transformer',
    '@nestjs/core', '@nestjs/common', '@nestjs/platform-express',
]);

// ─── OutputValidator class ───────────────────────────────────────────────────

export class OutputValidator {
    /**
     * Validate LLM output against verification criteria and constraint rules.
     *
     * @param {string} llmOutput — raw LLM-generated content
     * @param {object} verificationCriteria — from VerificationAgent.analyze()
     * @param {object} constraints — from ConstraintAgent.analyze()
     * @returns {{ passed: boolean, score: number, violations: object[], syntaxErrors: string[], warnings: string[] }}
     */
    static validate(llmOutput, verificationCriteria, constraints) {
        const violations = [];
        const syntaxErrors = [];
        const warnings = [];

        if (!llmOutput || typeof llmOutput !== 'string') {
            return {
                passed: false,
                score: 0,
                violations: [{ type: 'empty_output', message: 'LLM output is null, undefined, or not a string', severity: 'error' }],
                syntaxErrors: [],
                warnings: [],
            };
        }

        const output = llmOutput.trim();

        // ── Stage 1: Basic content ────────────────────────────────────────
        OutputValidator._checkBasicContent(output, violations);

        // ── Stage 2: Forbidden content (placeholder / truncation) ─────────
        OutputValidator._checkForbiddenContent(output, verificationCriteria, violations);

        // ── Stage 3: Syntax validation ─────────────────────────────────────
        OutputValidator._checkSyntax(output, verificationCriteria, syntaxErrors, violations);

        // ── Stage 4: Import validation ─────────────────────────────────────
        OutputValidator._checkImports(output, constraints, violations, warnings);

        // ── Stage 5: Constraint compliance ────────────────────────────────
        OutputValidator._checkConstraintCompliance(output, constraints, violations, warnings);

        // ── Stage 6: Structural checks ─────────────────────────────────────
        OutputValidator._checkStructure(output, verificationCriteria, violations, warnings);

        // ── Stage 7: Semantic/required content checks ──────────────────────
        OutputValidator._checkRequiredContent(output, verificationCriteria, violations, warnings);

        // ── Score computation ──────────────────────────────────────────────
        const score = OutputValidator._computeScore(violations, verificationCriteria);
        const passed = violations.filter(v => v.severity === 'error').length === 0 && score >= 0.5;

        return { passed, score, violations, syntaxErrors, warnings };
    }

    // ─── Stage 1: Basic content ───────────────────────────────────────────────

    /** @private */
    static _checkBasicContent(output, violations) {
        if (output.length === 0) {
            violations.push({ type: 'empty_output', message: 'Output is empty', severity: 'error' });
            return;
        }
        if (output.length < 20) {
            violations.push({ type: 'trivially_short', message: `Output is only ${output.length} characters — likely not real code`, severity: 'error' });
        }
    }

    // ─── Stage 2: Forbidden content ──────────────────────────────────────────

    /** @private */
    static _checkForbiddenContent(output, verificationCriteria, violations) {
        // Built-in placeholder checks
        for (const { re, label } of PLACEHOLDER_PATTERNS) {
            if (re.test(output)) {
                violations.push({
                    type: 'placeholder_detected',
                    message: `Forbidden placeholder text: ${label}`,
                    severity: 'error',
                });
            }
        }

        // From VerificationAgent's forbidden content list
        const forbiddenChecks = verificationCriteria?.forbiddenContent || [];
        for (const check of forbiddenChecks) {
            for (const pattern of (check.patterns || [])) {
                const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
                if (re.test(output)) {
                    violations.push({
                        type: check.type || 'forbidden_content',
                        message: `${check.description}: matched pattern ${re}`,
                        severity: 'error',
                    });
                    break;  // one violation per check is enough
                }
            }
        }
    }

    // ─── Stage 3: Syntax validation ───────────────────────────────────────────

    /** @private */
    static _checkSyntax(output, verificationCriteria, syntaxErrors, violations) {
        const syntaxChecks = verificationCriteria?.syntaxChecks || [];
        for (const check of syntaxChecks) {
            const result = OutputValidator._runSyntaxCheck(check.type, output);
            if (!result.passed) {
                syntaxErrors.push(result.message);
                violations.push({
                    type: `syntax_${check.type}`,
                    message: result.message,
                    severity: 'error',
                });
            }
        }

        // Always run bracket balance check on non-trivial output
        if (output.length > 50 && !syntaxChecks.some(c => c.type === 'bracket_balance')) {
            const bracketResult = OutputValidator._checkBracketBalance(output);
            if (!bracketResult.passed) {
                syntaxErrors.push(bracketResult.message);
                violations.push({ type: 'syntax_bracket_balance', message: bracketResult.message, severity: 'error' });
            }
        }

        // JSON-specific check
        if (output.trim().startsWith('{') || output.trim().startsWith('[')) {
            const jsonResult = OutputValidator._tryParseJSON(output);
            if (!jsonResult.passed) {
                // Only flag as error if the whole output looks like it should be JSON
                const looksLikeJSON = /^\s*[{[]/.test(output) && /[}\]]\s*$/.test(output);
                if (looksLikeJSON) {
                    syntaxErrors.push(jsonResult.message);
                    violations.push({ type: 'syntax_json', message: jsonResult.message, severity: 'error' });
                }
            }
        }
    }

    /**
     * Run a single named syntax check.
     * @private
     */
    static _runSyntaxCheck(checkType, output) {
        switch (checkType) {
            case 'bracket_balance':
                return OutputValidator._checkBracketBalance(output);
            case 'string_termination':
                return OutputValidator._checkStringTermination(output);
            case 'json_parseable':
                return OutputValidator._tryParseJSON(output);
            case 'tag_balance':
                return OutputValidator._checkHTMLTagBalance(output);
            case 'doctype_present':
                return /<!DOCTYPE\s+html>/i.test(output)
                    ? { passed: true }
                    : { passed: false, message: 'HTML file missing <!DOCTYPE html> declaration' };
            case 'indentation_consistency':
                return OutputValidator._checkPythonIndentation(output);
            case 'colon_after_blocks':
                return OutputValidator._checkPythonColons(output);
            case 'template_literal_balance':
                return OutputValidator._checkTemplateLiterals(output);
            case 'import_statement_validity':
                return OutputValidator._checkImportStatements(output);
            case 'arrow_function_validity':
                return { passed: true };  // too complex for static check without full parser
            default:
                return { passed: true };
        }
    }

    /** @private */
    static _checkBracketBalance(output) {
        const stack = [];
        const pairs = { ')': '(', ']': '[', '}': '{' };
        let inString = false;
        let stringChar = '';
        let escaped = false;
        let inLineComment = false;
        let inBlockComment = false;

        for (let i = 0; i < output.length; i++) {
            const ch = output[i];
            const prev = i > 0 ? output[i - 1] : '';

            // Track line comments
            if (!inString && !inBlockComment && ch === '/' && output[i + 1] === '/') {
                inLineComment = true;
            }
            if (inLineComment && ch === '\n') {
                inLineComment = false;
                continue;
            }
            if (inLineComment) continue;

            // Track block comments
            if (!inString && ch === '/' && output[i + 1] === '*') {
                inBlockComment = true;
                i++;
                continue;
            }
            if (inBlockComment && ch === '*' && output[i + 1] === '/') {
                inBlockComment = false;
                i++;
                continue;
            }
            if (inBlockComment) continue;

            // Track strings
            if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
                inString = true;
                stringChar = ch;
                continue;
            }
            if (inString) {
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === stringChar) { inString = false; continue; }
                continue;
            }

            // Check brackets
            if ('([{'.includes(ch)) {
                stack.push(ch);
            } else if (')]}'.includes(ch)) {
                const expected = pairs[ch];
                if (stack.length === 0 || stack[stack.length - 1] !== expected) {
                    return { passed: false, message: `Unbalanced bracket: unexpected '${ch}' at position ${i}` };
                }
                stack.pop();
            }
        }

        if (stack.length > 0) {
            return { passed: false, message: `Unbalanced brackets: unclosed '${stack.join('')}'` };
        }
        return { passed: true };
    }

    /** @private */
    static _checkStringTermination(output) {
        // Check that major code-bearing lines don't have unterminated strings
        // This is a heuristic, not a full parser
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comment-only lines
            if (/^\s*(\/\/|#|\/\*)/.test(line)) continue;

            // Count unescaped quotes
            let singles = 0, doubles = 0;
            let escaped = false;
            for (const ch of line) {
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === "'") singles++;
                if (ch === '"') doubles++;
            }
            // Odd number of non-template-literal quotes on a line (not inside template literal)
            if (singles % 2 !== 0 && !line.includes('`')) {
                return { passed: false, message: `Possible unterminated string on line ${i + 1}: ${line.slice(0, 60)}` };
            }
            if (doubles % 2 !== 0 && !line.includes('`')) {
                return { passed: false, message: `Possible unterminated string on line ${i + 1}: ${line.slice(0, 60)}` };
            }
        }
        return { passed: true };
    }

    /** @private */
    static _tryParseJSON(output) {
        // Extract the JSON portion if wrapped in other content
        const jsonMatch = output.match(/^\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
        const toParse = jsonMatch ? jsonMatch[1] : output;
        try {
            JSON.parse(toParse);
            return { passed: true };
        } catch (e) {
            return { passed: false, message: `JSON parse error: ${e.message}` };
        }
    }

    /** @private */
    static _checkHTMLTagBalance(output) {
        // Simple heuristic: count open/close tags for common block elements
        const blockTags = ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'ul', 'ol', 'li', 'table', 'tbody', 'tr', 'script', 'style', 'form'];
        for (const tag of blockTags) {
            const opens = (output.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
            const closes = (output.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
            if (opens !== closes && opens > 0) {
                return { passed: false, message: `Unbalanced HTML <${tag}> tags: ${opens} opens, ${closes} closes` };
            }
        }
        return { passed: true };
    }

    /** @private */
    static _checkPythonIndentation(output) {
        const lines = output.split('\n').filter(l => l.trim().length > 0 && !l.trim().startsWith('#'));
        for (const line of lines) {
            const indent = line.match(/^(\s*)/)[1];
            if (indent.includes('\t') && indent.includes(' ')) {
                return { passed: false, message: 'Mixed tabs and spaces in indentation' };
            }
        }
        return { passed: true };
    }

    /** @private */
    static _checkPythonColons(output) {
        const blockStarters = /^\s*(def |class |if |elif |else:|for |while |with |try:|except |finally:|async def )/;
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (blockStarters.test(line) && !line.trim().endsWith(':') && !line.trim().endsWith('\\')
                && !line.trim().includes('#') && !line.trim().endsWith(',')) {
                // Allow multi-line statements
                if (!lines[i + 1]?.trim().startsWith('.') && line.trim().endsWith(')')) {
                    return { passed: false, message: `Missing colon at end of block statement on line ${i + 1}: ${line.trim().slice(0, 60)}` };
                }
            }
        }
        return { passed: true };
    }

    /** @private */
    static _checkTemplateLiterals(output) {
        // Count backticks — must be even (paired)
        let count = 0;
        let escaped = false;
        for (const ch of output) {
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === '`') count++;
        }
        if (count % 2 !== 0) {
            return { passed: false, message: `Unbalanced template literals: ${count} backticks (must be even)` };
        }
        return { passed: true };
    }

    /** @private */
    static _checkImportStatements(output) {
        // Check that import statements don't have obvious syntax errors
        const importLines = output.match(/^import\s+.+/gm) || [];
        for (const line of importLines) {
            // Must have 'from' keyword if not a side-effect import
            if (!line.includes(' from ') && !/^import\s+['"]/.test(line) && !/^import\s+type\s+/.test(line)) {
                // Could be import() dynamic — skip
                if (!line.includes('(')) {
                    return { passed: false, message: `Malformed import statement: ${line.slice(0, 80)}` };
                }
            }
        }
        return { passed: true };
    }

    // ─── Stage 4: Import validation ───────────────────────────────────────────

    /** @private */
    static _checkImports(output, constraints, violations, warnings) {
        // Extract all import statements
        const importMatches = [
            ...(output.matchAll(/^(?:import|from)\s+['"]([^'"]+)['"]/gm) || []),
            ...(output.matchAll(/require\(['"]([^'"]+)['"]\)/g) || []),
        ];

        const allowedImports = new Set(constraints?.allowedImports || []);
        const isZeroDep = constraints?.zeroDepMode === true;

        for (const match of importMatches) {
            const pkg = match[1];

            // Relative imports are always allowed
            if (pkg.startsWith('.') || pkg.startsWith('/')) continue;

            // Node built-ins with or without 'node:' prefix
            const stripped = pkg.replace(/^node:/, '');
            if (KNOWN_REAL_PACKAGES.has(pkg) || KNOWN_REAL_PACKAGES.has(`node:${stripped}`)) {
                if (isZeroDep && !pkg.startsWith('node:') && !KNOWN_REAL_PACKAGES.has(`node:${stripped}`)) {
                    violations.push({
                        type: 'non_builtin_import',
                        message: `Zero-dep mode: "${pkg}" is not a Node.js built-in`,
                        severity: 'error',
                    });
                }
                continue;
            }

            // Check against allowed imports list (if provided and non-trivial)
            if (allowedImports.size > 0) {
                const isAllowed = allowedImports.has(pkg)
                    || allowedImports.has(pkg.split('/')[0])  // scoped packages: @org/pkg → check @org/pkg or @org
                    || allowedImports.has('@' + pkg.split('/')[0]);

                if (!isAllowed) {
                    // Unknown package — could be hallucinated
                    const isScoped = pkg.startsWith('@');
                    violations.push({
                        type: 'unknown_import',
                        message: `Import "${pkg}" is not in the approved package list — may be hallucinated`,
                        severity: isScoped ? 'warning' : 'error',
                    });
                }
            } else {
                // No allowed list provided — just warn about clearly suspicious packages
                if (OutputValidator._looksHallucinated(pkg)) {
                    warnings.push(`Suspicious import "${pkg}" — verify this package exists`);
                }
            }
        }
    }

    /**
     * Heuristic: does this package name look hallucinated?
     * @private
     */
    static _looksHallucinated(pkg) {
        const suspiciousPatterns = [
            /magic/i, /auto-/i, /smart-/i, /ai-helper/i, /code-gen/i,
            /\d{4,}/, // packages with long numbers are suspicious
        ];
        return suspiciousPatterns.some(p => p.test(pkg));
    }

    // ─── Stage 5: Constraint compliance ──────────────────────────────────────

    /** @private */
    static _checkConstraintCompliance(output, constraints, violations, warnings) {
        if (!constraints) return;

        // Check security constraints: no path traversal
        if (/\.\.[/\\]/.test(output)) {
            violations.push({ type: 'path_traversal', message: 'Output contains path traversal (../) — security violation', severity: 'error' });
        }

        // Check for hardcoded secrets (rudimentary)
        const secretPatterns = [
            { re: /(?:password|passwd|pwd)\s*=\s*['"][^'"]{4,}['"]/i, label: 'Hardcoded password' },
            { re: /(?:api[_-]?key|apikey)\s*=\s*['"][^'"]{10,}['"]/i, label: 'Hardcoded API key' },
            { re: /(?:secret|token)\s*=\s*['"][^'"]{10,}['"]/i, label: 'Hardcoded secret/token' },
            { re: /sk-[a-zA-Z0-9]{20,}/,                               label: 'OpenAI-style API key' },
            { re: /ghp_[a-zA-Z0-9]{36}/,                               label: 'GitHub Personal Access Token' },
        ];
        for (const { re, label } of secretPatterns) {
            if (re.test(output)) {
                violations.push({ type: 'hardcoded_secret', message: `Security: ${label} detected in output`, severity: 'error' });
            }
        }

        // Zero-dep mode: no npm package imports
        if (constraints.zeroDepMode) {
            const npmImports = output.match(/(?:^import\s+.*from\s+['"]|require\(['"])((?!node:)[^./'"@][^'"]*)['"]/gm) || [];
            for (const imp of npmImports) {
                const pkgMatch = imp.match(/['"]([^'"]+)['"]/g);
                if (pkgMatch) {
                    const pkg = pkgMatch[0].replace(/['"]/g, '');
                    if (!pkg.startsWith('.') && !pkg.startsWith('/') && !pkg.startsWith('node:')) {
                        violations.push({
                            type: 'zero_dep_violation',
                            message: `Zero-dep mode violation: importing external package "${pkg}"`,
                            severity: 'error',
                        });
                    }
                }
            }
        }

        // Behavior constraints: check for forbidden patterns
        const behaviorConstraints = constraints.behaviorConstraints || [];
        if (behaviorConstraints.some(c => c.includes('async/await'))) {
            // If async/await required, check for raw .then() chains (warning, not error)
            const hasThenChains = /\.\bthen\b\s*\(/.test(output) && /async\s+function|=>\s*\{|async\s*\(/.test(output);
            if (hasThenChains) {
                warnings.push('Mixed async/await and .then() chains detected — prefer consistent async/await style');
            }
        }

        // Forbidden file paths check
        for (const forbiddenPath of (constraints.forbiddenFilePaths || [])) {
            if (forbiddenPath.includes('*')) continue;  // skip globs for now
            const clean = forbiddenPath.replace(/\/$/, '');
            if (output.includes(clean)) {
                violations.push({
                    type: 'forbidden_file_ref',
                    message: `Output references forbidden path: "${forbiddenPath}"`,
                    severity: 'warning',
                });
            }
        }
    }

    // ─── Stage 6: Structural checks ───────────────────────────────────────────

    /** @private */
    static _checkStructure(output, verificationCriteria, violations, warnings) {
        const structuralChecks = verificationCriteria?.structuralChecks || [];

        for (const check of structuralChecks) {
            switch (check.type) {
                case 'has_export':
                    if (!/export\s+(default|const|function|class|let|var|\{)/.test(output)) {
                        violations.push({ type: 'missing_export', message: 'ESM file has no export statement', severity: 'warning' });
                    }
                    break;

                case 'no_require':
                    if (/\brequire\s*\(/.test(output)) {
                        violations.push({ type: 'require_in_esm', message: 'require() used in ESM module', severity: 'error' });
                    }
                    break;

                case 'has_test_structure':
                    if (!/describe\s*\(|it\s*\(|test\s*\(|def\s+test_/.test(output)) {
                        violations.push({ type: 'no_tests', message: 'Test file has no test cases', severity: 'error' });
                    }
                    break;

                case 'has_api_endpoint':
                    if (!/(app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(/.test(output)) {
                        violations.push({ type: 'no_api_endpoint', message: 'Expected API endpoint not found', severity: 'warning' });
                    }
                    break;
            }
        }
    }

    // ─── Stage 7: Required content ────────────────────────────────────────────

    /** @private */
    static _checkRequiredContent(output, verificationCriteria, violations, warnings) {
        const requiredContent = verificationCriteria?.requiredContent || [];

        for (const check of requiredContent) {
            switch (check.type) {
                case 'pattern_present': {
                    const re = check.pattern instanceof RegExp ? check.pattern : new RegExp(check.pattern);
                    if (!re.test(output)) {
                        violations.push({
                            type: 'missing_required_pattern',
                            message: `Required pattern not found: ${check.description}`,
                            severity: 'warning',
                        });
                    }
                    break;
                }
                case 'identifier_present': {
                    if (!output.includes(check.value)) {
                        warnings.push(`Expected identifier "${check.value}" not found in output`);
                    }
                    break;
                }
            }
        }
    }

    // ─── Score computation ────────────────────────────────────────────────────

    /**
     * Compute a 0.0–1.0 quality score from violations.
     * @private
     */
    static _computeScore(violations, verificationCriteria) {
        if (violations.length === 0) return 1.0;

        const weights = verificationCriteria?.weights || { syntax: 0.4, forbiddenContent: 0.3, requiredContent: 0.2, structural: 0.1 };
        let penalty = 0;

        for (const v of violations) {
            if (v.severity === 'error') {
                if (v.type.startsWith('syntax_') || v.type === 'empty_output' || v.type === 'trivially_short') {
                    penalty += weights.syntax * 0.5;
                } else if (v.type.startsWith('placeholder') || v.type.startsWith('forbidden')) {
                    penalty += weights.forbiddenContent * 0.5;
                } else if (v.type.startsWith('missing_required') || v.type.startsWith('no_test')) {
                    penalty += weights.requiredContent * 0.3;
                } else {
                    penalty += 0.15;
                }
            } else {
                // warnings cost less
                penalty += 0.05;
            }
        }

        return Math.max(0, Math.min(1, 1 - penalty));
    }

    /**
     * Extract a structured summary of violations by category.
     * Useful for building the previousFailure context for regeneration.
     *
     * @param {object} validationResult — from OutputValidator.validate()
     * @returns {object}
     */
    static summarize(validationResult) {
        const categories = {
            syntax: [],
            placeholder: [],
            imports: [],
            constraints: [],
            structural: [],
            semantic: [],
        };

        for (const v of validationResult.violations) {
            if (v.type.startsWith('syntax_')) categories.syntax.push(v);
            else if (v.type.includes('placeholder') || v.type.includes('truncat')) categories.placeholder.push(v);
            else if (v.type.includes('import') || v.type.includes('require') || v.type.includes('dep')) categories.imports.push(v);
            else if (v.type.includes('constraint') || v.type.includes('security') || v.type.includes('path')) categories.constraints.push(v);
            else if (v.type.includes('export') || v.type.includes('struct') || v.type.includes('test')) categories.structural.push(v);
            else categories.semantic.push(v);
        }

        return {
            passed: validationResult.passed,
            score: validationResult.score,
            categories,
            violations: validationResult.violations,
            syntaxErrors: validationResult.syntaxErrors,
            warnings: validationResult.warnings,
            topIssues: validationResult.violations
                .filter(v => v.severity === 'error')
                .slice(0, 5)
                .map(v => v.message),
        };
    }
}
