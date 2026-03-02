/**
 * APES Terminal Animation Engine — Cyberpunk AI OS Dashboard
 *
 * Real-time terminal animation system that visualizes:
 *   - APES Core orchestrator with pulsing status dot
 *   - Multiple parallel sub-agents with independent state machines
 *   - Agent spawning with progressive line-draw animation
 *   - Color-changing status dots with heartbeat/flicker effects
 *   - Dynamic ASCII connecting lines with energy flow
 *   - Live system status panel
 *
 * Technical:
 *   - ANSI escape sequences for cursor control + 256-color
 *   - Non-blocking async render loop at ~16ms (60 FPS cap, throttled to 20 FPS for output)
 *   - Zero dependencies beyond Node.js builtins
 *   - CPU-efficient: only redraws changed regions
 *
 * Usage:
 *   const engine = new TerminalAnimationEngine();
 *   engine.start();
 *   engine.spawnAgent('Planner Agent', 'planner');
 *   engine.setAgentState('planner', 'running');
 *   // ...later
 *   engine.stop();
 */

// ─── ANSI Escape Helpers ─────────────────────────────────────────

const ESC = '\x1b[';
const ANSI = {
    // Cursor
    hide: `${ESC}?25l`,
    show: `${ESC}?25h`,
    home: `${ESC}H`,
    clear: `${ESC}2J`,
    clearLine: `${ESC}2K`,
    moveTo: (r, c) => `${ESC}${r};${c}H`,
    moveUp: (n) => `${ESC}${n}A`,
    moveDown: (n) => `${ESC}${n}B`,
    saveCursor: `${ESC}s`,
    restoreCursor: `${ESC}u`,

    // Colors (256-color mode)
    fg: (code) => `${ESC}38;5;${code}m`,
    bg: (code) => `${ESC}48;5;${code}m`,
    reset: `${ESC}0m`,
    bold: `${ESC}1m`,
    dim: `${ESC}2m`,
    italic: `${ESC}3m`,
    blink: `${ESC}5m`,

    // Named colors
    white: `${ESC}37m`,
    gray: `${ESC}90m`,
    red: `${ESC}31m`,
    green: `${ESC}32m`,
    yellow: `${ESC}33m`,
    blue: `${ESC}34m`,
    magenta: `${ESC}35m`,
    cyan: `${ESC}36m`,
    brightGreen: `${ESC}92m`,
    brightCyan: `${ESC}96m`,
    brightYellow: `${ESC}93m`,
    brightWhite: `${ESC}97m`,
    brightRed: `${ESC}91m`,
    brightBlue: `${ESC}94m`,
    brightMagenta: `${ESC}95m`,
};

// ─── Color Palettes ──────────────────────────────────────────────

const STATE_COLORS = {
    idle: { primary: ANSI.dim + ANSI.white, dot: 250, label: 'Idle' },
    spawning: { primary: ANSI.yellow, dot: 220, label: 'Spawning' },
    running: { primary: ANSI.green, dot: 34, label: 'Running', altDot: 46 },
    reviewing: { primary: ANSI.cyan, dot: 51, label: 'Reviewing' },
    learning: { primary: ANSI.blue, dot: 33, label: 'Learning' },
    error: { primary: ANSI.red, dot: 196, label: 'Error' },
    completed: { primary: ANSI.brightGreen, dot: 82, label: 'Completed' },
    terminated: { primary: ANSI.gray, dot: 240, label: 'Terminated' },
};

const CORE_STATE_COLORS = {
    stable: { primary: ANSI.brightGreen, dot: 46, label: 'STABLE' },
    highLoad: { primary: ANSI.brightYellow, dot: 220, label: 'HIGH LOAD' },
    error: { primary: ANSI.brightRed, dot: 196, label: 'ERROR' },
    learning: { primary: ANSI.brightBlue, dot: 33, label: 'LEARNING' },
    optimized: { primary: ANSI.brightCyan, dot: 87, label: 'OPTIMIZED' },
};

// ─── Special Characters ──────────────────────────────────────────

