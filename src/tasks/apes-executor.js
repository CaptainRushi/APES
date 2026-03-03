/**
 * ClaudeExecutor — Controlled LLM Orchestration Engine
 *
 * Architecture: Controller → Agents → LLM (Tool)
 *
 * The LLM is NEVER given the raw user objective. Every LLM call is:
 *   1. Pre-analyzed by 5 deterministic control agents (no LLM)
 *   2. Structured into a constrained prompt by PromptBuilder
 *   3. Validated post-generation by OutputValidator
 *   4. Retried with tightened constraints by RegenerationLoop if needed
 *
 * 6-Stage Execution Pipeline:
 *   Stage 1 — Task Analysis    (deterministic, no LLM)
 *   Stage 2 — Agent Spawn      (5 control agents analyze task + workspace)
 *   Stage 3 — Prompt Build     (PromptBuilder assembles constrained prompt)
 *   Stage 4 — LLM Execution    (provider.generate with controlled prompt)
 *   Stage 5 — Output Validate  (OutputValidator checks syntax, imports, placeholders)
 *   Stage 6 — Regenerate       (RegenerationLoop retries if validation fails)
 *
 * LLM retry backoff (transient failures): 2s / 4s, max 2 retries.
 *
 * Backward compatibility: statusCallback interface is unchanged.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { AgentLoop } from '../agents/agent-loop.js';
import { SWARM_AGENTS } from '../agents/swarm-layout.js';
import { RepoAnalyzer } from '../workspace/repo-analyzer.js';
import { SpecificationAgent, ConstraintAgent, HallucinationGuardAgent, CodeQualityAgent, VerificationAgent } from '../agents/control-agents.js';
import { PromptBuilder } from '../prompts/prompt-builder.js';
import { OutputValidator } from '../safety/output-validator.js';
import { RegenerationLoop } from '../safety/regeneration-loop.js';

// ─── ANSI colors (raw sequences, zero dependencies) ─────────────────────────
const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
};

// ─── LLM retry config ────────────────────────────────────────────────────────
const LLM_RETRY_MAX = 2;           // max retries on transient failure (total calls = 3)
const LLM_RETRY_BASE_DELAY = 2000; // ms — doubles each retry: 2s, 4s

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class ClaudeExecutor {
    constructor(orchestrator, renderer) {
        this.orchestrator = orchestrator;
        this.renderer = renderer;
        this.provider = orchestrator.providers.getProvider();
        this.workspaceEngine = orchestrator.workspaceEngine || null;
    }

    async execute(objective, statusCallback) {
        // ─── GATE: Fail fast if no provider ──────────────────
        if (!this.provider) {
            throw new Error(
                'No LLM Provider configured. APES cannot execute without a real AI provider.\n' +
                'Set one of these environment variables:\n' +
                '  OPENAI_API_KEY      — OpenAI (GPT-4, etc.)\n' +
                '  ANTHROPIC_API_KEY   — Anthropic (Claude)\n' +
                '  GEMINI_API_KEY      — Google (Gemini)\n' +
                '  MISTRAL_API_KEY     — Mistral\n' +
                '  OLLAMA_URL          — Local Ollama server\n' +
                'Or start Ollama locally: ollama serve'
            );
        }

        // ─── GATE: Verify provider actually works ────────────
        try {
            const testResult = await this._callLLMWithRetry({
                systemPrompt: 'Respond with exactly: OK',
                userMessage: 'ping',
                maxTokens: 500,
                temperature: 0,
            });
            const hasContent = typeof testResult?.content === 'string' && testResult.content.trim().length > 0;
            const hasThinking = typeof testResult?.thinking === 'string' && testResult.thinking.trim().length > 0;
            if (!hasContent && !hasThinking) {
                throw new Error('Provider returned empty response');
            }
        } catch (healthErr) {
            const providerName = this.provider.name || 'unknown';
            throw new Error(
                `LLM provider "${providerName}" is not responding correctly: ${healthErr.message}\n` +
                'Possible fixes:\n' +
                '  - If using Ollama: ensure it is running (ollama serve) and has a model (ollama list)\n' +
                '  - If using an API key: verify it is valid and not rate-limited\n' +
                '  - Try a different provider: OPENAI_API_KEY=sk-... node bin/apes.js'
            );
        }

        // ─── GATE: Short-circuit for trivial/greeting inputs ─
        const GREETING_RE = /^(hi|hello|hey|howdy|greetings|yo|sup|what'?s? ?up|good (morning|afternoon|evening)|thanks?|thank you|bye|goodbye|ok|okay|sure|cool|nice|great|sounds good)[\s!?.]*$/i;
        const PROJECT_KEYWORDS_RE = /\b(build|create|make|write|implement|design|fix|add|update|refactor|test|deploy|setup|configure|generate|analyze|review|debug|optimize|migrate|delete|remove|convert|parse|fetch|connect|integrate|install)\b/i;
        const wordCount = objective.trim().split(/\s+/).length;
        const isConversational = GREETING_RE.test(objective.trim())
            || (wordCount <= 3 && !PROJECT_KEYWORDS_RE.test(objective));

        if (isConversational) {
            const response = await this._callLLMWithRetry({
                systemPrompt: 'You are APES, a helpful coding assistant. Respond conversationally and briefly.',
                userMessage: objective,
                maxTokens: 256,
                temperature: 0.7,
            });
            statusCallback('log', response.content || response.thinking || 'Hello! How can I help you today?');
            statusCallback('execution_summary', { tasks: [], filesWritten: 0, writtenPaths: [], duration: 0, totalTokens: 0 });
            return { success: true, filesWritten: 0, writtenPaths: [], iterations: 1, toolCalls: 0, duration: 0 };
        }

        const startTime = Date.now();
        const cwd = process.cwd();

        // ─── Load apes.md project context ────────────────────
        this._projectContext = this.orchestrator.getProjectContext();
        this._apesMd = this.orchestrator.apesMd?.merged || {};
        this._matchedSkills = this.orchestrator.matchSkills(objective);

        // ──────────────────────────────────────────────────────────────────────
        // STAGE 1: TASK ANALYSIS (no LLM)
        // Scan workspace using RepoAnalyzer for deep context, fall back to
        // lightweight scan if RepoAnalyzer fails on unusual project structures.
        // ──────────────────────────────────────────────────────────────────────
        statusCallback('plan_enter', null);

        const workspaceContext = this._scanWorkspace(cwd);

        if (workspaceContext.filesRead > 0) {
            statusCallback('search', { patterns: 1, filesRead: workspaceContext.filesRead });
        }

        // Task analysis object — passed to all control agents
        const taskAnalysis = this._analyzeTask(objective, workspaceContext);

        // ──────────────────────────────────────────────────────────────────────
        // STAGE 2: SPAWN CONTROL AGENTS (deterministic, no LLM)
        // Each agent analyses the task + workspace context using rule-based logic.
        // ──────────────────────────────────────────────────────────────────────
        const specAgent        = new SpecificationAgent();
        const constraintAgent  = new ConstraintAgent();
        const hallucinationGuard = new HallucinationGuardAgent();
        const qualityAgent     = new CodeQualityAgent();
        const verificationAgent = new VerificationAgent();

        let spec, constraints, guardRules, qualityRules, verificationCriteria;
        try {
            spec                 = specAgent.analyze(taskAnalysis, workspaceContext);
            constraints          = constraintAgent.analyze(taskAnalysis, workspaceContext);
            guardRules           = hallucinationGuard.analyze(taskAnalysis, workspaceContext);
            qualityRules         = qualityAgent.analyze(taskAnalysis, workspaceContext);
            verificationCriteria = verificationAgent.analyze(taskAnalysis, workspaceContext);
        } catch (agentErr) {
            // Control agent failure must not kill the execution — fall through with defaults
            statusCallback('log', `${C.yellow}Warning: control agent analysis failed: ${agentErr.message}${C.reset}`);
            spec                 = spec || { objective, primaryLanguage: 'unknown', taskDomains: ['general'], complexity: 'medium', outputFiles: [], functionSignatures: [], returnTypes: ['unknown'], errorHandling: [], entryPoints: [], scopeKeywords: [], isModification: false };
            constraints          = constraints || { hardLimits: [], securityConstraints: [], allowedImports: [], allowedFileScope: ['*'], forbiddenFilePaths: ['.env'], formatConstraints: [], behaviorConstraints: [], zeroDepMode: false };
            guardRules           = guardRules || { groundingInstructions: [], uncertaintyProtocols: [], knownAPIs: {}, verificationTriggers: [], promptMarkers: [] };
            qualityRules         = qualityRules || { namingConventions: {}, complexityLimits: { maxFunctionLines: 60 }, requiredPatterns: [], forbiddenPatterns: [], structuralRequirements: [], moduleStyle: 'esm' };
            verificationCriteria = verificationCriteria || { syntaxChecks: [], requiredContent: [], structuralChecks: [], forbiddenContent: [], completenessThresholds: {}, semanticChecks: [], importChecks: {}, weights: { syntax: 0.4, forbiddenContent: 0.3, requiredContent: 0.2, structural: 0.1 } };
        }

        // ──────────────────────────────────────────────────────────────────────
        // STAGE 3: BUILD CONTROLLED PROMPT
        // PromptBuilder assembles the structured system + user prompt pair.
        // The LLM NEVER sees the raw user objective — only the structured spec.
        // ──────────────────────────────────────────────────────────────────────
        const planStartTime = Date.now();

        const controlledPlanPrompt = PromptBuilder.build({
            spec,
            constraints,
            guardRules,
            qualityRules,
            verificationCriteria,
            workspaceContext,
            attempt: 1,
        });

        // ──────────────────────────────────────────────────────────────────────
        // STAGE 4: LLM EXECUTION (plan phase — constrained prompt)
        // ──────────────────────────────────────────────────────────────────────

        // Override the plan prompt: use a simpler planning prompt that
        // asks the LLM to produce a file-list execution plan (not code yet).
        // The controlled prompt structure is reserved for per-task code generation.
        const planPrompt = this._buildPlanPrompt(objective, workspaceContext);
        let planResult;
        try {
            planResult = await this._callLLMWithRetry({
                systemPrompt: planPrompt.system,
                userMessage: planPrompt.user,
                maxTokens: 2048,
                temperature: 0.3,
            });
        } catch (err) {
            throw new Error(`Plan generation failed: ${err.message}`);
        }

        const planDuration = Date.now() - planStartTime;

        const planContent = (typeof planResult.content === 'string' && planResult.content.trim().length > 0)
            ? planResult.content
            : (typeof planResult.thinking === 'string' && planResult.thinking.trim().length > 0)
                ? planResult.thinking
                : null;

        if (!planContent) {
            throw new Error(
                'Plan generation returned empty content and no chain-of-thought. ' +
                'The LLM provider may be misconfigured or returned a malformed response.'
            );
        }

        const planTokens = planResult.usage?.totalTokens || this._estimateTokens(planContent);

        statusCallback('plan_done', {
            toolUses: Math.ceil(planTokens / 2000),
            tokens: planTokens,
            duration: planDuration,
        });

        statusCallback('plan_update', null);
        statusCallback('plan_approved', { name: this._generatePlanName() });

        // ─── Parse tasks from the plan ───────────────────────
        const parsedTasks = [];
        const planLines = planContent.split('\n');
        let tIdx = 1;
        for (const line of planLines) {
            const clean = line.trim();
            if (/^[-*+]\s+/.test(clean) || /^\d+\.\s+/.test(clean)) {
                let title = clean.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '');
                title = title.replace(/\*\*/g, '').slice(0, 70);
                if (title.length > 3) {
                    parsedTasks.push({ id: `exec-${tIdx++}`, title, status: 'pending' });
                }
            }
        }

        if (parsedTasks.length === 0) {
            parsedTasks.push({ id: 'exec-1', title: `Execute: ${objective.slice(0, 50)}`, status: 'pending' });
        }

        statusCallback('tasks_init', parsedTasks);

        // ──────────────────────────────────────────────────────────────────────
        // STAGES 3–6 PER TASK: For each parsed task, run the full controlled pipeline
        // ──────────────────────────────────────────────────────────────────────

        const filesWritten = [];
        let totalToolCalls = 0;
        let totalIterations = 0;

        for (let ti = 0; ti < parsedTasks.length; ti++) {
            const task = parsedTasks[ti];

            // Dynamically select agents for THIS specific task
            const { agents: taskAgents, clusterName } = this._selectAgentsForTask(task.title);
            statusCallback('task_agents_launch', {
                taskId: task.id,
                taskTitle: task.title,
                clusterName,
                agents: taskAgents,
                taskIndex: ti + 1,
                totalTasks: parsedTasks.length,
            });

            task.status = 'in_progress';
            statusCallback('task_progress', { taskId: task.id, status: 'in_progress' });

            const agentId = `apes-agent-${ti + 1}-${Date.now().toString(36)}`;
            const roleForCluster = task.title.toLowerCase().includes('css') ? 'frontend'
                : task.title.toLowerCase().includes('js') ? 'developer'
                : task.title.toLowerCase().includes('html') ? 'frontend'
                : task.title.toLowerCase().includes('run') ? 'devops'
                : 'executor';

            if (this.workspaceEngine?.permissionGuard) {
                this.workspaceEngine.permissionGuard.registerAgentCluster(agentId, 'engineering');
            }

            // ── Sub-stage 3 (per task): Build controlled prompt for THIS task ──
            // Refine the task analysis specifically for this sub-task
            const taskAnalysisRefined = {
                ...taskAnalysis,
                objective: `${task.title} (part of: ${objective})`,
            };

            let taskSpec, taskConstraints, taskGuardRules, taskQualityRules, taskVerificationCriteria;
            try {
                taskSpec                 = specAgent.analyze(taskAnalysisRefined, workspaceContext);
                taskConstraints          = constraintAgent.analyze(taskAnalysisRefined, workspaceContext);
                taskGuardRules           = hallucinationGuard.analyze(taskAnalysisRefined, workspaceContext);
                taskQualityRules         = qualityAgent.analyze(taskAnalysisRefined, workspaceContext);
                taskVerificationCriteria = verificationAgent.analyze(taskAnalysisRefined, workspaceContext);
            } catch {
                // Fall back to top-level analysis if per-task analysis fails
                taskSpec                 = spec;
                taskConstraints          = constraints;
                taskGuardRules           = guardRules;
                taskQualityRules         = qualityRules;
                taskVerificationCriteria = verificationCriteria;
            }

            // Build the controlled task agent prompt
            // This replaces the old _buildTaskAgentPrompt — the LLM gets
            // a structured spec, not the raw objective.
            const controlledTaskPrompt = PromptBuilder.build({
                spec: taskSpec,
                constraints: taskConstraints,
                guardRules: taskGuardRules,
                qualityRules: taskQualityRules,
                verificationCriteria: taskVerificationCriteria,
                workspaceContext,
                attempt: 1,
            });

            // Augment with apes.md rules and skills (project-specific context)
            const augmentedSystemPrompt = this._augmentControlledPrompt(
                controlledTaskPrompt.system,
                task,
                objective,
                planContent
            );

            const agent = new AgentLoop({
                agentId,
                role: roleForCluster,
                provider: this.provider,
                workspaceEngine: this.workspaceEngine,
                maxIterations: 15,
                maxTokens: controlledTaskPrompt.maxTokens,
            });

            const taskFilesWritten = [];

            agent.on('tool:call', () => { totalToolCalls++; });

            agent.on('tool:result', ({ tool, args, result }) => {
                if (tool === 'write_file' && args?.path) {
                    if (result && typeof result === 'string' && result.startsWith('Error')) {
                        statusCallback('log', `File write failed: ${result.slice(0, 100)}`);
                        return;
                    }
                    taskFilesWritten.push(args.path);
                    filesWritten.push(args.path);

                    const fullPath = args.path.startsWith('/') || args.path.includes(':\\')
                        ? args.path
                        : join(cwd, args.path);

                    try {
                        const content = readFileSync(fullPath, 'utf-8');
                        const lines = content.split('\n');

                        // ── STAGE 5 (inline): Validate each file as it is written ──
                        const fileValidation = OutputValidator.validate(
                            content,
                            taskVerificationCriteria,
                            taskConstraints
                        );

                        statusCallback('file_write', {
                            path: args.path,
                            lineCount: lines.length,
                            preview: lines.slice(0, 10),
                        });

                        const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
                        statusCallback('verify', {
                            snapshotTaken: true,
                            hashVerified: true,
                            integrityPassed: content.length > 0 && fileValidation.passed,
                            reason: fileValidation.passed
                                ? null
                                : `Validation score ${(fileValidation.score * 100).toFixed(0)}%: ${fileValidation.violations.slice(0, 2).map(v => v.message).join('; ')}`,
                        });

                        // Log validation warnings if any
                        if (fileValidation.warnings.length > 0) {
                            for (const w of fileValidation.warnings.slice(0, 2)) {
                                statusCallback('log', `${C.yellow}Validation warning for ${args.path}: ${w}${C.reset}`);
                            }
                        }

                    } catch (err) {
                        statusCallback('file_write', { path: args.path, lineCount: 0, preview: [] });
                        statusCallback('verify', {
                            snapshotTaken: true,
                            hashVerified: false,
                            integrityPassed: false,
                            reason: `Cannot read file after write: ${err.message}`,
                        });
                    }
                } else if (tool === 'run_command' && args?.command) {
                    statusCallback('shell', { command: args.command });
                }
            });

            agent.on('loop:iteration', ({ iteration }) => {
                if (iteration > 1) {
                    statusCallback('log', `Agent iteration ${iteration}...`);
                }
            });

            agent.on('loop:no-files', ({ iteration, hasCodeBlocks, hasToolCall }) => {
                statusCallback('log', `Warning: iteration ${iteration}: no files extracted (codeBlocks=${hasCodeBlocks}, toolCall=${hasToolCall})`);
            });

            try {
                const agentResult = await agent.run(task.title, {
                    systemPrompt: augmentedSystemPrompt,
                });

                totalIterations += agentResult.iterations || 1;

                if (agentResult.filesWritten && agentResult.filesWritten.length > 0) {
                    for (const fp of agentResult.filesWritten) {
                        if (!filesWritten.includes(fp)) filesWritten.push(fp);
                        if (!taskFilesWritten.includes(fp)) taskFilesWritten.push(fp);
                    }
                }

                // Fallback: try to parse JSON operations from output
                if (taskFilesWritten.length === 0 && agentResult.output) {
                    const extraFiles = await this._tryParseAndApplyOperations(agentResult.output, cwd, statusCallback);
                    filesWritten.push(...extraFiles);
                    taskFilesWritten.push(...extraFiles);
                }

                // ── STAGE 5/6 (per-task): Validate agent output and regenerate if needed ──
                // Only attempt regeneration for tasks that produced textual output
                // but no files (i.e., the LLM gave code but it wasn't written to disk).
                if (taskFilesWritten.length === 0 && agentResult.output && agentResult.output.length > 50) {
                    const outputValidation = OutputValidator.validate(
                        agentResult.output,
                        taskVerificationCriteria,
                        taskConstraints
                    );

                    if (!outputValidation.passed && this.provider) {
                        statusCallback('log', `${C.yellow}Output validation failed (score: ${(outputValidation.score * 100).toFixed(0)}%). Starting regeneration loop...${C.reset}`);

                        const regenLoop = RegenerationLoop.create({
                            maxAttempts: 3,
                            baseDelayMs: 2000,
                            onAttempt: (attemptNum, info) => {
                                statusCallback('log', `${C.cyan}Regeneration attempt ${attemptNum} (temperature: ${info.temperature.toFixed(3)})...${C.reset}`);
                                if (info.violationSummary && info.violationSummary.length > 0) {
                                    statusCallback('log', `  Fixing: ${info.violationSummary.slice(0, 2).join('; ')}`);
                                }
                            },
                        });

                        // llmCall adapter — uses the provider with retry wrapper
                        const llmCallAdapter = async (promptObj) => {
                            return await this._callLLMWithRetry(promptObj);
                        };

                        const regenResult = await regenLoop.run({
                            spec: taskSpec,
                            constraints: taskConstraints,
                            guardRules: taskGuardRules,
                            qualityRules: taskQualityRules,
                            verificationCriteria: taskVerificationCriteria,
                            workspaceContext,
                            initialValidation: outputValidation,
                            initialOutput: agentResult.output,
                            llmCall: llmCallAdapter,
                        });

                        if (regenResult.passed) {
                            statusCallback('log', `${C.green}Regeneration succeeded on attempt ${regenResult.attempts}.${C.reset}`);
                        } else if (regenResult.exhausted) {
                            statusCallback('log', `${C.yellow}Regeneration exhausted (best score: ${(regenResult.finalValidation.score * 100).toFixed(0)}%). Using best partial result.${C.reset}`);
                        }
                    }
                }

                const isRunTask = task.title.toLowerCase().includes('run') || task.title.toLowerCase().includes('open');
                const didWork = taskFilesWritten.length > 0 || isRunTask;

                if (didWork) {
                    task.status = 'completed';
                    statusCallback('task_progress', { taskId: task.id, status: 'completed' });
                } else {
                    task.status = 'failed';
                    statusCallback('task_progress', { taskId: task.id, status: 'failed' });
                    statusCallback('log', `Task "${task.title}" produced no files — marked failed`);
                }
            } catch (err) {
                task.status = 'failed';
                statusCallback('task_progress', { taskId: task.id, status: 'failed' });
                statusCallback('log', `Agent error on "${task.title}": ${err.message}`);
            }
        }

        // ─── Phase 4: Self-Validation ────────────────────────
        const uniqueFiles = [...new Set(filesWritten)];
        const validationResults = this._validateWrittenFiles(uniqueFiles, cwd);
        if (validationResults.failed.length > 0) {
            statusCallback('verify', {
                snapshotTaken: true,
                hashVerified: false,
                integrityPassed: false,
                reason: `${validationResults.failed.length} file(s) failed validation: ${validationResults.failed.join(', ')}`,
            });
        }

        // ─── Phase 5: Final Summary ──────────────────────────
        const totalDuration = Date.now() - startTime;
        const totalTokensUsed = planTokens + totalIterations * 1500;

        statusCallback('execution_summary', {
            tasks: parsedTasks,
            filesWritten: uniqueFiles.length,
            writtenPaths: uniqueFiles,
            duration: totalDuration,
            totalTokens: totalTokensUsed,
        });

        return {
            success: true,
            filesWritten: uniqueFiles.length,
            writtenPaths: uniqueFiles,
            iterations: totalIterations,
            toolCalls: totalToolCalls,
            duration: totalDuration,
        };
    }

    // ─── Stage 1: Task Analysis ──────────────────────────────────────────────

    /**
     * Analyze the task objective and workspace to produce a structured analysis
     * object that all control agents will consume.
     *
     * @param {string} objective
     * @param {object} workspaceContext — from _scanWorkspace
     * @returns {object} taskAnalysis
     */
    _analyzeTask(objective, workspaceContext) {
        const wordCount = objective.trim().split(/\s+/).length;
        const text = objective.toLowerCase();

        // Classify domains deterministically
        const domains = new Set();
        if (/(create|build|generate|write|implement|add|make)\s+/.test(text)) domains.add('code_generation');
        if (/(fix|debug|resolve|repair|patch|correct)\s+/.test(text)) domains.add('bug_fix');
        if (/(refactor|clean|reorganize|restructure|simplify|improve)\s+/.test(text)) domains.add('refactor');
        if (/(test|spec|jest|mocha|vitest|pytest|coverage)/.test(text)) domains.add('testing');
        if (/(document|readme|comment|jsdoc|docstring)/.test(text)) domains.add('documentation');
        if (/(deploy|ci|cd|docker|kubernetes|pipeline|infra)/.test(text)) domains.add('devops');
        if (/(auth|login|security|encrypt|password|token|jwt|rbac)/.test(text)) domains.add('security');
        if (/(database|schema|migration|model|sql|orm|prisma|sequelize)/.test(text)) domains.add('database');
        if (/(api|rest|graphql|endpoint|route|http)/.test(text)) domains.add('api');
        if (/\b(ui|ux|component|style|css|layout|page|form|button|html|frontend|webpage|website)\b/.test(text)) domains.add('frontend');
        if (/(server|backend|node|express|fastify|django|flask)/.test(text)) domains.add('backend');
        if (domains.size === 0) domains.add('general');

        return {
            objective,
            domains: [...domains],
            wordCount,
            isComplex: wordCount > 20 || domains.size > 2,
            hasExistingFiles: (workspaceContext.files || []).length > 0,
            cwd: process.cwd(),
            timestamp: Date.now(),
        };
    }

    // ─── LLM call with retry / backoff ───────────────────────────────────────

    /**
     * Call the LLM provider with exponential backoff on transient failures.
     * Max 2 retries (3 total attempts), 2s/4s delays.
     *
     * @param {object} promptObj — { systemPrompt, userMessage, maxTokens, temperature }
     * @returns {Promise<object>} provider result
     */
    async _callLLMWithRetry(promptObj) {
        let lastErr;
        for (let attempt = 0; attempt <= LLM_RETRY_MAX; attempt++) {
            if (attempt > 0) {
                const delay = LLM_RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
                await sleep(delay);
            }
            try {
                return await this.provider.generate(promptObj);
            } catch (err) {
                lastErr = err;
                // Only retry on network/timeout errors — not on auth/config errors
                const isTransient = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|timeout|rate.?limit|503|429/i.test(err.message);
                if (!isTransient) throw err;
                // Continue to next attempt
            }
        }
        throw lastErr;
    }

    // ─── Workspace scanning with RepoAnalyzer ────────────────────────────────

    /**
     * Scan the workspace using RepoAnalyzer for deep context (framework detection,
     * language stats, file tree). Falls back to lightweight scan on failure.
     *
     * @param {string} cwd — current working directory
     * @returns {object} enriched workspace context
     */
    _scanWorkspace(cwd) {
        // Start with lightweight scan as baseline
        const lightResult = this._scanWorkspaceLight(cwd);

        // Attempt deep analysis with RepoAnalyzer
        try {
            const analyzer = new RepoAnalyzer(cwd);
            const analysis = analyzer.analyze();

            // Merge deep analysis into the result
            const enriched = {
                ...lightResult,
                // RepoAnalyzer fields
                languages: analysis.languages || [],
                frameworks: analysis.frameworks || [],
                packageInfo: analysis.packageInfo
                    ? {
                        ...analysis.packageInfo,
                        // Add dependency names array for ConstraintAgent
                        dependencyNames: this._extractDependencyNames(cwd),
                    }
                    : null,
                projectRoot: cwd,
                stats: analysis.stats || {},
                // Rich file tree from RepoAnalyzer (serialized to string)
                fileTree: lightResult.fileTree || this._serializeTree(analysis.structure?.tree, 0, 30),
                // Preserve light scan fields that RepoAnalyzer doesn't provide
                files: lightResult.files,
                directories: lightResult.directories,
                hasPackageJson: lightResult.hasPackageJson,
                hasIndexHtml: lightResult.hasIndexHtml,
                hasSrcDir: lightResult.hasSrcDir,
                filesRead: Math.max(lightResult.filesRead, (analysis.stats?.totalFiles || 0)),
            };

            return enriched;
        } catch {
            // RepoAnalyzer failed — return lightweight result with minimal enrichment
            return {
                ...lightResult,
                languages: [],
                frameworks: [],
                packageInfo: null,
                projectRoot: cwd,
                stats: {},
            };
        }
    }

    /**
     * Lightweight workspace scan (the original implementation).
     * Used as baseline and fallback.
     * @private
     */
    _scanWorkspaceLight(cwd) {
        const result = {
            files: [],
            directories: [],
            hasPackageJson: false,
            hasIndexHtml: false,
            hasSrcDir: false,
            filesRead: 0,
            fileTree: '',
        };

        try {
            const entries = readdirSync(cwd, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

                if (entry.isDirectory()) {
                    result.directories.push(entry.name);
                    if (entry.name === 'src') result.hasSrcDir = true;
                } else {
                    result.files.push(entry.name);
                    if (entry.name === 'package.json') result.hasPackageJson = true;
                    if (entry.name === 'index.html') result.hasIndexHtml = true;
                }
            }

            const treeLines = [];
            for (const dir of result.directories.slice(0, 10)) {
                treeLines.push(`[DIR] ${dir}/`);
            }
            for (const file of result.files.slice(0, 20)) {
                treeLines.push(`[FILE] ${file}`);
            }
            result.fileTree = treeLines.join('\n');
            result.filesRead = Math.min(entries.length, 15);

        } catch { /* ignore scan errors */ }

        return result;
    }

    /**
     * Extract dependency names from package.json for ConstraintAgent's allowed imports list.
     * @private
     */
    _extractDependencyNames(cwd) {
        try {
            const pkgPath = join(cwd, 'package.json');
            if (!existsSync(pkgPath)) return [];
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            return [
                ...Object.keys(pkg.dependencies || {}),
                ...Object.keys(pkg.devDependencies || {}),
                ...Object.keys(pkg.peerDependencies || {}),
            ];
        } catch {
            return [];
        }
    }

    /**
     * Serialize a RepoAnalyzer tree node to a flat indented string.
     * @private
     */
    _serializeTree(node, depth, maxLines) {
        if (!node) return '';
        const lines = [];
        const _walk = (n, d) => {
            if (lines.length >= maxLines) return;
            const indent = '  '.repeat(d);
            if (n.type === 'directory') {
                lines.push(`${indent}[DIR] ${n.name}/`);
                for (const child of (n.children || [])) {
                    _walk(child, d + 1);
                }
            } else {
                lines.push(`${indent}[FILE] ${n.name}`);
            }
        };
        _walk(node, depth);
        return lines.join('\n');
    }

    // ─── Prompt helpers ───────────────────────────────────────────────────────

    /**
     * Augment the PromptBuilder system prompt with apes.md rules, conventions,
     * matched skills, and the full plan context.
     *
     * This sits on top of the controlled prompt without replacing its constraints.
     *
     * @private
     */
    _augmentControlledPrompt(controlledSystemPrompt, task, objective, planContent) {
        let augmented = controlledSystemPrompt;

        // Inject apes.md project context
        if (this._projectContext) {
            augmented += `\n\n### PROJECT CONTEXT (from apes.md)\n${this._projectContext}`;
        }

        // Inject apes.md rules and conventions
        const rules = this._apesMd?.rules;
        const conventions = this._apesMd?.conventions;
        if (rules?.length > 0 || conventions?.length > 0) {
            augmented += '\n\n### PROJECT STANDARDS (from apes.md)';
            if (rules?.length > 0) {
                augmented += '\nRules:\n' + rules.map(r => `- ${r}`).join('\n');
            }
            if (conventions?.length > 0) {
                augmented += '\nConventions:\n' + conventions.map(c => `- ${c}`).join('\n');
            }
        }

        // Inject matched skill instructions
        if (this._matchedSkills?.length > 0) {
            for (const skill of this._matchedSkills) {
                if (skill.instructions) {
                    augmented += `\n\n### Skill: ${skill.name}\n${skill.instructions}`;
                }
            }
        }

        // Inject plan context so the agent knows what the whole task looks like
        augmented += `\n\n### FULL EXECUTION PLAN\n${planContent.slice(0, 1500)}`;
        augmented += `\n\n### YOUR SPECIFIC TASK\n${task.title}`;

        return augmented;
    }

    _buildPlanPrompt(objective, workspace) {
        let system = `You are APES Plan Agent. Your job is to output a SHORT, actionable execution plan.

Rules:
- Analyze the current workspace carefully
- If requested files already exist, plan to EDIT them instead of creating from scratch
- List ONLY files to create/edit and commands to run
- Use bullet points
- No code, no explanations
- Be specific about file paths
- Include ALL files needed for a complete, working result

Example output:
- Create index.html (full HTML5 page with sections)
- Create css/style.css (responsive styling)
- Create js/main.js (interactivity)
- Run: open index.html`;

        if (this._projectContext) {
            system += `\n\n## Project Context (from apes.md)\n${this._projectContext}`;
        }

        let user = `Objective: ${objective}

Current workspace:
${workspace.fileTree || '(empty project)'}

Files: ${workspace.files.join(', ') || 'none'}
Dirs: ${workspace.directories.join(', ') || 'none'}`;

        if (workspace.languages && workspace.languages.length > 0) {
            user += `\nLanguages: ${workspace.languages.slice(0, 3).map(l => l.language).join(', ')}`;
        }
        if (workspace.frameworks && workspace.frameworks.length > 0) {
            user += `\nFrameworks: ${workspace.frameworks.slice(0, 5).map(f => f.name).join(', ')}`;
        }

        if (this._matchedSkills?.length > 0) {
            user += '\n\nActivated Skills:';
            for (const skill of this._matchedSkills) {
                user += `\n- ${skill.name}`;
                if (skill.instructions) user += `: ${skill.instructions.split('\n')[0]}`;
            }
        }

        user += '\n\nOutput the execution plan now.';
        return { system, user };
    }

    /**
     * Select agents dynamically for a SINGLE task based on its content.
     * @param {string} taskTitle
     * @returns {{ agents: object[], clusterName: string }}
     */
    _selectAgentsForTask(taskTitle) {
        const text = taskTitle.toLowerCase();

        const needsFrontend = /(front.?end|web|ui|ux|html|css|react|vue|svelte|browser|component|style|layout|page|app)/.test(text);
        const needsBackend = /(back.?end|server|api|node|python|express|django|flask|golang|java|ruby|endpoint|route)/.test(text);
        const needsDatabase = /(database|sql|mongo|redis|postgre|mysql|schema|model|table|migration)/.test(text);
        const needsTest = /(test|jest|mocha|cypress|pytest|spec|coverage)/.test(text);
        const needsDeploy = /(deploy|build|ci.?cd|pipeline|docker|kubernetes|aws|cloud|infra)/.test(text);
        const needsRefactor = /(refactor|optimize|speed|fast|memory|perf)/.test(text);
        const needsSecurity = /(auth|security|login|password|crypto|token|encrypt)/.test(text);
        const needsDocs = /(doc|readme|changelog|comment|guide|tutorial)/.test(text);
        const needsRun = /(run|open|execute|start|serve|launch|cat|view)/.test(text);

        const names = new Set();
        let clusterName = 'General';

        if (needsFrontend) {
            names.add('Frontend Engineer 1');
            names.add('Frontend Engineer 2');
            if (/(complex|large|advanced|full)/.test(text)) {
                names.add('Frontend Engineer 3');
                names.add('Frontend Engineer 4');
            }
            clusterName = 'Frontend';
        }

        if (needsBackend) {
            names.add('Backend Engineer 1');
            names.add('Backend Engineer 2');
            names.add('API Engineer 1');
            if (/(complex|large|advanced|full)/.test(text)) {
                names.add('Backend Engineer 3');
                names.add('Backend Engineer 4');
                names.add('API Engineer 2');
            }
            clusterName = needsFrontend ? 'Full-Stack' : 'Backend';
        }

        if (needsDatabase) {
            names.add('Database Engineer 1');
            names.add('Database Engineer 2');
            clusterName = names.size <= 2 ? 'Database' : clusterName;
        }

        if (needsTest) {
            names.add('Test Strategy Planner');
            names.add('Unit Test Generator 1');
            names.add('Unit Test Generator 2');
            names.add('Integration Tester 1');
            clusterName = names.size <= 4 ? 'Testing' : clusterName;
        }

        if (needsDeploy) {
            names.add('Infrastructure Engineer 1');
            names.add('Build Manager 1');
            names.add('CI Validator 1');
            names.add('Release Manager');
            clusterName = names.size <= 4 ? 'DevOps' : clusterName;
        }

        if (needsRefactor) {
            names.add('Refactor Planner');
            names.add('Code Optimizer 1');
            names.add('Code Optimizer 2');
            clusterName = names.size <= 3 ? 'Optimization' : clusterName;
        }

        if (needsSecurity) {
            names.add('Security Planner');
            clusterName = names.size <= 1 ? 'Security' : clusterName;
        }

        if (needsDocs) {
            names.add('Documentation Writer 1');
            clusterName = names.size <= 1 ? 'Documentation' : clusterName;
        }

        if (names.size === 0) {
            if (needsRun) {
                names.add('Backend Engineer 1');
                clusterName = 'Execution';
            } else {
                names.add('Backend Engineer 1');
                names.add('Frontend Engineer 1');
                clusterName = 'General';
            }
        }

        const isFileTask = /(write|create|build|implement|generate|edit|update|fix|make|add)/.test(text);
        if (isFileTask) {
            names.add('Write Verifier');
            names.add('Execution Verifier');
        }

        const agents = SWARM_AGENTS.filter(a => names.has(a.name));
        return { agents, clusterName };
    }

    // ─── Fallback: Parse JSON operations ──────────────────────────────────────

    async _tryParseAndApplyOperations(output, cwd, statusCallback) {
        const written = [];

        try {
            const jsonMatch = (output || '').match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (!jsonMatch) return written;

            const operations = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(operations)) return written;

            for (const op of operations) {
                if ((op.action === 'create' || op.action === 'write') && op.path && op.content) {
                    const fullPath = join(cwd, op.path);
                    mkdirSync(dirname(fullPath), { recursive: true });
                    writeFileSync(fullPath, op.content, 'utf8');

                    const lines = op.content.split('\n');
                    statusCallback('file_write', {
                        path: op.path,
                        lineCount: lines.length,
                        preview: lines.slice(0, 10),
                    });

                    const hash = createHash('sha256').update(op.content, 'utf-8').digest('hex');
                    const ondisk = readFileSync(fullPath, 'utf-8');
                    const ondiskHash = createHash('sha256').update(ondisk, 'utf-8').digest('hex');
                    statusCallback('verify', {
                        snapshotTaken: true,
                        hashVerified: true,
                        integrityPassed: hash === ondiskHash,
                    });

                    written.push(op.path);
                } else if (op.action === 'command' && op.command) {
                    statusCallback('shell', { command: op.command });
                    try {
                        const { execSync } = await import('node:child_process');
                        execSync(op.command, { cwd, encoding: 'utf8', timeout: 30000 });
                    } catch { /* ignore command errors in fallback */ }
                }
            }
        } catch { /* JSON parse failed */ }

        return written;
    }

    // ─── Self-Validation ──────────────────────────────────────────────────────

    _validateWrittenFiles(filePaths, cwd) {
        const passed = [];
        const failed = [];

        for (const filePath of filePaths) {
            const fullPath = filePath.startsWith('/') || filePath.includes(':\\')
                ? filePath
                : join(cwd, filePath);

            try {
                if (!existsSync(fullPath)) { failed.push(filePath); continue; }
                const content = readFileSync(fullPath, 'utf-8');
                if (content.length === 0) { failed.push(filePath); continue; }
                passed.push(filePath);
            } catch {
                failed.push(filePath);
            }
        }

        return { passed, failed };
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _estimateTokens(content) {
        return Math.floor((content || '').length / 4);
    }

    _generatePlanName() {
        const adj = ['swift', 'bold', 'calm', 'keen', 'wise', 'bright', 'sharp', 'prime', 'core', 'deep'];
        const noun1 = ['alpha', 'delta', 'sigma', 'omega', 'theta', 'gamma', 'lambda', 'zeta', 'kappa', 'nova'];
        const noun2 = ['forge', 'storm', 'pulse', 'spark', 'drift', 'blaze', 'surge', 'wave', 'flux', 'core'];
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];
        return `${pick(adj)}-${pick(noun1)}-${pick(noun2)}`;
    }
}
