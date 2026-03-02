/**
 * APES Real-Time Terminal Animation Engine
 * Cyberpunk AI OS / Hacker System Monitor Style
 * 
 * Features:
 * - Single APES CORE at top
 * - Vertical progressive connecting lines
 * - Colored animated dots for states (Idle, Spawning, Running, etc.)
 * - In-place non-blocking rendering (via readline)
 */

const A = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightCyan: '\x1b[96m',
};

const DOT = '●';
const SPINNERS = ['◐', '◓', '◑', '◒'];

export class AnimationEngine {
    constructor() {
        this.agents = new Map();

        // APES Core internal state
        this.coreState = 'idle';
        this.statusMessage = 'WAITING FOR OBJECTIVE';
        this.learningActive = false;

        this._frame = 0;
        this._pulse = 0;
        this._spinner = 0;
    }

    // ─── Public Control API ───

    addAgent(id, name) {
        if (!this.agents.has(id)) {
            this.agents.set(id, {
                id,
                name,
                state: 'spawning', // default to spawning animation First
                startTime: Date.now(),
                duration: null,
                lineProgress: 0 // Used to animate the vertical line growing
            });
        }
        return this.agents.get(id);
    }

    setState(id, state) {
        const ag = this.agents.get(id);
        if (!ag) return;

        if (state === 'running' && ag.state !== 'running') {
            ag.startTime = Date.now();
        }

        if ((state === 'completed' || state === 'error') && ag.startTime && !ag.duration) {
            ag.duration = (Date.now() - ag.startTime) / 1000;
        }

        ag.state = state;
    }

    setCoreState(state) {
        this.coreState = state;
    }

    setStatus(message) {
        this.statusMessage = message;
    }

    setLearningPhase(active) {
        this.learningActive = active;
    }

    // ─── Internal Ticking ───

    _tick() {
        this._frame++;
        this._pulse = (this._pulse + 1) % 20; // 0-19 cycle
        this._spinner = Math.floor(this._frame / 3) % 4;

        // Advance line drawing progress for any spawning or active agents
        for (const ag of this.agents.values()) {
            if (ag.lineProgress < 3) {
                ag.lineProgress += 0.2; // takes about 15 frames to draw the line fully
            }
        }
    }

    // ─── Visual Rendering Helpers ───

    _coreDot() {
        switch (this.coreState) {
            case 'active':
                return this._pulse < 10 ? `${A.brightGreen}${DOT}${A.reset}` : `${A.green}${DOT}${A.reset}`;
            case 'highload':
                return `${A.yellow}${DOT}${A.reset}`;
            case 'error':
                return `${A.brightRed}${DOT}${A.reset}`;
            case 'learning':
                return `${A.blue}${DOT}${A.reset}`;
            default:
                return `${A.dim}${A.white}${DOT}${A.reset}`;
        }
    }

    _agentDot(state) {
        switch (state) {
            case 'idle':
                return `${A.dim}${A.white}${DOT}${A.reset}`;
            case 'spawning':
                return this._pulse < 10 ? `${A.yellow}${DOT}${A.reset}` : `${A.dim}${A.yellow}${DOT}${A.reset}`;
            case 'running':
                return this._pulse < 10 ? `${A.brightGreen}${DOT}${A.reset}` : `${A.green}${DOT}${A.reset}`;
            case 'reviewing':
                return `${A.cyan}${DOT}${A.reset}`;
            case 'learning':
                return `${A.blue}${DOT}${A.reset}`;
            case 'error':
                return `${A.red}${DOT}${A.reset}`;
            case 'completed':
                return `${A.brightGreen}${DOT}${A.reset}`;
            case 'terminated':
                return `${A.gray}${DOT}${A.reset}`;
            default:
                return `${A.dim}${DOT}${A.reset}`;
        }
    }

    _agentGlowOrLine(state, isLast) {
        // Subtle vertical wave simulation for running agents
        const base = isLast ? '└' : '├';

        if (state === 'running') {
            const glowChars = ['─', '━', '─'];
            const char = glowChars[Math.floor(this._frame / 5) % 3];
            return `${A.cyan}${base}${char}─${A.reset}`;
        }
        return `${A.gray}${base}──${A.reset}`;
    }

    // ─── Building the Frame ───

    /**
     * Build the ASCII frame as an array of strings.
     * Exported into string lines so TaskTreeRenderer can print it safely at the top.
     */
    _buildFrame() {
        const lines = [];

        // Main APES Core
        lines.push(`  ${A.bold}${A.brightCyan}APES CORE${A.reset} ${this._coreDot()}`);

        // Vertical spacer below core
        if (this.agents.size > 0) {
            lines.push(`  ${A.gray}│${A.reset}`);
        } else {
            lines.push(`  ${A.dim}│ (awaiting agent spawn)${A.reset}`);
        }

        // Sub-agents
        const agentArr = Array.from(this.agents.values());
        for (let i = 0; i < agentArr.length; i++) {
            const ag = agentArr[i];
            const isLast = i === agentArr.length - 1;

            // Draw progressive line if still spawning
            if (ag.lineProgress < 3) {
                // progressive vertical draw trick
                if (ag.lineProgress > 1) lines.push(`  ${A.gray}│${A.reset}`);
                if (ag.lineProgress > 2) lines.push(`  ${A.gray}│${A.reset}`);
                continue; // Wait until line is formed to show dot
            }

            const conn = this._agentGlowOrLine(ag.state, isLast);
            const dot = this._agentDot(ag.state);
            const dur = (ag.state === 'completed' && ag.duration != null)
                ? ` ${A.dim}(${ag.duration.toFixed(1)}s)${A.reset}` : '';

            lines.push(`  ${conn} ${dot} ${A.white}${ag.name}${dur}`);

            // Intermediate spacer between agents to create vertical height
            if (!isLast) {
                lines.push(`  ${A.gray}│${A.reset}`);
            }
        }

        lines.push('');

        // Bottom status area
        if (this.learningActive) {
            const s = SPINNERS[this._spinner];
            lines.push(`  ${A.blue}${s} Memory Compression Active...${A.reset}`);
            lines.push(`  ${A.blue}${s} Learning Pattern Updated...${A.reset}`);
            lines.push(`  ${A.blue}${s} Policy Weights Adjusted...${A.reset}`);
        } else {
            const active = agentArr.filter(a => a.state === 'running' || a.state === 'spawning').length;
            const completed = agentArr.filter(a => a.state === 'completed').length;

            lines.push(`  ${A.dim}System Status:${A.reset}    ${A.bold}${this.statusMessage}${A.reset}`);
            lines.push(`  ${A.dim}Active Threads:${A.reset}   ${A.green}${active}${A.reset}`);
            if (agentArr.length > 0) {
                lines.push(`  ${A.dim}Agents Completed:${A.reset} ${A.brightGreen}${completed} / ${agentArr.length}${A.reset}`);
            }
        }

        return lines;
    }
}
