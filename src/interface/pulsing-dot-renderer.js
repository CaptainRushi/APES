/**
 * PulsingDotRenderer — In-place animated dot indicators for running agents
 *
 * Renders a block of terminal lines with animated dots next to active entries,
 * then redraws that block in-place on a timer so the dots appear to pulse/flicker.
 *
 * Works in scrolling terminal mode (no full-screen clear required).
 * Uses ANSI cursor-up + erase-to-EOL to overwrite only the block it owns.
 *
 * Dot animation cycle for "running" state (cycles every tick):
 *   ● → ◉ → ○ → ◎   (4-frame cycle)
 *
 * For "spawning" state a simpler 2-frame flash:
 *   ● → •
 *
 * States that do NOT animate (static dots):
 *   completed  → ✔  (bright green)
 *   failed     → ✗  (red)
 *   idle       → ●  (dim white, no pulse)
 *   pending    → ○  (dim)
 *
 * Usage:
 *   const r = new PulsingDotRenderer();
 *   r.startBlock(taskLineStr, clusterLineStr, agentEntries);
 *   // ... later, when task completes ...
 *   r.stopBlock(finalLines);
 */

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const ESC = '\x1b[';

const A = {
    reset:       '\x1b[0m',
    bold:        '\x1b[1m',
    dim:         '\x1b[2m',
    red:         '\x1b[31m',
    green:       '\x1b[32m',
    yellow:      '\x1b[33m',
    cyan:        '\x1b[36m',
    white:       '\x1b[37m',
    gray:        '\x1b[90m',
    brightGreen: '\x1b[92m',
    brightCyan:  '\x1b[96m',
    magenta:     '\x1b[35m',
};

// 4-frame dot cycle used for "running" agents — gives a smooth pulse feel
const RUNNING_DOTS = ['●', '◉', '○', '◎'];

// 2-frame flash for "spawning" agents
const SPAWNING_DOTS = ['●', '•'];

// Bright→normal green cycle colours for the running dot (pairs with RUNNING_DOTS)
const RUNNING_COLORS = [
    A.brightGreen,  // ●  bright
    A.green,        // ◉  medium
    A.dim + A.green,// ○  dim
    A.green,        // ◎  medium
];

// Yellow flash colours for spawning
const SPAWNING_COLORS = [
    A.yellow,
    A.dim + A.yellow,
];