const CHARS = {
    dot: '●',
    dotSmall: '•',
    dotHollow: '○',
    pipe: '│',
    branch: '├',
    lastBranch: '└',
    horizontal: '──',
    arrow: '→',
    check: '✔',
    cross: '✗',
    lightning: '⚡',
    gear: '⚙',
    brain: '🧠',
    fire: '🔥',
    rocket: '🚀',
    shield: '🛡',
    // Spinner frames
    spinnerFrames: ['◐', '◓', '◑', '◒'],
    // Braille animation frames (energy flow)
    energyFlow: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
    // Block elements for bars
    barFull: '█',
    barHalf: '▓',
    barLight: '░',
    // Progress dots
    progressDots: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
};

// ─── Agent State Machine ─────────────────────────────────────────

const AGENT_TRANSITIONS = {
    idle: ['spawning'],
    spawning: ['running'],
    running: ['reviewing', 'completed', 'error'],
    reviewing: ['completed', 'error', 'running'],
    learning: ['completed', 'terminated'],
    error: ['terminated', 'spawning'],
    completed: ['learning', 'terminated'],
    terminated: [],
};

class AgentVisual {
    constructor(id, name, role = 'general') {
        this.id = id;
        this.name = name;
        this.role = role;
        this.state = 'idle';
        this.spawnProgress = 0;      // 0-1 for line draw animation
        this.pulsePhase = Math.random() * Math.PI * 2;  // Offset pulsing
        this.flickerTimer = 0;
        this.startTime = Date.now();
        this.endTime = null;
        this.taskDescription = '';
        this.iteration = 0;
        this.toolCalls = 0;
        this.filesWritten = 0;
        this.isLast = false;
    }

    get elapsed() {
        const end = this.endTime || Date.now();
        return ((end - this.startTime) / 1000).toFixed(1);
    }

    transitionTo(newState) {
        if (AGENT_TRANSITIONS[this.state]?.includes(newState) || newState === this.state) {
            this.state = newState;
            if (newState === 'completed' || newState === 'error' || newState === 'terminated') {
                this.endTime = Date.now();
            }
            if (newState === 'spawning') {
                this.spawnProgress = 0;
                this.startTime = Date.now();
            }
            return true;
        }
        // Allow force transitions for flexibility
        this.state = newState;
        if (newState === 'completed' || newState === 'error' || newState === 'terminated') {
            this.endTime = Date.now();
        }
        return true;
    }
}

// ─── Main Animation Engine ───────────────────────────────────────

export class TerminalAnimationEngine {
    constructor(opts = {}) {
        this.fps = opts.fps || 20;
        this.maxAgents = opts.maxAgents || 20;

        /** @type {Map<string, AgentVisual>} */
        this.agents = new Map();
        this.agentOrder = [];  // ordered insertion

        // Core state
        this.coreState = 'stable';
        this.corePulsePhase = 0;
        this.systemStatus = 'INITIALIZING';
        this.taskTitle = '';
        this.totalTasks = 0;
        this.completedTasks = 0;
        this.failedTasks = 0;
        this.memoryUpdated = false;
        this.learningActive = false;
        this.tasks = [];

        // Animation state
        this._frame = 0;
        this._running = false;
        this._renderTimer = null;
        this._startTime = Date.now();
        this._lastRender = '';
        this._spinnerIdx = 0;
        this._energyFlowIdx = 0;
        this._logLines = [];
        this._maxLogLines = 3;

        // Terminal dimensions
        this._cols = process.stdout.columns || 80;
        this._rows = process.stdout.rows || 24;

        // Listen for resize
        if (process.stdout.on) {
            process.stdout.on('resize', () => {
                this._cols = process.stdout.columns || 80;
                this._rows = process.stdout.rows || 24;
            });
        }
    }

    // ─── Public API ──────────────────────────────────────────────

    start(taskTitle = '') {
        if (this._running) return;
        this._running = true;
        this._startTime = Date.now();
        this.taskTitle = taskTitle;
        this.systemStatus = 'ACTIVE';

        // Hide cursor and clear
        process.stdout.write(ANSI.hide + ANSI.clear + ANSI.home);

        // Start render loop
        const interval = Math.round(1000 / this.fps);
        this._renderTimer = setInterval(() => this._render(), interval);

        return this;
    }

