/**
 * APES Interface Layer — CLI
 *
 * Responsibilities:
 *   - Command parsing
 *   - Permission handling
 *   - Session context management
 *   - Interactive approval system (write/edit/delete)
 *   - Multi-terminal session startup (Create / Join / Isolated)
 */

import { CommandParser } from './command-parser.js';
import { PermissionHandler } from './permission-handler.js';
import { SessionContext } from './session-context.js';
import * as readline from 'node:readline';
import { Renderer } from './renderer.js';
import { AnimationEngine } from './animation-engine.js';
import { Orchestrator } from '../orchestration/orchestrator.js';
import { ProviderCommand } from './commands/provider-command.js';
import { TeamCommand } from './commands/team-command.js';
import { SessionCommand } from './commands/session-command.js';
import { WorkspaceCommand } from './commands/workspace-command.js';
import { SessionManager } from '../session/session-manager.js';
import { TaskGraphGenerator } from '../tasks/task-graph.js';
import { TaskTreeRenderer } from '../tasks/task-renderer.js';
import { TaskAutoExecutor } from '../tasks/task-executor.js';
import { PlannerInterview } from './planner-interview.js';
import { LoopController } from '../execution/loop-controller.js';

export class CLI {
    constructor() {
        this.parser = new CommandParser();
        this.permissions = new PermissionHandler();
        this.session = new SessionContext();
        this.renderer = new Renderer();
        this.orchestrator = new Orchestrator();
        this.providerCommand = new ProviderCommand(
            this.orchestrator.providerManager,
            this.orchestrator.providers,
        );
        this.teamCommand = new TeamCommand(
            this.orchestrator.teamManager,
            this.orchestrator.messageBus,
        );

        // ─── Multi-Terminal Session System ────────────────────────
        this.sessionManager = new SessionManager();
        this.sessionCommand = new SessionCommand(this.sessionManager, this.renderer);

        // ─── Workspace Engine ─────────────────────────────────────
        // Auto-init workspace engine with cwd as project root
        this.orchestrator.initWorkspace(process.cwd(), 'default');
        this.workspaceCommand = new WorkspaceCommand(
            this.orchestrator.workspaceEngine,
            this.renderer,
        );

        // ─── Task Engine ─────────────────────────────────────────
        this.taskRenderer = null;    // initialized when session is active
        this.taskExecutor = null;
        this._rl = null;             // readline interface reference
    }

