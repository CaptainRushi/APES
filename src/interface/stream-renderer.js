/**
 * Vibe Stream Renderer — Structured Execution Output Engine
 *
 * Produces Claude Code CLI-style structured execution output:
 *   ● Action description
 *     ⎿ Result summary
 *
 * Supports:
 *   - Plan mode with explore agents
 *   - Parallel agent spawn trees with token/tool counts
 *   - File write diffs with line numbers
 *   - Execution verification layer
 *   - Live task board summary
 *   - Token usage tracking
 *   - Duration tracking
 */

export class StreamRenderer {
    constructor() {
        this.colors = {
            reset: '\x1b[0m',
            bold: '\x1b[1m',
            dim: '\x1b[2m',
            italic: '\x1b[3m',
            red: '\x1b[31m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            blue: '\x1b[34m',
            magenta: '\x1b[35m',
            cyan: '\x1b[36m',
            white: '\x1b[37m',
            gray: '\x1b[90m',
            brightGreen: '\x1b[92m',
            brightCyan: '\x1b[96m',
            brightWhite: '\x1b[97m',
        };

        this.systemStatus = '';
        this._startTime = Date.now();

        // Token tracking
        this._totalTokens = 0;
        this._totalToolUses = 0;

        // Agent tracking
        this._agents = new Map();  // agentId -> { name, toolUses, tokens, status, startTime, files }
        this._exploreAgents = [];  // finished explore agents
        this._subagents = [];      // launched subagents

        // Task tracking
        this._tasks = new Map();   // taskId -> { title, status, agentName }

        // File tracking
        this._filesWritten = [];
        this._filesUpdated = [];
    }

    c(color, text) {
        return `${this.colors[color] || ''}${text}${this.colors.reset}`;
    }

    // ─── Lifecycle ────────────────────────────────────────────────

    start() {
        console.log('');

        // Setup live task board rendering at the bottom of the stream
        this._taskBoardLines = 0;
        this._originalConsoleLog = console.log;

        console.log = (...args) => {
            if (this._taskBoardLines > 0) {
                // Clear the live task board lines
                process.stdout.write(`\x1b[${this._taskBoardLines}A\x1b[0J`);
                this._taskBoardLines = 0;
            }

            // Print the actual new log line through the original implementation
            this._originalConsoleLog.apply(console, args);

            // Re-render the live task board at the new bottom
            this._renderLiveTaskBoard();
        };
    }

    stop() {
        if (this._originalConsoleLog) {
            // Unpatch and clear the live board before final summary
            if (this._taskBoardLines > 0) {
                process.stdout.write(`\x1b[${this._taskBoardLines}A\x1b[0J`);
                this._taskBoardLines = 0;
            }
            console.log = this._originalConsoleLog;
        }

        const dur = ((Date.now() - this._startTime) / 1000).toFixed(1);
        const tokenStr = this._formatTokens(this._totalTokens);
        console.log(`\n${this.c('dim', '✻')} ${this.c('dim', `Cogitated for ${dur}s · ${tokenStr} tokens · ${this._totalToolUses} tool uses`)}\n`);
    }

    _renderLiveTaskBoard() {
        const tasks = [...this._tasks.values()];
        if (tasks.length === 0) return;

        const done = tasks.filter(t => t.status === 'completed').length;
        const failed = tasks.filter(t => t.status === 'failed').length;
        const inProgress = tasks.filter(t => t.status === 'in_progress').length;
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'blocked').length;
        const total = tasks.length;

        const lines = [];
        lines.push('');
        let summary = `  ${total} tasks (${this.c('green', done + ' done')}`;
        if (failed > 0) summary += `, ${this.c('red', failed + ' failed')}`;
        summary += `, ${this.c('cyan', inProgress + ' in progress')}, ${this.c('dim', pending + ' pending')})`;
        lines.push(summary);

        for (const t of tasks) {
            let icon;
            switch (t.status) {
                case 'completed': icon = this.c('green', '✔'); break;
                case 'in_progress': icon = this.c('cyan', '◼'); break;
                case 'failed': icon = this.c('red', '✗'); break;
                default: icon = this.c('dim', '◻');
            }
            lines.push(`    ${icon} ${t.status === 'completed' ? this.c('dim', t.title) : t.title}`);
        }
        lines.push('');

        for (const line of lines) {
            process.stdout.write(line + '\n');
        }
        this._taskBoardLines = lines.length;
    }

    // ─── Plan Mode ────────────────────────────────────────────────