    stop() {
        this._running = false;
        if (this._renderTimer) {
            clearInterval(this._renderTimer);
            this._renderTimer = null;
        }
        // Show cursor, move below content
        const totalLines = this._calculateTotalLines();
        process.stdout.write(ANSI.moveTo(totalLines + 2, 1) + ANSI.show + ANSI.reset);
    }

    /**
     * Spawn a new agent with animation.
     * @param {string} name - Display name
     * @param {string} [id] - Unique ID (auto-generated if omitted)
     * @param {string} [role] - Agent role/specialization
     * @returns {string} agent ID
     */
    spawnAgent(name, id, role = 'general') {
        const agentId = id || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const agent = new AgentVisual(agentId, name, role);
        agent.transitionTo('spawning');

        // Update previous last agent
        if (this.agentOrder.length > 0) {
            const prevLast = this.agents.get(this.agentOrder[this.agentOrder.length - 1]);
            if (prevLast) prevLast.isLast = false;
        }
        agent.isLast = true;

        this.agents.set(agentId, agent);
        this.agentOrder.push(agentId);
        this.totalTasks++;

        this.addLog(`${ANSI.yellow}${CHARS.lightning}${ANSI.reset} Spawned: ${ANSI.bold}${name}${ANSI.reset}`);

        // Auto-transition to running after spawn animation
        setTimeout(() => {
            if (agent.state === 'spawning') {
                agent.transitionTo('running');
            }
        }, 800);

        return agentId;
    }

    /**
     * Set agent state.
     * @param {string} agentId
     * @param {string} state
     */
    setAgentState(agentId, state) {
        const agent = this.agents.get(agentId);
        if (!agent) return;
        agent.transitionTo(state);

        if (state === 'completed') {
            this.completedTasks++;
            this.addLog(`${ANSI.brightGreen}${CHARS.check}${ANSI.reset} ${agent.name} ${ANSI.gray}(${agent.elapsed}s)${ANSI.reset}`);
        } else if (state === 'error') {
            this.failedTasks++;
            this.addLog(`${ANSI.red}${CHARS.cross}${ANSI.reset} ${agent.name} ${ANSI.red}failed${ANSI.reset}`);
        }

        this._updateCoreState();
    }

    /**
     * Update agent metadata for display.
     */
    updateAgent(agentId, data = {}) {
        const agent = this.agents.get(agentId);
        if (!agent) return;
        if (data.iteration !== undefined) agent.iteration = data.iteration;
        if (data.toolCalls !== undefined) agent.toolCalls = data.toolCalls;
        if (data.filesWritten !== undefined) agent.filesWritten = data.filesWritten;
        if (data.task !== undefined) agent.taskDescription = data.task;
    }

    setCoreState(state) {
        if (CORE_STATE_COLORS[state]) {
            this.coreState = state;
        }
    }

    setLearningActive(active) {
        this.learningActive = active;
        if (active) this.coreState = 'learning';
    }

    setMemoryUpdated(updated) {
        this.memoryUpdated = updated;
    }

    addLog(message) {
        this._logLines.push({ text: message, time: Date.now() });
        if (this._logLines.length > this._maxLogLines) {
            this._logLines.shift();
        }
    }

    setTasks(tasks) {
        this.tasks = tasks || [];
    }

    getAgentCount() {
        return this.agents.size;
    }

    getRunningCount() {
        return [...this.agents.values()].filter(a => a.state === 'running' || a.state === 'reviewing').length;
    }

    // ─── Internal: Render Engine ─────────────────────────────────

