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
  ${this.c('cyan', 'apes')} ${this.c('green', '<task>')}               Execute a task directly
  ${this.c('cyan', 'apes run')} ${this.c('green', '<task>')}           Execute a task explicitly
  ${this.c('cyan', 'apes --status')}              Show system status
  ${this.c('cyan', 'apes --help')}                Show this help

${this.c('bold', 'Interactive Commands:')}
  ${this.c('green', 'status')}                     Show agent/memory/session status
  ${this.c('green', 'clear')}                      Clear screen
  ${this.c('green', 'exit')}                       Quit APES
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
            console.log(`\n${this.c('green', '✓')} ${this.c('bold', 'Result:')}`);
            console.log(`  ${result.output}`);
        }

        // Show metrics
        if (result.metrics) {
            this.showMetrics(result.metrics);
        }

        console.log(`${this.c('gray', '─'.repeat(58))}\n`);
    }

    showPipeline(pipeline) {
        const stages = [
            { key: 'intent', label: 'Intent', icon: '🎯' },
            { key: 'decomposition', label: 'Tasks', icon: '📋' },
            { key: 'complexity', label: 'Complexity', icon: '📊' },
            { key: 'agents', label: 'Agents', icon: '🤖' },
            { key: 'execution', label: 'Execution', icon: '⚡' },
            { key: 'evaluation', label: 'Evaluation', icon: '✅' },
        ];

        console.log(`\n${this.c('bold', '  Pipeline:')}`);
        for (const stage of stages) {
            if (pipeline[stage.key]) {
                const data = pipeline[stage.key];
                const summary = typeof data === 'string' ? data : JSON.stringify(data);
                console.log(`  ${stage.icon} ${this.c('cyan', stage.label)}: ${this.c('dim', summary)}`);
            }
        }
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
}
