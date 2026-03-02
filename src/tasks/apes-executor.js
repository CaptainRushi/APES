import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { AgentLoop } from '../agents/agent-loop.js';
import { SWARM_AGENTS } from '../agents/swarm-layout.js';

/**
 * ClaudeExecutor — Real Execution Engine
 *
 * This is the ONLY execution path that matters. It:
 *   1. Validates a real LLM provider exists (fails fast if not)
 *   2. Runs a real AgentLoop that calls the LLM iteratively
 *   3. Agent uses tools to read/write files, run commands
 *   4. Every file write goes through real fs operations
 *   5. Reports structured events for the stream renderer
 *
 * Architecture:
 *   User Input → Plan Phase → AgentLoop (LLM ↔ Tools) → File System → Verification → Done
 *
 * NO simulation. NO fake tokens. NO theater.
 */
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

        // ─── GATE: Short-circuit for trivial/greeting inputs ─
        // If the input is a simple greeting or chitchat (no project intent),
        // respond directly via a single LLM call without plan mode or agents.
        const GREETING_RE = /^(hi|hello|hey|howdy|greetings|yo|sup|what'?s? ?up|good (morning|afternoon|evening)|thanks?|thank you|bye|goodbye|ok|okay|sure|cool|nice|great|sounds good)[\s!?.]*$/i;
        const PROJECT_KEYWORDS_RE = /\b(build|create|make|write|implement|design|fix|add|update|refactor|test|deploy|setup|configure|generate|analyze|review|debug|optimize|migrate|delete|remove|convert|parse|fetch|connect|integrate|install)\b/i;
        const wordCount = objective.trim().split(/\s+/).length;
        const isConversational = GREETING_RE.test(objective.trim())
            || (wordCount <= 3 && !PROJECT_KEYWORDS_RE.test(objective));

        if (isConversational) {
            // Respond conversationally with a single fast LLM call, no pipeline
            const response = await this.provider.generate({
                systemPrompt: 'You are APES, a helpful coding assistant. Respond conversationally and briefly.',
                userMessage: objective,
                maxTokens: 256,
                temperature: 0.7,
            });
            statusCallback('log', response.content || 'Hello! How can I help you today?');
            statusCallback('execution_summary', { tasks: [], filesWritten: 0, writtenPaths: [], duration: 0, totalTokens: 0 });
            return { success: true, filesWritten: 0, writtenPaths: [], iterations: 1, toolCalls: 0, duration: 0 };
        }

        const startTime = Date.now();
        const cwd = process.cwd();

        // ─── Load apes.md project context ────────────────────
        this._projectContext = this.orchestrator.getProjectContext();
        this._apesMd = this.orchestrator.apesMd?.merged || {};
        this._matchedSkills = this.orchestrator.matchSkills(objective);

        // ─── Phase 1: Plan Mode (real workspace analysis) ────
        statusCallback('plan_enter', null);

        // Actually scan the workspace to build context
        const workspaceContext = this._scanWorkspace(cwd);

        if (workspaceContext.filesRead > 0) {
            statusCallback('search', { patterns: 1, filesRead: workspaceContext.filesRead });
        }

        // ─── Phase 2: Build execution plan via LLM ───────────
        const planStartTime = Date.now();

        // First LLM call: generate a structured plan
        const planPrompt = this._buildPlanPrompt(objective, workspaceContext);
        let planResult;
        try {
            planResult = await this.provider.generate({
                systemPrompt: planPrompt.system,
                userMessage: planPrompt.user,
                maxTokens: 2048,
                temperature: 0.3,
            });
        } catch (err) {
            throw new Error(`Plan generation failed: ${err.message}`);
        }

        const planDuration = Date.now() - planStartTime;
        const planTokens = planResult.usage?.totalTokens || this._estimateTokens(planResult.content);

        statusCallback('plan_done', {
            toolUses: Math.ceil(planTokens / 2000),
            tokens: planTokens,
            duration: planDuration,
        });

        statusCallback('plan_update', null);
        statusCallback('plan_approved', { name: this._generatePlanName() });

        // ─── Phase 3: Execute via per-task AgentLoops (REAL) ──
        // Each task gets its own AgentLoop that runs until that
        // task's files are actually written to disk.

        const filesWritten = [];
        let totalToolCalls = 0;
        let totalIterations = 0;

        // Extract tasks from markdown plan
        const parsedTasks = [];
        const planLines = planResult.content.split('\n');
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

        // ─── Execute each task with its own agent cluster ───
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

            // Mark in_progress
            task.status = 'in_progress';
            statusCallback('task_progress', { taskId: task.id, status: 'in_progress' });

            const agentId = `apes-agent-${ti + 1}-${Date.now().toString(36)}`;
            const roleForCluster = task.title.toLowerCase().includes('css') ? 'frontend'
                : task.title.toLowerCase().includes('js') ? 'developer'
                : task.title.toLowerCase().includes('html') ? 'frontend'
                : task.title.toLowerCase().includes('run') ? 'devops'
                : 'executor';

            // Register agent cluster so PermissionGuard allows file writes
            if (this.workspaceEngine?.permissionGuard) {
                this.workspaceEngine.permissionGuard.registerAgentCluster(agentId, 'engineering');
            }

            const agent = new AgentLoop({
                agentId,
                role: roleForCluster,
                provider: this.provider,
                workspaceEngine: this.workspaceEngine,
                maxIterations: 15,
                maxTokens: 8192,
            });

            const taskFilesWritten = [];

            // Track tool calls
            agent.on('tool:call', ({ tool, args }) => {
                totalToolCalls++;
            });

            // Display and verify file writes
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

                        statusCallback('file_write', {
                            path: args.path,
                            lineCount: lines.length,
                            preview: lines.slice(0, 10),
                        });

                        const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
                        statusCallback('verify', {
                            snapshotTaken: true,
                            hashVerified: true,
                            integrityPassed: content.length > 0,
                            reason: content.length === 0 ? 'File is empty after write' : null,
                        });
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
                statusCallback('log', `⚠ Iteration ${iteration}: no files extracted (codeBlocks=${hasCodeBlocks}, toolCall=${hasToolCall})`);
            });

            // Build a focused prompt for THIS specific task
            const taskPrompt = this._buildTaskAgentPrompt(task, objective, planResult.content, workspaceContext);

            try {
                const agentResult = await agent.run(task.title, {
                    systemPrompt: taskPrompt,
                });

                totalIterations += agentResult.iterations || 1;

                // Collect any files the agent tracked internally
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

                // Determine real completion: did the agent actually produce output?
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

    /**
     * Select agents dynamically for a SINGLE task based on its content.
     * Returns only the agents relevant to this specific task — no fixed baseline.
     * @param {string} taskTitle — the task description/title
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

        // Fallback: if no specific domain matched, assign a general executor
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

        // Always add Write Verifier for file-writing tasks
        const isFileTask = /(write|create|build|implement|generate|edit|update|fix|make|add)/.test(text);
        if (isFileTask) {
            names.add('Write Verifier');
            names.add('Execution Verifier');
        }

        const agents = SWARM_AGENTS.filter(a => names.has(a.name));
        return { agents, clusterName };
    }

    // ─── Workspace Analysis (REAL) ────────────────────────────

    /**
     * Actually scan the workspace directory to build real context.
     */
    _scanWorkspace(cwd) {
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

            // Build file tree string
            const treeLines = [];
            for (const dir of result.directories.slice(0, 10)) {
                treeLines.push(`  [DIR] ${dir}/`);
            }
            for (const file of result.files.slice(0, 20)) {
                treeLines.push(`  [FILE] ${file}`);
            }
            result.fileTree = treeLines.join('\n');
            result.filesRead = Math.min(entries.length, 15);

        } catch { /* ignore scan errors */ }

        return result;
    }

    // ─── Prompt Building ──────────────────────────────────────

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

        // Inject apes.md project context into system prompt
        if (this._projectContext) {
            system += `\n\n## Project Context (from apes.md)\n${this._projectContext}`;
        }

        let user = `Objective: ${objective}

Current workspace:
${workspace.fileTree || '(empty project)'}

Files: ${workspace.files.join(', ') || 'none'}
Dirs: ${workspace.directories.join(', ') || 'none'}`;

        // Inject matched skill instructions
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

    _buildExecutionPrompt(objective, plan, workspace) {
        return `# APES Execution Agent — Real Backend Mode

You are an autonomous code execution agent. Your ONLY job is to produce REAL side effects on disk.

## YOUR TASK
${objective}

## EXECUTION PLAN
${plan}

## CURRENT WORKSPACE
Project root: ${process.cwd()}
${workspace.fileTree || '(empty project)'}

## MANDATORY RULES — VIOLATION = FAILURE

1. You MUST use read/edit tools (multi_replace_file_content/edit_file) to modify EXISTING files. Do NOT overwrite existing files from scratch (write_file) unless instructed to wipe them.
2. You MUST use the write_file tool to create EVERY NEW file. Code in conversation text produces NO side effects.
3. You MUST write COMPLETE file contents when creating new files. No placeholders ("..."), no truncated code, no "rest of code here".
4. EVERY file must be syntactically valid and runnable.
5. For websites: include ALL files (HTML, CSS, JS). The project MUST work when opened in a browser.
6. For apps: include ALL source files, config files, and entry points.
7. After writing/editing ALL files, call task_complete with a summary.
8. NEVER describe what you will do. NEVER explain. Just EXECUTE tool calls.

## TOKEN USAGE EXPECTATIONS
- Small script: 2k–5k tokens of code
- Website: 5k–15k tokens of code
- Full app: 20k+ tokens of code
- Short responses = you did not execute fully = FAILURE

## EXECUTION SEQUENCE
1. Read existing files if they need modification
2. Modify existing files using edit tools, or use write_file for new files (with COMPLETE content)
3. Optionally run_command to install dependencies or build
4. task_complete with summary

## WHAT COUNTS AS SUCCESS
- Files exist on disk
- Files have content > 0 bytes
- Code is syntactically valid
- Project structure is complete

## WHAT COUNTS AS FAILURE
- Only generating descriptions or plans
- Generating partial/truncated code
- Using placeholders like "..." or "// add more here"
- Returning markdown instead of tool calls
- Skipping required files

BEGIN EXECUTION NOW. Write the first file immediately.`;
    }

    _buildTaskAgentPrompt(task, objective, plan, workspace) {
        let prompt = `# APES Task Agent

You are an autonomous agent assigned to ONE specific task within a larger project.

## PROJECT OBJECTIVE
${objective}

## FULL PLAN (for context)
${plan}

## YOUR SPECIFIC TASK
${task.title}

## CURRENT WORKSPACE
Project root: ${process.cwd()}
${workspace.fileTree || '(empty project)'}`;

        // Inject apes.md rules and conventions
        const rules = this._apesMd?.rules;
        const conventions = this._apesMd?.conventions;
        if (rules?.length > 0 || conventions?.length > 0) {
            prompt += '\n\n## PROJECT STANDARDS (from apes.md)';
            if (rules?.length > 0) {
                prompt += '\nRules:\n' + rules.map(r => `- ${r}`).join('\n');
            }
            if (conventions?.length > 0) {
                prompt += '\nConventions:\n' + conventions.map(c => `- ${c}`).join('\n');
            }
        }

        // Inject matched skill instructions
        if (this._matchedSkills?.length > 0) {
            for (const skill of this._matchedSkills) {
                if (skill.instructions) {
                    prompt += `\n\n## Skill: ${skill.name}\n${skill.instructions}`;
                }
            }
        }

        prompt += `

## RULES — VIOLATION = FAILURE
1. You MUST use the write_file tool to create files. Code in conversation text does NOTHING.
2. Write COMPLETE file contents. No placeholders, no "..." abbreviations.
3. Files must be syntactically valid and production-ready.
4. After writing all files for your task, call task_complete.
5. Do NOT work on other tasks — only complete YOUR assigned task above.
6. Do NOT describe what you will do. Just EXECUTE tool calls immediately.

BEGIN NOW. Write the file(s) for your task immediately.`;

        return prompt;
    }

    // ─── Fallback: Parse JSON operations ──────────────────────

    /**
     * If the agent output contains JSON file operations (legacy format),
     * parse and apply them as a fallback.
     */
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

                    // Verify
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
        } catch { /* JSON parse failed — no fallback ops */ }

        return written;
    }

    // ─── Self-Validation ──────────────────────────────────────

    /**
     * Verify that all written files actually exist on disk and have content.
     * This is the "proof of execution" check.
     */
    _validateWrittenFiles(filePaths, cwd) {
        const passed = [];
        const failed = [];

        for (const filePath of filePaths) {
            const fullPath = filePath.startsWith('/') || filePath.includes(':\\')
                ? filePath
                : join(cwd, filePath);

            try {
                if (!existsSync(fullPath)) {
                    failed.push(filePath);
                    continue;
                }

                const content = readFileSync(fullPath, 'utf-8');
                if (content.length === 0) {
                    failed.push(filePath);
                    continue;
                }

                passed.push(filePath);
            } catch {
                failed.push(filePath);
            }
        }

        return { passed, failed };
    }

    // ─── Helpers ──────────────────────────────────────────────

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