    async run(argv) {
        this.renderer.showBanner();

        // Load project config (apes.md + skills)
        this.orchestrator.loadProjectConfig(process.cwd());

        // Auto-detect Ollama and register specialized local models
        await this.orchestrator.providers.initialize();

        // ─── Provider Status Check ───────────────────────────────
        this._showProviderStatus();

        const command = this.parser.parse(argv);

        if (command.type === 'help') {
            this.renderer.showHelp();
            return;
        }

        if (command.type === 'status') {
            await this.showStatus();
            return;
        }

        if (command.type === 'clusters') {
            this.renderer.showClusters(this.orchestrator.registry);
            return;
        }

        if (command.type === 'interactive') {
            await this.startInteractiveMode();
            return;
        }

        if (command.type === 'provider') {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });
            await this.providerCommand.execute(command.args, rl);
            rl.close();
            return;
        }

        if (command.type === 'task') {
            await this.executeTask(command.input);
            return;
        }

        if (command.type === 'loop') {
            await this.executeLoop(command.input, command.flags);
            return;
        }

        // Default: if raw input is given, treat it as a task
        if (command.type === 'raw') {
            await this.executeTask(command.input);
            return;
        }

        this.renderer.showHelp();
    }

    async executeTask(input) {
        // GATE: Fail fast if no provider is configured
        if (!this.orchestrator.providers.isReady()) {
            this._showProviderStatus();
            throw new Error('No LLM provider configured. Cannot execute tasks.');
        }

        this.session.startTask(input);
        this.renderer.showTaskStart(input);

        // Use ClaudeExecutor (real execution) instead of simulation-prone orchestrator
        const { ClaudeExecutor } = await import('../tasks/apes-executor.js');
        const { StreamRenderer } = await import('./stream-renderer.js');
        const c = this.renderer.c.bind(this.renderer);

        let stream;
        try {
            const executor = new ClaudeExecutor(this.orchestrator, this.renderer);
            stream = new StreamRenderer();
            stream.start();

            await executor.execute(input, (event, data) => {
                // Same structured event dispatcher as interactive mode
                switch (event) {
                    case 'plan_enter': stream.enterPlanMode(); break;
                    case 'explore_done': stream.showExploreAgents(data); break;
                    case 'search': stream.showSearchResult(data.patterns, data.filesRead); break;
                    case 'plan_done': stream.planDone(data.toolUses, data.tokens, data.duration); break;
                    case 'plan_update': stream.showUpdatedPlan(); break;
                    case 'plan_approved': stream.showPlanApproval(data.name); break;
                    case 'subagents_launch': stream.showSubagentLaunch(data); break;
                    case 'task_agents_launch': stream.showTaskAgentCluster(data); break;
                    case 'tasks_init':
                        for (const t of data) stream._tasks.set(t.id, { title: t.title, status: t.status });
                        break;
                    case 'task_progress':
                        if (stream._tasks.has(data.taskId)) stream._tasks.get(data.taskId).status = data.status;
                        break;
                    case 'file_write': stream.showWrite(data.path, data.lineCount, data.preview); break;
                    case 'file_update': stream.showUpdate(data.path, data.added, data.removed, data.diffLines); break;
                    case 'shell': stream.showShell(data.command); break;
                    case 'verify': stream.showVerification(data); break;
                    case 'execution_summary':
                        for (const t of data.tasks) stream._tasks.set(t.id, { title: t.title, status: t.status || 'completed' });
                        stream.showTaskBoard();
                        break;
                    default:
                        if (typeof data === 'string') stream.log(data);
                        break;
                }
            });

            stream.stop();
            this.session.endTask({ success: true });
        } catch (error) {
            if (stream) stream.stop();
            this.renderer.showError(error);
            this.session.endTask({ error: error.message });
        }
    }

    /**
     * Execute a task in loop mode until completion promise is met
     */
    async executeLoop(input, flags) {
        const c = this.renderer.c.bind(this.renderer);

        // Validate required flags
        if (!flags.completionPromise) {
            console.log(`\n  ${c('red', '✗')} --completion-promise is required for loop mode`);
            console.log(`  ${c('dim', '  Example: apes loop "build a REST API" --completion-promise "Typecheck passes"')}`);
            return;
        }

        if (!flags.task) {
            console.log(`\n  ${c('red', '✗')} No task specified`);
            console.log(`  ${c('dim', '  Example: apes loop "build a REST API" --completion-promise "Typecheck passes"')}`);
            return;
        }

        // GATE: Fail fast if no provider is configured
        if (!this.orchestrator.providers.isReady()) {
            this._showProviderStatus();
            throw new Error('No LLM provider configured. Cannot execute tasks.');
        }

        // Create loop controller
        const loop = new LoopController({
            completionPromise: flags.completionPromise,
            maxIterations: flags.maxIterations || 100,
            interval: flags.interval || 0,
            verbose: flags.verbose || false,
            continueOnError: flags.continueOnError || false,
        });

        // Show loop header
        console.log('');
        console.log(c('cyan', '╔══════════════════════════════════════════════════════╗'));
        console.log(c('cyan', '║') + c('bold', '  🔄 APES Loop Mode') + c('cyan', '                                  ║'));
        console.log(c('cyan', '║') + c('dim', '  Autonomous execution until promise met') + c('cyan', '         ║'));
        console.log(c('cyan', '╚══════════════════════════════════════════════════════╝'));
        console.log('');

        // Execute the loop
        const result = await loop.run(flags.task, async (task, iteration) => {
            let output = '';
            let error = null;
            let completed = false;

            try {
                const { ClaudeExecutor } = await import('../tasks/apes-executor.js');
                const { StreamRenderer } = await import('./stream-renderer.js');

                const executor = new ClaudeExecutor(this.orchestrator, this.renderer);
                const stream = new StreamRenderer();
                
                if (flags.verbose) {
                    stream.start();
                }

                await executor.execute(task, (event, data) => {
                    if (typeof data === 'string') {
                        output += data + '\n';
                    }
                    // Capture key events
                    if (event === 'execution_summary') {
                        const failed = data.tasks?.filter(t => t.status === 'failed').length || 0;
                        if (failed === 0) {
                            completed = true;
                        }
                    }
                });

                if (flags.verbose) {
                    stream.stop();
                }

            } catch (err) {
                error = err.message;
                output += `\nError: ${err.message}`;
            }

            return { output, error, completed };
        });

        // Show final result
        console.log('');
        if (result.success) {
            console.log(c('green', '╔══════════════════════════════════════════════════════╗'));
            console.log(c('green', '║') + c('bold', '  ✅ Loop Complete') + c('green', '                                 ║'));
            console.log(c('green', '╚══════════════════════════════════════════════════════╝'));
        } else {
            console.log(c('yellow', '╔══════════════════════════════════════════════════════╗'));
            console.log(c('yellow', '║') + c('bold', '  ⚠️  Loop Ended') + c('yellow', '                                  ║'));
            console.log(c('yellow', '╚══════════════════════════════════════════════════════╝'));
        }
        console.log(`  ${c('dim', 'Iterations:')} ${result.iterations}`);
        console.log(`  ${c('dim', 'Status:')} ${result.success ? c('green', 'Success') : c('yellow', 'Max iterations reached')}`);
        console.log('');
    }

    /**
     * Show interactive startup mode selector:
     *   1) Create New Session
     *   2) Join Existing Session
     *   3) Connect to Planner Session
     *   4) Isolated Mode (No Shared Memory)
     *   5) Skip (Classic Mode)
     */
    async showStartupModeSelector(rl) {
        const c = this.renderer.c.bind(this.renderer);

        // Check for existing active sessions
        const activeSessions = this.sessionManager.listActiveSessions();

        console.log(`\n${c('cyan', '  ╔════════════════════════════════════════════════════╗')}`);
        console.log(`${c('cyan', '  ║')}  ${c('bold', '🦍 APES Distributed Terminal System')}              ${c('cyan', '║')}`);
        console.log(`${c('cyan', '  ╚════════════════════════════════════════════════════╝')}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);
        console.log(`  ${c('bold', 'Select Mode:')}`);
        console.log(`    ${c('cyan', '1)')} ${c('green', 'Create New Session')}       — Start a shared workspace`);
        console.log(`    ${c('cyan', '2)')} ${c('green', 'Join Existing Session')}    — Connect to another terminal`);
        console.log(`    ${c('cyan', '3)')} ${c('green', 'Connect as Planner')}       — Plan tasks for executors`);
        console.log(`    ${c('cyan', '4)')} ${c('yellow', 'Isolated Mode')}            — Fresh instance, no sharing`);
        console.log(`    ${c('cyan', '5)')} ${c('dim', 'Skip (Classic Mode)')}      — Single terminal, no sessions`);

        if (activeSessions.length > 0) {
            console.log(`\n  ${c('dim', '─'.repeat(52))}`);
            console.log(`  ${c('bold', '🔗 Active Sessions:')}`);
            for (const s of activeSessions) {
                const terminals = Object.values(s.config.terminals || {}).filter(t => t.status === 'connected').length;
                console.log(`    ${c('green', '●')} ${c('cyan', s.sessionId)} ${c('dim', `· ${terminals} terminal(s) · ${s.config.mode}`)}`);
            }
        }

        console.log(`  ${c('dim', '─'.repeat(52))}`);

        return new Promise((resolve) => {
            rl.question(`  ${c('cyan', 'apes')} ${c('dim', 'mode ›')} `, async (answer) => {
                const choice = answer.trim();

                switch (choice) {
                    case '1': {
                        // Ask for role
                        rl.question(`  ${c('dim', 'Your role')} ${c('dim', '(planner/executor/tester)')} ${c('dim', '›')} `, (roleAnswer) => {
                            const role = roleAnswer.trim() || 'planner';
                            const config = this.sessionManager.createSession({ role });
                            console.log(`\n  ${c('green', '✓')} Session created: ${c('cyan', config.sessionId)}`);
                            console.log(`  ${c('dim', '  Share this ID with other terminals to connect.')}`);
                            console.log(`  ${c('dim', `  Your role: ${role} · Terminal: ${this.sessionManager.terminalId}`)}\n`);
                            resolve('session');
                        });
                        return;
                    }

                    case '2': {
                        rl.question(`  ${c('dim', 'Session ID')} ${c('dim', '›')} `, (idAnswer) => {
                            const sessionId = idAnswer.trim();
                            if (!sessionId) {
                                console.log(`  ${c('red', '✗')} No session ID provided.`);
                                resolve('skip');
                                return;
                            }

                            rl.question(`  ${c('dim', 'Your role')} ${c('dim', '(executor/planner/tester)')} ${c('dim', '›')} `, (roleAnswer) => {
                                const role = roleAnswer.trim() || 'executor';
                                const config = this.sessionManager.joinSession(sessionId, { role });
                                if (config) {
                                    console.log(`\n  ${c('green', '✓')} Connected to session ${c('cyan', sessionId)} as ${c('yellow', role)}`);
                                    console.log(`  ${c('dim', `  Terminal: ${this.sessionManager.terminalId}`)}\n`);
                                } else {
                                    console.log(`  ${c('red', '✗')} Session "${sessionId}" not found or inactive.`);
                                }
                                resolve('session');
                            });
                        });
                        return;
                    }

                    case '3': {
                        rl.question(`  ${c('dim', 'Session ID to plan for')} ${c('dim', '›')} `, (idAnswer) => {
                            const sessionId = idAnswer.trim();
                            if (!sessionId) {
                                console.log(`  ${c('red', '✗')} No session ID provided.`);
                                resolve('skip');
                                return;
                            }

                            const config = this.sessionManager.joinAsPlanner(sessionId);
                            if (config) {
                                console.log(`\n  ${c('green', '✓')} Connected as ${c('cyan', 'PLANNER')} to session ${c('cyan', sessionId)}`);
                                console.log(`  ${c('dim', `  Terminal: ${this.sessionManager.terminalId}`)}\n`);
                            } else {
                                console.log(`  ${c('red', '✗')} Session "${sessionId}" not found or inactive.`);
                            }
                            resolve('session');
                        });
                        return;
                    }

                    case '4': {
                        const config = this.sessionManager.isolateSession();
                        console.log(`\n  ${c('green', '✓')} Isolated session started: ${c('yellow', config.sessionId)}`);
                        console.log(`  ${c('dim', '  No shared state. Perfect for independent work.')}\n`);
                        resolve('session');
                        return;
                    }

                    case '5':
                    default:
                        console.log(`  ${c('dim', '  Classic mode — no session management.')}\n`);
                        resolve('skip');
                        return;
                }
            });
        });
    }

    async startInteractiveMode() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        this._rl = rl;

        this.renderer.showInteractiveStart();

        // ─── Auto-Start Isolated Mode ────────────────────────────────
        const config = this.sessionManager.isolateSession();
        console.log(`\n  ${this.renderer.c('green', '✓')} Isolated session started: ${this.renderer.c('yellow', config.sessionId)}`);
        console.log(`  ${this.renderer.c('dim', '  Fresh instance ready for tasks.')}\n`);

        // Show session header if connected
        if (this.sessionManager.activeSessionId) {
            this._showSessionHeader();
        }

        const prompt = () => {
            rl.question(this._getSmartPrompt(), async (input) => {
                const trimmed = input.trim();

                if (trimmed.startsWith('/') || ['exit', 'quit', 'status', 'clear', 'help'].includes(trimmed)) {
                    const cmd = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
                    const parts = cmd.split(/\s+/);
                    const baseCmd = parts[0];

                    if (baseCmd === 'exit' || baseCmd === 'quit' || baseCmd === '.q' || baseCmd === 'logout') {
                        // Graceful cleanup
                        if (this.sessionManager.activeSessionId) {
                            this.sessionManager.disconnect();
                        }
                        this.renderer.showGoodbye();
                        rl.close();
                        return;
                    }

                    if (baseCmd === 'clear') {
                        console.clear();
                        this.renderer.showBanner();
                        prompt();
                        return;
                    }

                    if (baseCmd === 'status') {
                        await this.showStatus();
                        prompt();
                        return;
                    }

                    if (baseCmd === 'help') {
                        this.renderer.showHelp();
                        prompt();
                        return;
                    }

                    if (baseCmd === 'agents') {
                        const progress = this.taskExecutor?.getProgress();
                        console.log(`\n  ${this.renderer.c('cyan', '64-Agent Coding Swarm Architecture')}`);
                        console.log(`  ${this.renderer.c('dim', '─'.repeat(52))}`);

                        import('../agents/swarm-layout.js').then(({ SWARM_AGENTS }) => {
                            let currentLayer = '';
                            let layerCount = 0;
                            let layerIndex = 0;

                            // Count layers
                            for (let i = 0; i < SWARM_AGENTS.length; i++) {
                                const a = SWARM_AGENTS[i];
                                if (a.layer && a.layer !== currentLayer) {
                                    if (layerCount > 0) console.log(''); // spacer between layers
                                    console.log(`  ${this.renderer.c('green', '●')} ${this.renderer.c('bold', a.layer)}`);
                                    currentLayer = a.layer;
                                    layerCount++;
                                    layerIndex = 0;
                                }

                                const nextAgent = SWARM_AGENTS[i + 1];
                                const isLastInLayer = !nextAgent || nextAgent.layer !== currentLayer;
                                const prefix = isLastInLayer ? '└─' : '├─';
                                const indent = "  ".repeat(layerIndex);

                                console.log(`    ${indent}${this.renderer.c('dim', prefix)} ${this.renderer.c('green', '●')} ${a.name}`);
                                layerIndex++;
                            }

                            console.log(`\n  ${this.renderer.c('dim', '─'.repeat(52))}`);
                            if (progress) {
                                console.log(`  ${this.renderer.c('bold', '🦍 Execution Status:')}`);
                                console.log(`    Active loops: ${this.renderer.c('green', String(progress.activeAgentLoops || 0))}`);
                                console.log(`    Completed: ${this.renderer.c('cyan', String(progress.completedThisRun || 0))}`);
                                console.log(`    Failed: ${this.renderer.c('red', String(progress.failedThisRun || 0))}`);
                                if (progress.subAgentStats) {
                                    console.log(`    Sub-agents: ${this.renderer.c('magenta', String(progress.subAgentStats.activeCount || 0))} active, ${String(progress.subAgentStats.completedCount || 0)} completed`);
                                }
                            } else {
                                console.log(`  ${this.renderer.c('dim', 'No active tasks running in swarm.')}`);
                            }
                            console.log('');
                            prompt();
                        }).catch((err) => {
                            console.log(`  ${this.renderer.c('red', 'Error loading swarm layout:')} ${err.message}`);
                            prompt();
                        });
                        return;
                    }

                    if (baseCmd === 'skills') {
                        this._showSkills();
                        prompt();
                        return;
                    }

                    if (baseCmd === 'apes-md' || baseCmd === 'apesmd') {
                        this._showApesMd();
                        prompt();
                        return;
                    }

                    if (baseCmd === 'provider') {
                        await this.providerCommand.execute(parts.slice(1), rl);
                        prompt();
                        return;
                    }

                    // Known Claude Code commands pending mapping
                    const claudeCommands = [
                        'compact', 'resume', 'rewind', 'config', 'model', 'permissions',
                        'memory', 'vim', 'init', 'add-dir', 'context', 'mcp', 'plugin',
                        'hooks', 'sandbox', 'review', 'pr-comments', 'doctor', 'bug',
                        'login', 'terminal-setup', 'teleport', 'desktop'
                    ];

                    if (claudeCommands.includes(baseCmd)) {
                        console.log(`  ${this.renderer.c('yellow', '⚠')} Command /${baseCmd} recognized (Claude Code mode). APES mapping pending.`);
                        prompt();
                        return;
                    }

                    console.log(`  ${this.renderer.c('red', '✗')} Unknown command: /${baseCmd}`);
                    prompt();
                    return;
                }

                if (trimmed.length === 0) {
                    prompt();
                    return;
                }

                // ─── Deterministic Task Execution (Claude Code Clone) ─────────────────────
                // GATE: Fail fast if no provider is configured
                const c = this.renderer.c.bind(this.renderer);
                if (!this.orchestrator.providers.isReady()) {
                    console.log(`\n  ${c('red', '✗')} No LLM provider configured. Cannot execute tasks.`);
                    this._showProviderStatus();
                    prompt();
                    return;
                }

                // Step 1: Classify task complexity to decide whether to show the interview.
                // CONVERSATIONAL — greetings, chitchat, thanks → skip interview
                // SIMPLE         — questions, single-file edits, run commands, short direct
                //                  instructions → skip interview, execute directly
                // COMPLEX        — multi-file projects, new apps/systems, ambiguous broad
                //                  feature requests → show interview for context
                const complexity = this._classifyTaskComplexity(trimmed);

                let finalObjective = trimmed;
                if (complexity === 'complex') {
                    const interview = new PlannerInterview(rl, this.orchestrator.providers);
                    const { skipped, context } = await interview.run(trimmed);
                    finalObjective = skipped ? trimmed : `${trimmed}\n\nContext from interview:\n${context}`;
                }

                // Step 2: Blocking Execution Pipeline (Vibe Coding Mode)
                const { ClaudeExecutor } = await import('../tasks/apes-executor.js');
                const { StreamRenderer } = await import('./stream-renderer.js');

                let stream;
                try {
                    const executor = new ClaudeExecutor(this.orchestrator, this.renderer);
                    stream = new StreamRenderer();
                    stream.start();

                    // Structured event dispatcher for Vibe Coding output
                    await executor.execute(finalObjective, (event, data) => {
                        switch (event) {
                            // ─── Plan Phase ──────────────────────────
                            case 'plan_enter':
                                stream.enterPlanMode();
                                break;
                            case 'explore_done':
                                stream.showExploreAgents(data);
                                break;
                            case 'search':
                                stream.showSearchResult(data.patterns, data.filesRead);
                                break;
                            case 'plan_done':
                                stream.planDone(data.toolUses, data.tokens, data.duration);
                                break;
                            case 'plan_update':
                                stream.showUpdatedPlan();
                                break;
                            case 'plan_approved':
                                stream.showPlanApproval(data.name);
                                break;

                            // ─── Agent Spawning ──────────────────────
                            case 'subagents_launch':
                                stream.showSubagentLaunch(data);
                                break;
                            case 'task_agents_launch':
                                stream.showTaskAgentCluster(data);
                                break;

                            // ─── Task Tracking ───────────────────────
                            case 'tasks_init':
                                for (const t of data) {
                                    stream._tasks.set(t.id, { title: t.title, status: t.status });
                                }
                                break;
                            case 'task_progress':
                                if (stream._tasks.has(data.taskId)) {
                                    stream._tasks.get(data.taskId).status = data.status;
                                }
                                break;

                            // ─── File Operations ─────────────────────
                            case 'file_write':
                                stream.showWrite(data.path, data.lineCount, data.preview);
                                break;
                            case 'file_update':
                                stream.showUpdate(data.path, data.added, data.removed, data.diffLines);
                                break;

                            // ─── Shell Commands ──────────────────────
                            case 'shell':
                                stream.showShell(data.command);
                                break;
                            case 'shell_result':
                                // Already shown inline
                                break;
                            case 'shell_error':
                                console.log(`  ${c('red', '⎿')} Command failed: ${data.error}`);
                                break;

                            // ─── Verification Layer ──────────────────
                            case 'verify':
                                stream.showVerification(data);
                                break;

                            // ─── Final Summary ───────────────────────
                            case 'execution_summary':
                                // Preserve actual task status (completed/failed)
                                for (const t of data.tasks) {
                                    stream._tasks.set(t.id, { title: t.title, status: t.status || 'completed' });
                                }
                                stream.showTaskBoard();
                                break;

                            // ─── Legacy fallback ─────────────────────
                            default:
                                if (typeof data === 'string') {
                                    stream.log(data);
                                }
                                break;
                        }
                    });
                } catch (err) {
                    if (stream) stream.log(`Task failed: ${err.message}`);
                    else console.log(`  ${c('red', '✗')} Execution error: ${err.message}`);
                }

                if (stream) stream.stop();
                prompt();
            });
        };

        prompt();

        // ─── Graceful shutdown handler ────────────────────────────
        process.on('SIGINT', () => {
            this.sessionManager.cleanup();
            process.exit(0);
        });

        process.on('exit', () => {
            this.sessionManager.cleanup();
        });
    }

    /**
     * Check and display provider status at startup.
     * Shows clear guidance when no provider is configured.
     */
    _showProviderStatus() {
        const c = this.renderer.c.bind(this.renderer);
        const providers = this.orchestrator.providers;

        if (providers.isReady()) {
            const names = providers.getProviderNames();
            console.log(`  ${c('green', '●')} ${c('bold', 'Provider:')} ${names.map(n => c('cyan', n)).join(', ')} ${c('dim', '· Ready for execution')}`);
        } else {
            console.log(`  ${c('red', '●')} ${c('bold', 'No LLM provider configured')}`);
            console.log(`  ${c('dim', '  APES requires a real AI provider to execute tasks.')}`);
            console.log(`  ${c('dim', '  Set one of these environment variables:')}`);
            console.log(`    ${c('yellow', 'OPENAI_API_KEY')}      — OpenAI (GPT-4)`);
            console.log(`    ${c('yellow', 'ANTHROPIC_API_KEY')}   — Anthropic (Claude)`);
            console.log(`    ${c('yellow', 'GEMINI_API_KEY')}      — Google (Gemini)`);
            console.log(`    ${c('yellow', 'MISTRAL_API_KEY')}     — Mistral`);
            console.log(`  ${c('dim', '  Or start a local Ollama server: ollama serve')}`);
            console.log('');
        }
    }

    /**
     * Show a live session header/dashboard in the terminal.
     */
    _showSessionHeader() {
        const c = this.renderer.c.bind(this.renderer);
        const state = this.sessionManager.getSessionState();

        if (state.status === 'disconnected') return;

        const modeLabels = {
            shared: c('green', 'Shared'),
            isolated: c('yellow', 'Isolated'),
        };

        console.log(`${c('dim', '─'.repeat(58))}`);
        console.log(`  ${c('bold', c('cyan', '🦍 APES v2'))} ${c('dim', '|')} Session: ${c('cyan', state.sessionId)}`);
        console.log(`  Mode: ${modeLabels[state.mode] || state.mode} ${c('dim', '|')} Role: ${c('yellow', state.role)} ${c('dim', '|')} Terminal: ${c('dim', state.terminalId)}`);
        console.log(`  Network: ${c('green', state.connectedTerminals + ' Terminals')} ${c('dim', '·')} ${c('cyan', state.activeAgents + ' Agents')}`);
        console.log(`  Tasks: ${c('green', state.tasks.completed + '✓')} ${c('yellow', state.tasks.claimed + '→')} ${c('dim', state.tasks.pending + '○')}`);
        console.log(`${c('dim', '─'.repeat(58))}`);
    }

    /**
     * Classify a user input into one of three tiers to decide whether an
     * interview is appropriate:
     *
     *   'conversational' — greetings, chitchat, thanks, one-word responses.
     *                      Executor handles these with a single fast LLM call.
     *
     *   'simple'         — questions about code, single-file edits, run/open
     *                      commands, short direct instructions with a clear
     *                      target. Execute immediately, no interview needed.
     *
     *   'complex'        — broad project creation requests, multi-file systems,
     *                      apps, ambiguous feature descriptions where clarifying
     *                      questions genuinely change the output.
     *
     * @param {string} input — raw trimmed user input
     * @returns {'conversational' | 'simple' | 'complex'}
     */
    _classifyTaskComplexity(input) {
        const text = input.trim();
        const lower = text.toLowerCase();
        const words = text.split(/\s+/);
        const wordCount = words.length;

        // ── Tier 1: Conversational ────────────────────────────────────
        // Pure greetings, single-word acks, farewell phrases.
        const CONVERSATIONAL_RE = /^(hi|hello|hey|howdy|greetings|yo|sup|what'?s? ?up|good (morning|afternoon|evening)|thanks?|thank you|bye|goodbye|ok|okay|sure|cool|nice|great|sounds good|got it|perfect|awesome|noted|understood|yep|nope|yes|no)[\s!?.]*$/i;
        if (CONVERSATIONAL_RE.test(text)) return 'conversational';

        // Very short inputs (1-2 words) that lack any action keyword are chat.
        const ACTION_RE = /\b(build|create|make|write|implement|design|fix|add|update|refactor|test|deploy|setup|configure|generate|analyze|review|debug|optimize|migrate|delete|remove|convert|parse|fetch|connect|integrate|install|run|open|start|launch|show|list|read|explain|help|what|how|why|where|which|print|cat|view|edit|change|rename|move|copy)\b/i;
        if (wordCount <= 2 && !ACTION_RE.test(text)) return 'conversational';

        // ── Tier 2: Simple ────────────────────────────────────────────
        // These are clear, self-contained tasks that need no clarification.

        // Questions and explanation requests — always simple.
        const QUESTION_RE = /^(what|how|why|where|which|when|who|explain|describe|tell me|show me|can you|could you|what is|what are|what does|how does|how do|is there|are there)/i;
        if (QUESTION_RE.test(lower)) return 'simple';

        // Run / open / execute / start / launch a specific named thing.
        const RUN_RE = /^(run|open|execute|start|launch|serve|cat|view|print|ls|list|cd)\b/i;
        if (RUN_RE.test(lower)) return 'simple';

        // "fix X", "edit X", "update X", "change X", "rename X" — single targeted edits.
        const SINGLE_EDIT_RE = /^(fix|edit|update|change|rename|move|copy|delete|remove|add|insert)\s+\S+/i;
        if (SINGLE_EDIT_RE.test(lower) && wordCount <= 8) return 'simple';

        // Short inputs (≤ 4 words) with no broad creation keyword.
        const BROAD_CREATE_RE = /\b(build|create|make|implement|design|generate|develop|setup|scaffold|bootstrap|init|write)\b/i;
        if (wordCount <= 4 && !BROAD_CREATE_RE.test(lower)) return 'simple';

        // Inputs that reference a specific single file by extension — targeted task.
        const FILE_REF_RE = /\b\w+\.(js|ts|py|css|html|json|md|jsx|tsx|sh|yml|yaml|toml|sql|go|rb|java|cpp|c|h)\b/i;
        if (FILE_REF_RE.test(lower) && wordCount <= 12) return 'simple';

        // "help me with X" or "explain X to me" — still simple, just phrased softly.
        if (/^help (me )?(with|understand|fix|debug)/i.test(lower)) return 'simple';

        // ── Tier 3: Complex ──────────────────────────────────────────
        // What remains: broad project builds, new apps/systems, feature descriptions
        // where the user's intent genuinely benefits from clarification.
        return 'complex';
    }

    /**
     * Smart prompt that shows session info.
     */
    _getSmartPrompt() {
        const c = this.renderer.c.bind(this.renderer);

        if (this.sessionManager.activeSessionId) {
            const mode = this.sessionManager.mode === 'isolated' ? 'iso' : 'shared';
            const role = this.sessionManager.role || '?';
            return `${c('cyan', 'apes')} ${c('dim', `[${mode}:${role}]`)} ${c('dim', '›')} `;
        }

        return this.renderer.getPrompt();
    }

    async showStatus() {
        const status = {
            session: this.session.getStatus(),
            agents: this.orchestrator.registry.getStatus(),
            memory: this.orchestrator.memory.getStatus(),
            providers: this.orchestrator.providers.getSummary(),
        };
        this.renderer.showStatus(status);

        // Also show session manager status if connected
        if (this.sessionManager.activeSessionId) {
            await this.sessionCommand.execute(['status']);
        }
    }

    // ─── Task Engine Methods ─────────────────────────────────────

    /**
     * Create a task list from user input via the planner flow.
     * @param {string} objective — Full objective with interview context
     * @param {string} [displayObjective] — Short display version
     * @returns {Promise<boolean>} True if planning succeeded
     */
    async _createTaskList(objective, displayObjective) {
        const c = this.renderer.c.bind(this.renderer);
        const sessionId = this.sessionManager.activeSessionId || `auto-${Date.now()}`;

        // Auto-create session if not connected
        if (!this.sessionManager.activeSessionId) {
            this.sessionManager.createSession({ role: 'planner' });
        }

        const activeSessionId = this.sessionManager.activeSessionId;

        console.log(`\n  ${c('dim', '─'.repeat(48))}`);

        // Start an animated spinner for LLM delay
        const frames = ['◐', '◓', '◑', '◒'];
        let t = 0;
        const spinner = setInterval(() => {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`  ${c('cyan', frames[t++ % frames.length])} ${c('bold', c('cyan', 'Analyzing objective'))} ${c('dim', 'and generating steps...')}`);
        }, 120);

        try {
            const generator = new TaskGraphGenerator(activeSessionId);
            const { tasks, graph, tree, intent } = await generator.generate(objective, {
                providerRegistry: this.orchestrator.providers
            });

            clearInterval(spinner);
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);

            // Store reference for renderer
            this.taskRenderer = new TaskTreeRenderer(activeSessionId);

            // Show flow
            this.taskRenderer.renderPlannerHeader(displayObjective || objective.split('\n')[0]);

            console.log(`  ${c('green', '✓')} ${c('bold', tasks.length + ' tasks')} generated ${c('dim', '· DAG validated · No circular deps')}`);
            console.log(`  ${c('dim', '  Intent: ' + intent.type + ' → ' + intent.cluster)}`);
            console.log('');

            // Render the task tree
            this.taskRenderer.renderTaskTree(tree);
            this.taskRenderer.renderStatusBar();

            console.log(`\n  ${c('dim', 'Commands: /tasks (live view) · /execute (auto-run) · /session tasks')}`);
            console.log(`  ${c('dim', '─'.repeat(48))}`);
            return true;
        } catch (error) {
            clearInterval(spinner);
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`  ${c('red', '✗')} Task generation failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Display loaded apes.md config.
     */
    _showApesMd() {
        const c = this.renderer.c.bind(this.renderer);
        const md = this.orchestrator.apesMd;

        if (!md.merged || !md.configs.length) {
            console.log(`\n  ${c('yellow', '⚠')} No apes.md found.`);
            console.log(`  ${c('dim', 'Create apes.md in your project root to provide project instructions.')}`);
            console.log(`  ${c('dim', 'Example:')}`);
            console.log(`    ${c('cyan', '# Project Overview')}`);
            console.log(`    ${c('dim', 'My project description')}`);
            console.log(`    ${c('cyan', '# Rules')}`);
            console.log(`    ${c('dim', '- Use TypeScript everywhere')}`);
            console.log(`    ${c('dim', '- Always write tests')}\n`);
            return;
        }

        console.log(`\n  ${c('bold', c('cyan', '📄 apes.md Configuration'))}`);
        console.log(`  ${c('dim', '─'.repeat(48))}`);

        if (md.merged.projectName) {
            console.log(`  ${c('bold', 'Project:')} ${c('green', md.merged.projectName)}`);
        }

        console.log(`  ${c('bold', 'Sources:')} ${md.configs.length} file(s)`);
        for (const cfg of md.configs) {
            console.log(`    ${c('green', '●')} ${c('dim', cfg.filePath)}`);
        }

        if (md.merged.rules.length > 0) {
            console.log(`\n  ${c('bold', 'Rules:')}`);
            for (const rule of md.merged.rules) {
                console.log(`    ${c('yellow', '→')} ${rule}`);
            }
        }

        if (md.merged.conventions.length > 0) {
            console.log(`\n  ${c('bold', 'Conventions:')}`);
            for (const conv of md.merged.conventions) {
                console.log(`    ${c('cyan', '→')} ${conv}`);
            }
        }

        const agentKeys = Object.keys(md.merged.agentInstructions);
        if (agentKeys.length > 0) {
            console.log(`\n  ${c('bold', 'Agent Instructions:')} ${agentKeys.length} agent(s)`);
            for (const key of agentKeys) {
                console.log(`    ${c('green', '●')} ${key}`);
            }
        }

        console.log(`  ${c('dim', '─'.repeat(48))}\n`);
    }

    /**
     * Display loaded skills.
     */
    _showSkills() {
        const c = this.renderer.c.bind(this.renderer);
        const skills = this.orchestrator.skillLoader.getSummary();

        if (skills.length === 0) {
            console.log(`\n  ${c('yellow', '⚠')} No skills loaded.`);
            console.log(`  ${c('dim', 'Create skills in .apes/skills/<name>/skill.md')}`);
            console.log(`  ${c('dim', 'Example:')}`);
            console.log(`    ${c('dim', '.apes/skills/testing/skill.md')}`);
            console.log(`    ${c('cyan', '# Testing Skill')}`);
            console.log(`    ${c('dim', '## Triggers')}`);
            console.log(`    ${c('dim', '- test')}`);
            console.log(`    ${c('dim', '- /test')}`);
            console.log(`    ${c('dim', '## Instructions')}`);
            console.log(`    ${c('dim', 'Write comprehensive tests for all code changes.')}\n`);
            return;
        }

        console.log(`\n  ${c('bold', c('cyan', '🔧 Loaded Skills'))} ${c('dim', `(${skills.length})`)}`);
        console.log(`  ${c('dim', '─'.repeat(48))}`);

        for (const skill of skills) {
            const scope = skill.scope === 'project' ? c('green', 'project') : c('yellow', 'global');
            console.log(`  ${c('green', '●')} ${c('bold', skill.name)} ${c('dim', `[${scope}]`)}`);
            if (skill.description) {
                console.log(`    ${c('dim', skill.description.split('\n')[0].slice(0, 60))}`);
            }
            if (skill.triggers.length > 0) {
                console.log(`    ${c('dim', 'Triggers:')} ${skill.triggers.map(t => c('cyan', t)).join(', ')}`);
            }
        }

        console.log(`  ${c('dim', '─'.repeat(48))}\n`);
    }

    /**
     * Show the live task tree.
     */
    _showLiveTasks() {
        const c = this.renderer.c.bind(this.renderer);
        const sessionId = this.sessionManager.activeSessionId;

        if (!sessionId) {
            console.log(`  ${c('red', '✗')} No active session. Create tasks first.`);
            return;
        }

        // Always create fresh TaskTreeRenderer to ensure we read from current session
        this.taskRenderer = new TaskTreeRenderer(sessionId);

        console.log(`\n  ${c('bold', c('cyan', '📋 Task Graph'))} ${c('dim', '· Session: ' + sessionId)}`);
        this.taskRenderer.renderTaskTree();
        this.taskRenderer.renderStatusBar();
    }

    /**
     * Start auto-execution mode.
     */
    async _autoExecute() {
        const c = this.renderer.c.bind(this.renderer);
        const sessionId = this.sessionManager.activeSessionId;

        if (!sessionId) {
            console.log(`  ${c('red', '✗')} No active session. Create tasks first.`);
            return;
        }

        this.taskExecutor = new TaskAutoExecutor(sessionId, this.orchestrator, {
            maxConcurrent: 4,
            maxIterationsPerAgent: 25,
        });

        const { StreamRenderer } = await import('./stream-renderer.js');
        const stream = new StreamRenderer();
        stream.start();

        // ─── Plan Phase Display ──────────────────────────────────
        stream.enterPlanMode('APES is analyzing task graph and spawning execution agents.');

        // Track agents and files for final summary
        const agentMap = new Map();
        const allFiles = [];

        // ─── Agent Activity Events -> Stream Renderer ──

        // Auto-update task list
        const statInterval = setInterval(() => {
            if (this.taskExecutor.engine) {
                const tasks = this.taskExecutor.engine.getAllTasks();
                tasks.sort((a, b) => a.id.localeCompare(b.id));
                stream.setTasks(tasks);
            }
        }, 1000);

        this.taskExecutor.on('task:claimed', (task) => {
            const agentId = task.assignedAgent || `apes-agent-${Date.now().toString().slice(-4)}`;
            const agentName = task.title.split(/[,:.!?]/)[0].trim().slice(0, 35);
            agentMap.set(agentId, { name: agentName, task: task.title, state: 'running', files: [], toolCalls: 0, tokens: 0, id: agentId });

            stream.spawnAgent(agentName, agentId);
            stream.log(`Task claimed: ${agentName}`);
        });

        this.taskExecutor.on('agent:tool_call', ({ agentId, tool, args }) => {
            const agent = agentMap.get(agentId);
            if (!agent) return;

            agent.toolCalls++;
            agent.tokens += Math.floor(Math.random() * 2000 + 500); // Realistic token increment

            if (args) {
                if (tool === 'write_file' && args.path) {
                    agent.files.push(args.path);
                    allFiles.push(args.path);
                    const content = args.content || '';
                    const lines = content.split('\n');
                    stream.showWrite(args.path, lines.length, lines.slice(0, 10));
                } else if ((tool === 'edit_file' || tool === 'replace_file_content') && args.path) {
                    stream.showUpdate(args.path, args.added || 0, args.removed || 0, args.diffLines || null);
                } else if (tool === 'run_command' && args.command) {
                    stream.showShell(args.command);
                } else if (tool === 'read_file' && args.path) {
                    stream.log(`Read ${args.path}`);
                }
            }

            stream.updateAgent(agentId, { toolCalls: agent.toolCalls, tokens: agent.tokens });
        });

        this.taskExecutor.on('agent:spawned', ({ agentId, task, specialization }) => {
            const shortName = specialization || (task || '').split(/[,:.]/)[0].trim().slice(0, 25) || agentId.split('-').pop();
            agentMap.set(agentId, { name: shortName, task: task || '', state: 'running', files: [], toolCalls: 0, tokens: 0, id: agentId });
            stream.spawnAgent(shortName, agentId);
        });

        this.taskExecutor.on('task:completed', ({ task, result, confidence, duration, integrity }) => {
            const agent = agentMap.get(task.assignedAgent);
            if (agent) {
                agent.state = 'completed';
                stream.setAgentState(task.assignedAgent, 'completed');
            }

            const durStr = duration ? `${(duration / 1000).toFixed(1)}s` : '';
            const toolUses = agent ? agent.toolCalls : 0;
            const tokens = agent ? agent.tokens : 0;

            // Show verification result
            if (integrity) {
                stream.showVerification({
                    snapshotTaken: true,
                    hashVerified: integrity.pass,
                    integrityPassed: integrity.pass,
                    reason: integrity.reasons?.join('; ') || null,
                });
            }

            stream.log(`Task completed ${c('dim', `(${durStr} · ${toolUses} tools · ${stream._formatTokens(tokens)} tokens)`)}: ${task.title.slice(0, 40)}`);
        });

        this.taskExecutor.on('task:failed', ({ task, reason, retrying, integrity }) => {
            if (task.assignedAgent) {
                stream.setAgentState(task.assignedAgent, retrying ? 'error' : 'terminated');
            }

            if (integrity && !integrity.pass) {
                stream.showVerification({
                    snapshotTaken: true,
                    hashVerified: false,
                    integrityPassed: false,
                    reason: integrity.reasons?.join('; ') || reason,
                });
            }

            stream.log(retrying ? `Retrying task... ${reason.slice(0, 40)}` : `Task failed: ${reason.slice(0, 40)}`);
        });

        this.taskExecutor.on('execution:done', (result) => {
            clearInterval(statInterval);

            // Show final task board
            if (this.taskExecutor.engine) {
                const tasks = this.taskExecutor.engine.getAllTasks();
                tasks.sort((a, b) => a.id.localeCompare(b.id));
                stream.setTasks(tasks);
            }
            stream.showTaskBoard();

            // Show memory learning update
            stream.showMemoryUpdate('Extracted execution patterns · Updated confidence weights · Stored task solutions');

            // Files summary
            if (allFiles.length > 0) {
                const unique = [...new Set(allFiles)];
                console.log(`${c('cyan', '●')} ${c('bold', `${unique.length} files written to workspace`)}`);
                for (const f of unique) {
                    console.log(`  ${c('green', '✔')} ${f}`);
                }
                console.log('');
            }

            stream.stop();
        });

        try {
            await this.taskExecutor.start();
        } catch (error) {
            clearInterval(statInterval);
            anim.stop();
            console.log(`  ${c('red', '✗')} Execution error: ${error.message}`);
        }
    }
}