    _render() {
        if (!this._running) return;

        this._frame++;
        this._spinnerIdx = Math.floor(this._frame / 4) % CHARS.spinnerFrames.length;
        this._energyFlowIdx = Math.floor(this._frame / 3) % CHARS.energyFlow.length;

        // Update spawn progress for spawning agents
        for (const agent of this.agents.values()) {
            if (agent.state === 'spawning' && agent.spawnProgress < 1) {
                agent.spawnProgress = Math.min(1, agent.spawnProgress + 0.08);
            }
            agent.pulsePhase += 0.15;
            agent.flickerTimer++;
        }
        this.corePulsePhase += 0.08;

        // Build frame buffer
        const lines = [];

        // ─── Header ────────────────────────────────────────
        lines.push(this._renderHeader());

        // ─── Core Node ─────────────────────────────────────
        lines.push(this._renderCore());

        // ─── Agent Tree ────────────────────────────────────
        if (this.agents.size > 0) {
            const agentLines = this._renderAgentTree();
            lines.push(...agentLines);
        }

        // ─── Status Panel ──────────────────────────────────
        lines.push(...this._renderStatusPanel());

        // ─── Log Panel ─────────────────────────────────────
        if (this._logLines.length > 0) {
            lines.push(...this._renderLogPanel());
        }

        // ─── Learning Animation ────────────────────────────
        if (this.learningActive) {
            lines.push(...this._renderLearningPhase());
        }

        // ─── Task Panel (Always at Bottom) ─────────────────
        if (this.tasks && this.tasks.length > 0) {
            lines.push(...this._renderTaskPanel());
        }

        // Write frame
        const frame = ANSI.home + lines.map(l => ANSI.clearLine + l).join('\n');

        // Clear remaining lines from previous frame
        const totalNeeded = lines.length + 2;
        const clearExtra = Array(Math.max(0, 5)).fill(ANSI.clearLine).join('\n');

        process.stdout.write(frame + '\n' + clearExtra);
    }

    _renderHeader() {
        const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(0);
        const title = this.taskTitle ? ` ${ANSI.dim}${ANSI.gray}» ${this.taskTitle}${ANSI.reset}` : '';
        const timer = `${ANSI.gray}${elapsed}s${ANSI.reset}`;

        const headerLine = `${ANSI.fg(39)}╔${'═'.repeat(Math.min(this._cols - 2, 76))}╗${ANSI.reset}`;
        const brand = `${ANSI.fg(39)}║${ANSI.reset} ${ANSI.bold}${ANSI.fg(87)}⚡ APES${ANSI.reset}${ANSI.fg(245)} v2.0 — Autonomous Parallel Execution System${ANSI.reset}${title}  ${timer}`;
        const footerLine = `${ANSI.fg(39)}╚${'═'.repeat(Math.min(this._cols - 2, 76))}╝${ANSI.reset}`;

        return `${headerLine}\n${brand}\n${footerLine}`;
    }

    _renderCore() {
        const coreColors = CORE_STATE_COLORS[this.coreState] || CORE_STATE_COLORS.stable;

        // Pulsing dot effect
        const pulse = Math.sin(this.corePulsePhase);
        const dotCode = pulse > 0.3 ? coreColors.dot : (pulse > -0.3 ? coreColors.dot - 2 : coreColors.dot - 5);
        const safeDot = Math.max(0, Math.min(255, dotCode));

        const dot = `${ANSI.fg(safeDot)}${CHARS.dot}${ANSI.reset}`;
        const label = `${ANSI.bold}${coreColors.primary}APES CORE${ANSI.reset}`;
        const status = `${ANSI.dim}${coreColors.primary}[${coreColors.label}]${ANSI.reset}`;

        return `  ${dot} ${label} ${status}`;
    }

    _renderAgentTree() {
        const lines = [];
        const allAgentIds = this.agentOrder.filter(id => this.agents.has(id));

        let agentIds = allAgentIds;
        let hiddenCount = 0;
        const maxAgents = 3;

        if (allAgentIds.length > maxAgents) {
            const active = allAgentIds.filter(id => {
                const s = this.agents.get(id).state;
                return ['running', 'spawning', 'reviewing', 'error'].includes(s);
            });
            const inactive = allAgentIds.filter(id => !active.includes(id));

            let selected = active.slice(0, maxAgents);
            if (selected.length < maxAgents) {
                selected = [...selected, ...inactive.slice(-(maxAgents - selected.length))];
            }

            agentIds = allAgentIds.filter(id => selected.includes(id));
            hiddenCount = allAgentIds.length - agentIds.length;
        }

        for (let i = 0; i < agentIds.length; i++) {
            const agent = this.agents.get(agentIds[i]);
            const isLast = i === agentIds.length - 1 && hiddenCount === 0;

            // Vertical connection line with energy flow
            const energyChar = (agent.state === 'running' || agent.state === 'spawning')
                ? CHARS.energyFlow[this._energyFlowIdx]
                : CHARS.pipe;
            const lineColor = agent.state === 'running' ? ANSI.fg(238) : ANSI.fg(236);
            lines.push(`  ${lineColor}${energyChar}${ANSI.reset}`);

            // Branch line with agent
            const branchChar = isLast ? CHARS.lastBranch : CHARS.branch;
            const agentLine = this._renderAgentLine(agent, branchChar);
            lines.push(agentLine);
        }

        if (hiddenCount > 0) {
            lines.push(`  ${ANSI.fg(236)}${CHARS.pipe}${ANSI.reset}`);
            lines.push(`  ${ANSI.fg(236)}${CHARS.lastBranch}${CHARS.horizontal}${ANSI.reset} ${ANSI.dim}... plus ${hiddenCount} more agent(s) in swarm${ANSI.reset}`);
        }

        return lines;
    }