    enterPlanMode(description) {
        console.log(`${this.c('cyan', '●')} ${this.c('bold', 'Entered plan mode')}`);
        console.log(`  ${this.c('dim', description || 'APES is now analyzing architecture and designing execution strategy.')}\n`);
    }

    planDone(toolUses, tokens, duration) {
        this._totalTokens += tokens;
        this._totalToolUses += toolUses;
        const dur = (duration / 1000).toFixed(1);
        console.log(`${this.c('green', '●')} ${this.c('bold', 'Plan compiled')}`);
        console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', `Done (${toolUses} tool uses · ${this._formatTokens(tokens)} tokens · ${dur}s)`)}\n`);
    }

    showPlanApproval(planName) {
        console.log(`${this.c('green', '●')} ${this.c('bold', 'User approved APES plan')}`);
        console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', `Plan saved to: ~/.apes/plans/${planName || 'auto'}.md`)}\n`);
    }

    showUpdatedPlan() {
        console.log(`${this.c('cyan', '●')} ${this.c('bold', 'Updated plan')}`);
        console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', '/plan to preview')}\n`);
    }

    // ─── Explore Agents ───────────────────────────────────────────

    showExploreAgents(agents) {
        // agents = [{ name, toolUses, tokens }]
        if (!agents || agents.length === 0) return;

        let totalTokens = 0;
        for (const a of agents) totalTokens += a.tokens || 0;
        this._totalTokens += totalTokens;

        console.log(`${this.c('cyan', '●')} ${this.c('bold', `${agents.length} Explore agents finished`)} ${this.c('dim', '(ctrl+o to expand)')}`);

        for (let i = 0; i < agents.length; i++) {
            const a = agents[i];
            const isLast = i === agents.length - 1;
            const prefix = isLast ? '└─' : '├─';
            const line = isLast ? ' ' : '│';
            const tokenStr = this._formatTokens(a.tokens || 0);

            console.log(`   ${this.c('dim', prefix)} ${a.name} ${this.c('dim', `· ${a.toolUses || 0} tool uses · ${tokenStr} tokens`)}`);
            console.log(`   ${this.c('dim', line)}  ${this.c('dim', '⎿')} ${this.c('dim', 'Done')}`);
        }
        console.log('');
    }

    showSearchResult(pattern, filesRead) {
        console.log(`${this.c('cyan', '●')} ${this.c('dim', `Searched for ${pattern} pattern${pattern > 1 ? 's' : ''}, read ${filesRead} file${filesRead > 1 ? 's' : ''}`)} ${this.c('dim', '(ctrl+o to expand)')}\n`);
    }

    // ─── Parallel Subagent Launch ─────────────────────────────────

    showSubagentLaunch(agents) {
        // agents = [{ name, layer/role }]
        if (!agents || agents.length === 0) return;

        console.log(`${this.c('magenta', '●')} ${this.c('bold', `${agents.length} Subagents launched in parallel`)}`);

        let currentLayer = '';
        let layerIndex = 0;
        for (let i = 0; i < agents.length; i++) {
            const a = agents[i];
            const layer = a.layer || '';

            if (layer && layer !== currentLayer) {
                console.log(`   ${this.c('green', '●')} ${this.c('bold', layer)}`);
                currentLayer = layer;
                layerIndex = 0;
            }

            // determine if this is the last agent in this layer
            const nextAgent = agents[i + 1];
            const isLastInLayer = !nextAgent || nextAgent.layer !== currentLayer;
            const prefix = isLastInLayer ? '└─' : '├─';

            const indent = "  ".repeat(layerIndex);
            console.log(`     ${indent}${this.c('dim', prefix)} ${this.c('green', '●')} ${this.c('white', a.name || a.role)}`);

            layerIndex++;
        }
        console.log('');
    }

    /**
     * Show per-task agent cluster spawn.
     * Renders a tree: Task → cluster name → agents
     *
     * @param {{ taskId: string, taskTitle: string, clusterName: string, agents: object[], taskIndex: number, totalTasks: number }} data
     */
    showTaskAgentCluster(data) {
        const { taskTitle, clusterName, agents, taskIndex, totalTasks } = data;
        if (!agents || agents.length === 0) return;

        console.log(`${this.c('magenta', '●')} ${this.c('bold', `Task ${taskIndex}/${totalTasks}`)} ${this.c('dim', taskTitle.slice(0, 60))}`);
        console.log(`   ${this.c('dim', '└─')} ${this.c('cyan', '●')} ${this.c('bold', `${clusterName} Cluster`)} ${this.c('dim', `[${agents.length} agents]`)}`);

        for (let i = 0; i < agents.length; i++) {
            const a = agents[i];
            const isLast = i === agents.length - 1;
            const prefix = isLast ? '└─' : '├─';
            const indent = ' '.repeat(i);
            console.log(`        ${indent}${this.c('dim', prefix)}${this.c('green', '●')} ${this.c('white', a.name || a.role)}`);
        }
        console.log('');
    }