// Cyan pulse colours for an active cluster header dot
const CLUSTER_RUNNING_DOTS   = ['●', '◉', '○', '◉'];
const CLUSTER_RUNNING_COLORS = [
    A.brightCyan,
    A.cyan,
    A.dim + A.cyan,
    A.cyan,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the animated dot string for a given state + frame index.
 * @param {'running'|'spawning'|'completed'|'failed'|'idle'|'pending'} state
 * @param {number} frame  Current animation frame (monotonically increasing)
 * @returns {string}  ANSI-escaped dot character
 */
function agentDot(state, frame) {
    switch (state) {
        case 'running': {
            const i = frame % RUNNING_DOTS.length;
            return `${RUNNING_COLORS[i]}${RUNNING_DOTS[i]}${A.reset}`;
        }
        case 'spawning': {
            const i = frame % SPAWNING_DOTS.length;
            return `${SPAWNING_COLORS[i]}${SPAWNING_DOTS[i]}${A.reset}`;
        }
        case 'completed':
            return `${A.brightGreen}✔${A.reset}`;
        case 'failed':
            return `${A.red}✗${A.reset}`;
        case 'idle':
        default:
            return `${A.dim}${A.white}●${A.reset}`;
    }
}

/**
 * Return the animated dot for a cluster header line.
 * Pulses when the cluster has running agents.
 * @param {boolean} hasRunning
 * @param {number} frame
 * @returns {string}
 */
function clusterDot(hasRunning, frame) {
    if (!hasRunning) return `${A.cyan}●${A.reset}`;
    const i = frame % CLUSTER_RUNNING_DOTS.length;
    return `${CLUSTER_RUNNING_COLORS[i]}${CLUSTER_RUNNING_DOTS[i]}${A.reset}`;
}

// ─── PulsingDotRenderer ───────────────────────────────────────────────────────

export class PulsingDotRenderer {
    /**
     * @param {object}  [opts]
     * @param {number}  [opts.fps=5]   Frames per second for the animation tick.
     *                                 Keep low (4–6 fps) to avoid overwhelming scrollback.
     * @param {boolean} [opts.enabled=true]  Set false to disable animation (CI/pipe mode).
     */
    constructor(opts = {}) {
        this.fps     = opts.fps     ?? 5;
        this.enabled = opts.enabled ?? this._isTTY();

        /** @type {NodeJS.Timeout|null} */
        this._timer     = null;
        this._frame     = 0;
        this._lineCount = 0;    // how many lines the current block occupies in stdout

        // Active block state (set when startBlock is called)
        this._taskLine    = '';   // the top "● Task N/M ..." line
        this._clusterLine = '';   // the "   └─ ● Cluster [N agents]" line (template, dot replaced)
        /** @type {Array<{prefix: string, indent: string, name: string, state: string}>} */
        this._agents      = [];
        this._clusterName = '';
        this._agentCount  = 0;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Render a task+cluster+agent block with animated running dots.
     *
     * @param {object} opts
     * @param {string} opts.taskLine       Full pre-formatted top task line (no trailing newline).
     * @param {string} opts.clusterName    Cluster name for the header (e.g. "General").
     * @param {number} opts.agentCount     Number of agents in the cluster.
     * @param {Array<{prefix: string, indent: string, name: string, state?: string}>} opts.agents
     *                                     Agent descriptor list.  state defaults to 'running'.
     * @param {string} [opts.colors]       Object of pre-built color strings — pass the renderer's
     *                                     this.colors if you want to share a single set.
     */
    startBlock({ taskLine, clusterName, agentCount, agents }) {
        // Stop any prior animation cleanly first
        this.stopBlock();

        this._taskLine    = taskLine;
        this._clusterName = clusterName;
        this._agentCount  = agentCount;
        this._agents      = agents.map(a => ({ ...a, state: a.state ?? 'running' }));
        this._frame       = 0;
        this._lineCount   = 0;

        // Draw the initial frame synchronously so output appears immediately
        this._drawFrame();

        if (this.enabled) {
            const interval = Math.round(1000 / this.fps);
            this._timer = setInterval(() => {
                this._frame++;
                this._drawFrame();
            }, interval);
        }
    }

    /**
     * Set the state of a specific agent inside the currently running block.
     * Call this when an agent finishes so its dot updates on the next redraw.
     *
     * @param {string} name   Agent display name (must match what was passed to startBlock).
     * @param {string} state  New state: 'running' | 'completed' | 'failed' | 'idle'.
     */
    setAgentState(name, state) {
        const ag = this._agents.find(a => a.name === name);
        if (ag) {
            ag.state = state;
            // Force an immediate redraw so the terminal reflects the change without delay
            if (this.enabled) this._drawFrame();
        }
    }

    /**
     * Stop the animation, erase the animated block, and print permanent final lines.
     *
     * @param {string[]} [finalLines]  Lines to print after erasing the animated block.
     *                                 If omitted, the last animated frame is left in place.
     */
    stopBlock(finalLines) {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }

        if (!this.enabled) {
            // In non-TTY mode just print the final lines
            if (finalLines) {
                for (const line of finalLines) process.stdout.write(line + '\n');
            }
            return;
        }

        // Erase the animated region
        this._eraseBlock();

        // Print the final (static) version
        if (finalLines) {
            for (const line of finalLines) process.stdout.write(line + '\n');
        }

        this._lineCount = 0;
    }

    // ─── Internal rendering ───────────────────────────────────────────────────

    /**
     * True if stdout is a real TTY (not piped or CI).
     */
    _isTTY() {
        return Boolean(process.stdout.isTTY);
    }

    /**
     * Build the lines for the current animated frame.
     * @returns {string[]}
     */
    _buildLines() {
        const lines = [];

        // Line 1: task header (static — the magenta ● comes from the outer renderer)
        lines.push(this._taskLine);

        // Line 2: cluster header with pulsing dot
        const hasRunning = this._agents.some(a => a.state === 'running' || a.state === 'spawning');
        const cDot = clusterDot(hasRunning, this._frame);
        lines.push(
            `   ${A.dim}└─${A.reset} ${cDot} ${A.bold}${this._clusterName} Cluster${A.reset} ` +
            `${A.dim}[${this._agentCount} agents]${A.reset}`
        );

        // Lines 3+: one line per agent with animated dot
        for (let i = 0; i < this._agents.length; i++) {
            const ag = this._agents[i];
            const dot = agentDot(ag.state, this._frame);
            lines.push(`        ${ag.indent}${A.dim}${ag.prefix}${A.reset}${dot} ${A.white}${ag.name}${A.reset}`);
        }

        // Blank separator line (matches original output style)
        lines.push('');

        return lines;
    }

    /**
     * Erase the current animated block from stdout.
     */
    _eraseBlock() {
        if (this._lineCount <= 0) return;
        // Move cursor up N lines, then erase from cursor to end of screen
        process.stdout.write(`${ESC}${this._lineCount}A${ESC}0G${ESC}0J`);
        this._lineCount = 0;
    }

    /**
     * Draw (or redraw) the current animated frame in-place.
     */
    _drawFrame() {
        const lines = this._buildLines();

        if (this._lineCount > 0) {
            // Move cursor up to overwrite the previous frame
            process.stdout.write(`${ESC}${this._lineCount}A${ESC}0G`);
        }

        // Write each line, clearing to end of line first to remove stale chars
        for (let i = 0; i < lines.length; i++) {
            process.stdout.write(`${ESC}2K${ESC}0G${lines[i]}\n`);
        }

        // Track how many lines we "own" so we can move back up on the next frame
        this._lineCount = lines.length;
    }
}