    _renderAgentLine(agent, branchChar) {
        const stateConfig = STATE_COLORS[agent.state] || STATE_COLORS.idle;

        // ─── Dot Animation ──────────────────────────────
        let dot;
        switch (agent.state) {
            case 'spawning': {
                // Flashing yellow
                const flash = Math.sin(agent.pulsePhase * 2) > 0;
                dot = flash
                    ? `${ANSI.fg(220)}${CHARS.dot}${ANSI.reset}`
                    : `${ANSI.fg(178)}${CHARS.dotSmall}${ANSI.reset}`;
                break;
            }
            case 'running': {
                // Heartbeat pulse between dark and bright green
                const pulse = Math.sin(agent.pulsePhase);
                const flicker = agent.flickerTimer % 47 === 0; // Micro-flicker
                if (flicker) {
                    dot = `${ANSI.fg(255)}${CHARS.dot}${ANSI.reset}`;
                } else {
                    const dotCode = pulse > 0 ? 46 : 34;
                    dot = `${ANSI.fg(dotCode)}${CHARS.dot}${ANSI.reset}`;
                }
                break;
            }
            case 'reviewing': {
                // Alternating cyan shades
                const phase = Math.sin(agent.pulsePhase) > 0;
                dot = phase
                    ? `${ANSI.fg(51)}${CHARS.dot}${ANSI.reset}`
                    : `${ANSI.fg(44)}${CHARS.dot}${ANSI.reset}`;
                break;
            }
            case 'learning': {
                // Blue pulse
                const phase = Math.sin(agent.pulsePhase) > 0;
                dot = phase
                    ? `${ANSI.fg(33)}${CHARS.dot}${ANSI.reset}`
                    : `${ANSI.fg(27)}${CHARS.dot}${ANSI.reset}`;
                break;
            }
            case 'completed':
                dot = `${ANSI.fg(82)}${CHARS.dot}${ANSI.reset}`;
                break;
            case 'error':
                dot = `${ANSI.fg(196)}${CHARS.dot}${ANSI.reset}`;
                break;
            case 'terminated':
                dot = `${ANSI.fg(240)}${CHARS.dotHollow}${ANSI.reset}`;
                break;
            default: // idle
                dot = `${ANSI.dim}${ANSI.fg(250)}${CHARS.dotSmall}${ANSI.reset}`;
        }

        // ─── Spawn Line Animation ───────────────────────
        let connectionLine;
        if (agent.state === 'spawning' && agent.spawnProgress < 1) {
            const lineLen = Math.floor(agent.spawnProgress * 3);
            const partialLine = '─'.repeat(lineLen);
            const cursor = agent.spawnProgress < 1 ? `${ANSI.fg(220)}${CHARS.arrow}${ANSI.reset}` : '';
            connectionLine = `${ANSI.fg(236)}${branchChar}${partialLine}${cursor}${ANSI.reset}`;
        } else {
            connectionLine = `${ANSI.fg(236)}${branchChar}${CHARS.horizontal}${ANSI.reset}`;
        }

        // ─── Agent Name + Meta ──────────────────────────
        const nameColor = stateConfig.primary;
        const nameStr = `${nameColor}${agent.name}${ANSI.reset}`;

        // Status suffix
        let suffix = '';
        if (agent.state === 'running') {
            const spinner = CHARS.progressDots[Math.floor(this._frame / 3) % CHARS.progressDots.length];
            suffix = ` ${ANSI.fg(238)}${spinner}${ANSI.reset}`;
            if (agent.iteration > 0) {
                suffix += ` ${ANSI.fg(240)}iter:${agent.iteration}${ANSI.reset}`;
            }
        } else if (agent.state === 'completed') {
            suffix = ` ${ANSI.fg(240)}(${agent.elapsed}s)${ANSI.reset}`;
            if (agent.filesWritten > 0) {
                suffix += ` ${ANSI.fg(82)}${agent.filesWritten} files${ANSI.reset}`;
            }
        } else if (agent.state === 'error') {
            suffix = ` ${ANSI.fg(196)}failed${ANSI.reset}`;
        } else if (agent.state === 'spawning') {
            suffix = ` ${ANSI.fg(220)}initializing...${ANSI.reset}`;
        }

        return `  ${connectionLine} ${dot} ${nameStr}${suffix}`;
    }