    // ─── Agent Activity ───────────────────────────────────────────

    spawnAgent(name, id) {
        this._agents.set(id, {
            name,
            toolUses: 0,
            tokens: 0,
            status: 'running',
            startTime: Date.now(),
            files: [],
        });
    }

    updateAgent(id, data) {
        const agent = this._agents.get(id);
        if (!agent) return;
        if (data.toolCalls != null) agent.toolUses = data.toolCalls;
        if (data.tokens != null) agent.tokens = data.tokens;
        if (data.filesWritten != null && typeof data.filesWritten === 'number') {
            // noop — file count only
        }
        if (data.time) agent.duration = data.time;
    }

    setAgentState(id, state) {
        const agent = this._agents.get(id);
        if (agent) agent.status = state;
    }

    setCoreState(state) {
        // No-op for stream
    }

    setTasks(tasks) {
        // Sync task states for task board
        if (!tasks) return;
        for (const t of tasks) {
            this._tasks.set(t.id, {
                title: t.title,
                status: t.status,
                agentName: t.assignedAgent || null,
            });
        }
    }

    // ─── File Operations ──────────────────────────────────────────

    showWrite(filePath, lineCount, previewLines) {
        console.log(`${this.c('green', '●')} ${this.c('bold', `Write(${filePath})`)}`);
        console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', `Wrote ${lineCount} lines to ${filePath}`)}`);

        if (previewLines && previewLines.length > 0) {
            const maxPreview = Math.min(previewLines.length, 10);
            for (let i = 0; i < maxPreview; i++) {
                const lineNum = String(i + 1).padStart(5);
                console.log(`  ${this.c('dim', '  ')} ${this.c('dim', lineNum)} ${previewLines[i]}`);
            }
            if (previewLines.length > 10) {
                console.log(`  ${this.c('dim', '  ')} ${this.c('dim', `… +${previewLines.length - 10} lines (ctrl+o to expand)`)}`);
            }
        }
        console.log('');

        this._filesWritten.push(filePath);
    }

    showUpdate(filePath, addedLines, removedLines, diffLines) {
        console.log(`${this.c('yellow', '●')} ${this.c('bold', `Update(${filePath})`)}`);
        console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', `Added ${addedLines} lines, removed ${removedLines} lines`)}`);

        if (diffLines && diffLines.length > 0) {
            for (const line of diffLines.slice(0, 15)) {
                if (line.startsWith('+')) {
                    console.log(`  ${this.c('dim', '  ')} ${this.c('green', line)}`);
                } else if (line.startsWith('-')) {
                    console.log(`  ${this.c('dim', '  ')} ${this.c('red', line)}`);
                } else {
                    console.log(`  ${this.c('dim', '  ')} ${this.c('dim', line)}`);
                }
            }
            if (diffLines.length > 15) {
                console.log(`  ${this.c('dim', '  ')} ${this.c('dim', `… +${diffLines.length - 15} more lines`)}`);
            }
        }
        console.log('');

        this._filesUpdated.push(filePath);
    }

    showShell(command, output) {
        console.log(`${this.c('cyan', '●')} ${this.c('bold', `Shell(${command})`)}`);
        if (output) {
            console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', output.slice(0, 120))}`);
        } else {
            console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', 'Executed in workspace')}`);
        }
        console.log('');
    }

    // ─── Verification Layer ───────────────────────────────────────

    showVerification(results) {
        // results = { snapshotTaken, hashVerified, integrityPassed }
        console.log(`${this.c('green', '●')} ${this.c('bold', 'ExecutionVerifier engaged')}`);

        if (results.snapshotTaken) {
            console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', 'Snapshot taken')}`);
        }
        if (results.hashVerified) {
            console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', 'File hash verified')}`);
        }
        if (results.integrityPassed) {
            console.log(`  ${this.c('dim', '⎿')} ${this.c('green', 'Integrity check passed')}`);
        } else if (results.integrityPassed === false) {
            console.log(`  ${this.c('dim', '⎿')} ${this.c('red', 'Integrity check failed')}`);
            if (results.reason) {
                console.log(`  ${this.c('dim', '⎿')} ${this.c('red', results.reason)}`);
            }
            console.log(`  ${this.c('dim', '⎿')} ${this.c('yellow', 'Escalating to retry')}`);
        }
        console.log('');
    }

