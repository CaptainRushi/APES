/**
 * CLI Renderer
 * 
 * Handles all terminal output — ANSI-styled, animated,
 * production-grade terminal UI for APES.
 */

export class Renderer {
    constructor() {
        this.colors = {
            reset: '\x1b[0m',
            bold: '\x1b[1m',
            dim: '\x1b[2m',
            italic: '\x1b[3m',
            underline: '\x1b[4m',
            // Foreground
            red: '\x1b[31m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            blue: '\x1b[34m',
            magenta: '\x1b[35m',
            cyan: '\x1b[36m',
            white: '\x1b[37m',
            gray: '\x1b[90m',
            // Bright
            brightGreen: '\x1b[92m',
            brightCyan: '\x1b[96m',
            brightWhite: '\x1b[97m',
        };
    }

    c(color, text) {
        return `${this.colors[color]}${text}${this.colors.reset}`;
    }

    cleanMarkdown(text) {
        if (!text) return '';

        let result = text;

        // Remove code blocks first (they may contain special chars)
        result = result.replace(/```[\s\S]*?```/g, '');

        // Remove headings (# Heading)
        result = result.replace(/^#{1,6}\s+/gm, '');

        // Remove bold/italic/underline
        result = result.replace(/\*\*(.+?)\*\*/g, '$1');
        result = result.replace(/\*(.+?)\*/g, '$1');
        result = result.replace(/_{2,}(.+?)_{2,}/g, '$1');
        result = result.replace(/~~(.+?)~~/g, '$1');

        // Remove inline code
        result = result.replace(/`(.+?)`/g, '$1');

        // Replace lists with bullets
        result = result.replace(/^\s*[-*+]\s+/gm, '  • ');
        result = result.replace(/^\s*\d+\.\s+/gm, '  ');

        // Remove links, keep text
        result = result.replace(/\[(.+?)\]\(.+?\)/g, '$1');

        // Remove blockquotes
        result = result.replace(/^\s*>\s+/gm, '');

        // Normalize newlines
        result = result.replace(/\n{3,}/g, '\n\n');

        return result.trim();
    }

    showBanner() {
        const banner = `
${this.c('cyan', '╔══════════════════════════════════════════════════════════╗')}
${this.c('cyan', '║')}  ${this.c('bold', this.c('brightCyan', '    █████╗ ██████╗ ███████╗███████╗'))}           ${this.c('cyan', '║')}
${this.c('cyan', '║')}  ${this.c('bold', this.c('brightCyan', '   ██╔══██╗██╔══██╗██╔════╝██╔════╝'))}           ${this.c('cyan', '║')}
${this.c('cyan', '║')}  ${this.c('bold', this.c('brightCyan', '   ███████║██████╔╝█████╗  ███████╗'))}           ${this.c('cyan', '║')}
${this.c('cyan', '║')}  ${this.c('bold', this.c('brightCyan', '   ██╔══██║██╔═══╝ ██╔══╝  ╚════██║'))}           ${this.c('cyan', '║')}
${this.c('cyan', '║')}  ${this.c('bold', this.c('brightCyan', '   ██║  ██║██║     ███████╗███████║'))}           ${this.c('cyan', '║')}
${this.c('cyan', '║')}  ${this.c('bold', this.c('brightCyan', '   ╚═╝  ╚═╝╚═╝     ╚══════╝╚══════╝'))}           ${this.c('cyan', '║')}
${this.c('cyan', '║')}                                                          ${this.c('cyan', '║')}
${this.c('cyan', '║')}  ${this.c('gray', 'Advanced Parallel Execution System')}     ${this.c('dim', 'v2.0.0')}     ${this.c('cyan', '║')}
${this.c('cyan', '║')}  ${this.c('gray', 'Multi-Agent Orchestration Engine')}                      ${this.c('cyan', '║')}
${this.c('cyan', '╚══════════════════════════════════════════════════════════╝')}
`;
        console.log(banner);
    }

    showHelp() {
        console.log(`
${this.c('bold', 'Usage:')}
  ${this.c('cyan', 'apes')}                        Start interactive mode

${this.c('bold', 'APES Commands:')}
  ${this.c('green', 'apes loop')} "task" --completion-promise "string"   Run task in loop until promise met
  ${this.c('cyan', '  -p, --completion-promise')}   String to match in output (required)
  ${this.c('cyan', '  -n, --max-iterations')}       Max iterations (default: 100)
  ${this.c('cyan', '  -i, --interval')}             Milliseconds between iterations
  ${this.c('cyan', '  -v, --verbose')}               Show all output

${this.c('bold', 'Session Management:')}
  ${this.c('green', '/clear')}                     Clear conversation history and start a fresh session
  ${this.c('green', '/compact [instructions]')}    Compress conversation history to free up context window
  ${this.c('green', '/resume')}                    Resume a previous session from a list
  ${this.c('green', '/rewind')}                    Rewind conversation/code to a previous state

${this.c('bold', 'Configuration & Settings:')}
  ${this.c('green', '/config')}                    Open configuration settings
  ${this.c('green', '/model')}                     Select or change the AI model
  ${this.c('green', '/provider')}                  Manage AI providers and APIs
  ${this.c('green', '/permissions')}               View or update tool/file permissions
  ${this.c('green', '/memory')}                    Edit CLAUDE.md memory files
  ${this.c('green', '/vim')}                       Toggle vim-style editing mode

${this.c('bold', 'Project & Context:')}
  ${this.c('green', '/init')}                      Initialize a project with a CLAUDE.md file
  ${this.c('green', '/add-dir')}                   Add additional working directories to the session
  ${this.c('green', '/context')}                   Show a detailed breakdown of context window usage

${this.c('bold', 'Tools & Extensions:')}
  ${this.c('green', '/mcp')}                       Manage MCP servers
  ${this.c('green', '/agents')}                    Manage custom subagents
  ${this.c('green', '/plugin')}                    Manage plugins
  ${this.c('green', '/hooks')}                     Configure hooks
  ${this.c('green', '/sandbox')}                   Enable/configure sandboxed bash tool execution

${this.c('bold', 'Code & Review:')}
  ${this.c('green', '/review')}                    Request a code review
  ${this.c('green', '/pr-comments')}               View and address PR comments

${this.c('bold', 'Navigation & Utilities:')}
  ${this.c('green', '/help')}                      Show all available slash commands
  ${this.c('green', '/status')}                    Show current session/system status
  ${this.c('green', '/doctor')}                    Check installation health
  ${this.c('green', '/bug')}                       Report a bug

${this.c('bold', 'Auth & Control:')}
  ${this.c('green', '/login')}                     Switch accounts
  ${this.c('green', '/logout')}                    Sign out
  ${this.c('green', '/terminal-setup')}            Install Shift+Enter key binding
  ${this.c('green', '/teleport')}                  Move session to web/mobile
  ${this.c('green', '/desktop')}                   Hand off session to Desktop app
`);
    }

    showInteractiveStart() {
        console.log(
            `\n${this.c('gray', '─'.repeat(58))}\n` +
            `  ${this.c('green', '●')} Interactive mode ${this.c('dim', '— type your task or "exit" to quit')}\n` +
            `${this.c('gray', '─'.repeat(58))}\n`
        );
    }

    getPrompt() {
        return `${this.c('cyan', 'apes')} ${this.c('dim', '›')} `;
    }

    showTaskStart(input) {
        console.log(`\n${this.c('cyan', '▸')} ${this.c('bold', 'Task:')} ${input}`);
        console.log(`${this.c('gray', '─'.repeat(58))}`);
    }

    showTaskResult(result) {
        if (!result) return;

        console.log(`\n${this.c('gray', '─'.repeat(58))}`);

        if (result.error) {
            console.log(`${this.c('red', '✗')} ${this.c('bold', 'Failed:')} ${result.error}`);
            return;
        }

        // Show pipeline stages
        if (result.pipeline) {
            this.showPipeline(result.pipeline);
        }

        // Show final output
        if (result.output) {
            const cleanOutput = this.cleanMarkdown(result.output);
            console.log(`\n${this.c('green', '✓')} ${this.c('bold', 'Result:')}`);
            console.log(`  ${cleanOutput}`);
        }

        // Show metrics
        if (result.metrics) {
            this.showMetrics(result.metrics);
        }

        console.log(`${this.c('gray', '─'.repeat(58))}\n`);
    }

    showPipeline(pipeline) {
        console.log(`\n${this.c('bold', '  ═══ Pipeline ═══')}`);

        // Intent
        if (pipeline.intent) {
            const intent = pipeline.intent;
            const typeColor = intent.type === 'general' ? 'yellow' : 'green';
            console.log(`  🎯 Intent: ${this.c(typeColor, intent.type)} → ${this.c('dim', intent.cluster)}`);
        }

        // Tasks & Complexity combined
        if (pipeline.decomposition) {
            const tasks = pipeline.decomposition.tasks || [];
            const comp = pipeline.complexity;
            const level = comp?.level || 'medium';
            const levelColor = level === 'simple' ? 'green' : level === 'complex' ? 'red' : 'yellow';
            console.log(`  📋 Tasks: ${this.c('yellow', tasks.length + ' subtasks')} ${this.c('dim', '·')} 📊 ${this.c(levelColor, level)}`);
        }

        // Agents
        if (pipeline.agents) {
            const agents = pipeline.agents.agents || [];
            const strategy = pipeline.agents.strategy || 'direct';
            console.log(`  🤖 Agents: ${this.c('yellow', agents.length + ' spawned')} ${this.c('dim', '· ' + strategy.replace('_', ' '))}`);
        }

        // Execution
        if (pipeline.execution) {
            const exec = pipeline.execution;
            const results = exec.results || [];
            const completed = results.filter(r => r.status === 'completed').length;
            const duration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
            console.log(`  ⚡ Execution: ${this.c('green', completed + '/' + results.length)} ${this.c('dim', '· ' + duration + 'ms')}`);
        }

        // Evaluation
        if (pipeline.evaluation) {
            const eval_ = pipeline.evaluation;
            const quality = Math.round((eval_.quality || 0) * 100);
            const qualityColor = quality >= 80 ? 'green' : quality >= 50 ? 'yellow' : 'red';
            console.log(`  ✅ Quality: ${this.c(qualityColor, quality + '%')} ${this.c('dim', '· ' + Math.round(eval_.successRate * 100) + '% success')}`);
        }

        console.log(this.c('dim', '  ' + '─'.repeat(28)));
    }

    showMetrics(metrics) {
        console.log(`\n${this.c('bold', '  Metrics:')}`);
        if (metrics.duration) {
            console.log(`  ⏱ Duration: ${this.c('yellow', metrics.duration + 'ms')}`);
        }
        if (metrics.agentsUsed) {
            console.log(`  🤖 Agents: ${this.c('yellow', metrics.agentsUsed)}`);
        }
        if (metrics.tasksCompleted) {
            console.log(`  ✓ Tasks: ${this.c('green', metrics.tasksCompleted)}`);
        }
    }

    showStatus(status) {
        console.log(`\n${this.c('bold', this.c('cyan', '  System Status'))}`);
        console.log(`${this.c('gray', '  ' + '─'.repeat(40))}`);

        // Session
        console.log(`  ${this.c('bold', 'Session:')}`);
        console.log(`    ID:       ${this.c('dim', status.session.sessionId.slice(0, 8))}`);
        console.log(`    Uptime:   ${this.c('yellow', Math.round(status.session.uptime / 1000) + 's')}`);
        console.log(`    Tasks:    ${this.c('green', status.session.tasksCompleted + ' done')} / ${this.c('red', status.session.tasksFailed + ' failed')}`);

        // Agents
        console.log(`\n  ${this.c('bold', 'Agent Registry:')}`);
        console.log(`    Total:    ${this.c('cyan', status.agents.totalAgents)}`);
        console.log(`    Clusters: ${this.c('cyan', status.agents.totalClusters)}`);

        // Memory
        console.log(`\n  ${this.c('bold', 'Memory:')}`);
        console.log(`    Sessions: ${this.c('cyan', status.memory.sessionEntries)}`);
        console.log(`    Perf:     ${this.c('cyan', status.memory.performanceEntries)}`);

        console.log(`${this.c('gray', '\n  ' + '─'.repeat(40))}\n`);
    }

    showError(error) {
        console.log(`\n${this.c('red', '✗ Error:')} ${error.message || error}`);
        if (error.stack && process.env.DEBUG) {
            console.log(this.c('dim', error.stack));
        }
    }

    showGoodbye() {
        console.log(`\n${this.c('cyan', '  ✦')} ${this.c('dim', 'APES shutting down. Goodbye!')}\n`);
    }

    /**
     * Show a task tree via TaskTreeRenderer.
     * @param {import('../tasks/task-renderer.js').TaskTreeRenderer} renderer
     */
    showTaskTree(renderer) {
        if (!renderer) return;
        renderer.renderTaskTree();
        renderer.renderStatusBar();
    }

    /**
     * Show planner flow header.
     * @param {string} objective
     */
    showPlannerFlow(objective) {
        console.log(`\n  ${this.c('bold', this.c('magenta', '🧠 Planner Agent'))}`);
        console.log(`  ${this.c('dim', '  └── Decomposing:')} ${this.c('white', objective)}`);
    }
}