    _renderStatusPanel() {
        const lines = [];
        const running = this.getRunningCount();
        const total = this.agents.size;
        const completed = this.completedTasks;
        const failed = this.failedTasks;

        const divider = `${ANSI.fg(236)}${'─'.repeat(Math.min(this._cols - 4, 74))}${ANSI.reset}`;
        lines.push(`  ${divider}`);

        // Status line
        const statusColor = this.systemStatus === 'OPTIMIZED' ? ANSI.fg(87) :
            this.systemStatus === 'ACTIVE' ? ANSI.fg(46) :
                this.systemStatus === 'ERROR' ? ANSI.fg(196) :
                    ANSI.fg(220);
        const statusDot = `${statusColor}${CHARS.dot}${ANSI.reset}`;

        lines.push(`  ${ANSI.fg(245)}System Status:${ANSI.reset}  ${statusDot} ${statusColor}${this.systemStatus}${ANSI.reset}`);

        // Parallel threads bar
        const barWidth = 20;
        const filledWidth = total > 0 ? Math.round((running / Math.max(total, 1)) * barWidth) : 0;
        const bar = `${ANSI.fg(46)}${CHARS.barFull.repeat(filledWidth)}${ANSI.fg(236)}${CHARS.barLight.repeat(barWidth - filledWidth)}${ANSI.reset}`;
        lines.push(`  ${ANSI.fg(245)}Active Threads:${ANSI.reset}  ${bar} ${ANSI.fg(46)}${running}${ANSI.fg(240)}/${total}${ANSI.reset}`);

        // Task progress
        const taskBar = total > 0
            ? `${ANSI.fg(82)}${CHARS.barFull.repeat(Math.round((completed / total) * barWidth))}${ANSI.fg(196)}${CHARS.barFull.repeat(Math.round((failed / total) * barWidth))}${ANSI.fg(236)}${CHARS.barLight.repeat(Math.max(0, barWidth - Math.round((completed / total) * barWidth) - Math.round((failed / total) * barWidth)))}${ANSI.reset}`
            : `${ANSI.fg(236)}${CHARS.barLight.repeat(barWidth)}${ANSI.reset}`;
        lines.push(`  ${ANSI.fg(245)}Task Progress:${ANSI.reset}   ${taskBar} ${ANSI.fg(82)}${completed}${ANSI.fg(240)}✓ ${ANSI.fg(196)}${failed}${ANSI.fg(240)}✗${ANSI.reset}`);

        // Memory status
        const memIcon = this.memoryUpdated ? `${ANSI.fg(82)}${CHARS.check}${ANSI.reset}` : `${ANSI.fg(240)}○${ANSI.reset}`;
        lines.push(`  ${ANSI.fg(245)}Memory Updated:${ANSI.reset}  ${memIcon}`);

        return lines;
    }

    _renderLogPanel() {
        const lines = [];
        lines.push(`  ${ANSI.fg(240)}┌ Activity Log ${'─'.repeat(Math.min(this._cols - 20, 58))}┐${ANSI.reset}`);

        for (const log of this._logLines) {
            const age = Date.now() - log.time;
            const fadeColor = age > 5000 ? ANSI.fg(236) : age > 2000 ? ANSI.fg(240) : '';
            lines.push(`  ${ANSI.fg(240)}│${ANSI.reset} ${fadeColor}${log.text}${ANSI.reset}`);
        }

        lines.push(`  ${ANSI.fg(240)}└${'─'.repeat(Math.min(this._cols - 4, 72))}┘${ANSI.reset}`);
        return lines;
    }