    // ─── Memory / Learning ────────────────────────────────────────

    showMemoryUpdate(description) {
        console.log(`${this.c('magenta', '●')} ${this.c('bold', 'Memory Compression Agent')}`);
        console.log(`  ${this.c('dim', '⎿')} ${this.c('dim', description || 'Updated policy weights')}`);
        console.log('');
    }

    // ─── Task Board ───────────────────────────────────────────────

    showTaskBoard() {
        const tasks = [...this._tasks.values()];
        if (tasks.length === 0) return;

        const done = tasks.filter(t => t.status === 'completed').length;
        const failed = tasks.filter(t => t.status === 'failed').length;
        const inProgress = tasks.filter(t => t.status === 'in_progress').length;
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'blocked').length;
        const total = tasks.length;

        console.log('');
        console.log(`${this.c('dim', '✻')} ${this.c('bold', 'Execution Summary')}`);
        console.log('');
        let summary = `  ${total} tasks (${this.c('green', done + ' done')}`;
        if (failed > 0) summary += `, ${this.c('red', failed + ' failed')}`;
        summary += `, ${this.c('cyan', inProgress + ' in progress')}, ${this.c('dim', pending + ' pending')})`;
        console.log(summary);

        for (const t of tasks) {
            let icon;
            switch (t.status) {
                case 'completed':
                    icon = this.c('green', '✔');
                    break;
                case 'in_progress':
                    icon = this.c('cyan', '◼');
                    break;
                case 'failed':
                    icon = this.c('red', '✗');
                    break;
                default:
                    icon = this.c('dim', '◻');
            }
            console.log(`  ${icon} ${t.status === 'completed' ? this.c('dim', t.title) : t.title}`);
        }
        console.log('');
    }

    // ─── Generic Log (legacy compat) ──────────────────────────────

    log(message) {
        // Map legacy animation log messages to structured output
        if (message.startsWith('Tool: write_file')) {
            const detail = message.match(/\((.*?)\)/);
            const path = detail ? detail[1] : 'file';
            this.showWrite(path, 0, null);
            return;
        }

        if (message.startsWith('Tool: edit_file') || message.startsWith('Tool: multi_replace_file_content') || message.startsWith('Tool: replace_file_content')) {
            const detail = message.match(/\((.*?)\)/);
            const path = detail ? detail[1] : 'file';
            this.showUpdate(path, 0, 0, null);
            return;
        }

        if (message.startsWith('Tool: run_command')) {
            const detail = message.match(/\((.*?)\)/);
            const cmd = detail ? detail[1] : 'command';
            this.showShell(cmd);
            return;
        }

        if (message.startsWith('Task completed')) {
            const dur = message.match(/\((.*?)\)/)?.[1] || '';
            console.log(`${this.c('green', '●')} Task completed ${this.c('dim', `· ${dur}`)}`);
            return;
        }

        if (message.startsWith('Task claimed')) {
            console.log(`${this.c('cyan', '●')} ${message}`);
            return;
        }

        if (message.startsWith('Task failed') || message.startsWith('Retrying task')) {
            console.log(`${this.c('red', '●')} ${message}`);
            return;
        }

        // General log
        console.log(`${this.c('dim', '●')} ${message}`);
    }

    // ─── Internal Helpers ─────────────────────────────────────────

    _formatTokens(tokens) {
        if (tokens >= 1000) {
            return (tokens / 1000).toFixed(1) + 'k';
        }
        return String(tokens);
    }

    /**
     * Generate a random realistic token count for simulation.
     * @param {'small'|'medium'|'large'} scale
     * @returns {number}
     */
    static simulateTokens(scale = 'medium') {
        const ranges = {
            small: [5000, 15000],
            medium: [20000, 60000],
            large: [80000, 150000],
        };
        const [min, max] = ranges[scale] || ranges.medium;
        return Math.floor(Math.random() * (max - min) + min);
    }

    /**
     * Generate a random realistic tool use count.
     * @param {'small'|'medium'|'large'} scale
     * @returns {number}
     */
    static simulateToolUses(scale = 'medium') {
        const ranges = {
            small: [3, 12],
            medium: [8, 25],
            large: [15, 45],
        };
        const [min, max] = ranges[scale] || ranges.medium;
        return Math.floor(Math.random() * (max - min) + min);
    }
}