    _renderLearningPhase() {
        const lines = [];
        const spinner = CHARS.spinnerFrames[this._spinnerIdx];

        lines.push(`  ${ANSI.fg(33)}${spinner}${ANSI.reset} ${ANSI.fg(75)}Memory Compression Active...${ANSI.reset}`);

        const learningSteps = [
            'Learning Pattern Updated...',
            'Policy Weights Adjusted...',
            'Vector Store Synchronized...',
        ];

        const visibleSteps = Math.min(learningSteps.length, Math.floor(this._frame / 15) + 1);
        for (let i = 0; i < visibleSteps; i++) {
            const stepSpinner = CHARS.spinnerFrames[(this._spinnerIdx + i) % CHARS.spinnerFrames.length];
            lines.push(`  ${ANSI.fg(33)}${stepSpinner}${ANSI.reset} ${ANSI.fg(69)}${learningSteps[i]}${ANSI.reset}`);
        }

        return lines;
    }

    _renderTaskPanel() {
        const lines = [];
        lines.push(`  ${ANSI.fg(240)}┌ Live Task List ${'─'.repeat(Math.min(this._cols - 21, 57))}┐${ANSI.reset}`);

        const maxTasks = 3;
        let displayTasks = this.tasks;
        let hiddenTasks = 0;

        if (this.tasks.length > maxTasks) {
            const activeTasks = this.tasks.filter(t => t.status === 'claimed' || t.status === 'in_progress');
            const pendingTasks = this.tasks.filter(t => t.status === 'pending');
            const failedTasks = this.tasks.filter(t => t.status === 'failed');
            const completedTasks = this.tasks.filter(t => t.status === 'completed');

            let selected = [...failedTasks, ...activeTasks, ...pendingTasks, ...completedTasks];
            displayTasks = selected.slice(0, maxTasks);

            // Re-order display tasks back to original order for stable UI
            displayTasks = this.tasks.filter(t => displayTasks.includes(t));
            hiddenTasks = this.tasks.length - displayTasks.length;
        }

        for (const t of displayTasks) {
            let icon = `${ANSI.dim}○${ANSI.reset}`;
            let color = ANSI.dim;

            if (t.status === 'completed') {
                icon = `${ANSI.green}✓${ANSI.reset}`;
                color = ANSI.green + ANSI.dim;
            } else if (t.status === 'failed') {
                icon = `${ANSI.red}✗${ANSI.reset}`;
                color = ANSI.red;
            } else if (t.status === 'claimed' || t.status === 'in_progress') {
                icon = `${ANSI.yellow}→${ANSI.reset}`;
                color = ANSI.white;
            } else {
                color = ANSI.gray;
            }

            const prefix = `  ${ANSI.fg(240)}│${ANSI.reset} ${icon} `;
            const title = t.title.slice(0, Math.min(this._cols - 12, 100)); // truncation
            lines.push(`${prefix}${color}${title}${ANSI.reset}`);
        }

        if (hiddenTasks > 0) {
            lines.push(`  ${ANSI.fg(240)}│${ANSI.reset} ${ANSI.dim}... and ${hiddenTasks} more tasks${ANSI.reset}`);
        }

        lines.push(`  ${ANSI.fg(240)}└${'─'.repeat(Math.min(this._cols - 4, 72))}┘${ANSI.reset}`);
        return lines;
    }

    _updateCoreState() {
        const agents = [...this.agents.values()];
        const hasError = agents.some(a => a.state === 'error');
        const allDone = agents.length > 0 && agents.every(a => a.state === 'completed' || a.state === 'terminated');
        const running = agents.filter(a => a.state === 'running').length;

        if (hasError) {
            this.coreState = 'error';
            this.systemStatus = 'ERROR';
        } else if (this.learningActive) {
            this.coreState = 'learning';
            this.systemStatus = 'LEARNING';
        } else if (allDone) {
            this.coreState = 'optimized';
            this.systemStatus = 'OPTIMIZED';
        } else if (running > 3) {
            this.coreState = 'highLoad';
            this.systemStatus = 'HIGH LOAD';
        } else if (running > 0) {
            this.coreState = 'stable';
            this.systemStatus = 'ACTIVE';
        }
    }

    _calculateTotalLines() {
        let lines = 5; // header + core
        lines += this.agents.size * 2; // each agent = 2 lines
        lines += 6; // status panel
        lines += this._logLines.length > 0 ? this._logLines.length + 3 : 0; // log panel
        if (this.learningActive) lines += 5;
        if (this.tasks && this.tasks.length > 0) lines += this.tasks.length + 3; // Task panel
        return lines;
    }
}

// ─── Simulation Demo ─────────────────────────────────────────────

export async function runDemo() {
    const engine = new TerminalAnimationEngine({ fps: 20 });
    engine.start('Building Watch Showcase Website');

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Phase 1: Spawn agents progressively
    await sleep(800);
    const planner = engine.spawnAgent('Planner Agent', 'planner', 'planning');
    await sleep(600);
    const research = engine.spawnAgent('Research Agent', 'research', 'research');
    await sleep(400);
    const executor = engine.spawnAgent('Executor Agent', 'executor', 'engineering');
    await sleep(400);
    const reviewer = engine.spawnAgent('Reviewer Agent', 'reviewer', 'review');
    await sleep(400);
    const tester = engine.spawnAgent('Tester Agent', 'tester', 'testing');

    // Phase 2: Running with iterations
    await sleep(1500);
    engine.updateAgent('planner', { iteration: 1, task: 'Analyzing project structure' });
    engine.addLog(`${ANSI.cyan}${CHARS.gear}${ANSI.reset} Planner analyzing complexity...`);
    await sleep(1200);
    engine.updateAgent('planner', { iteration: 2 });
    engine.updateAgent('research', { iteration: 1, task: 'Gathering design patterns' });

    await sleep(1000);
    engine.updateAgent('executor', { iteration: 1, task: 'Writing index.html' });
    engine.addLog(`${ANSI.green}📂${ANSI.reset} Executor writing files...`);

    // Phase 3: Completions
    await sleep(2000);
    engine.setAgentState('planner', 'completed');
    engine.updateAgent('planner', { filesWritten: 2 });

    await sleep(1500);
    engine.setAgentState('research', 'completed');
    engine.updateAgent('research', { filesWritten: 1 });

    await sleep(800);
    engine.updateAgent('executor', { iteration: 3, filesWritten: 3 });
    engine.addLog(`${ANSI.green}📝${ANSI.reset} Created: index.html, styles.css, app.js`);

    await sleep(2000);
    engine.setAgentState('executor', 'completed');
    engine.updateAgent('executor', { filesWritten: 5 });

    // Reviewer checks
    await sleep(1000);
    engine.setAgentState('reviewer', 'reviewing');
    engine.addLog(`${ANSI.cyan}🔍${ANSI.reset} Reviewer validating output...`);

    await sleep(2000);
    engine.setAgentState('reviewer', 'completed');

    await sleep(1000);
    engine.setAgentState('tester', 'completed');

    // Phase 4: Learning
    await sleep(800);
    engine.setLearningActive(true);
    engine.addLog(`${ANSI.blue}🧠${ANSI.reset} Learning from execution patterns...`);

    await sleep(4000);
    engine.setLearningActive(false);
    engine.setMemoryUpdated(true);
    engine.systemStatus = 'OPTIMIZED';
    engine.coreState = 'optimized';
    engine.addLog(`${ANSI.brightGreen}${CHARS.rocket}${ANSI.reset} All tasks complete. System optimized.`);

    await sleep(3000);

    // Terminate agents
    for (const id of engine.agentOrder) {
        engine.setAgentState(id, 'terminated');
        await sleep(300);
    }

    await sleep(2000);
    engine.stop();
    console.log('\n✅ Demo complete!\n');
}

// ─── Auto-run if executed directly ───────────────────────────────
const isMainModule = process.argv[1] && (
    process.argv[1].endsWith('terminal-animation.js') ||
    process.argv[1].endsWith('terminal-animation')
);

if (isMainModule) {
    runDemo().catch(console.error);
}
