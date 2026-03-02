/**
 * Cluster Animation Engine
 *
 * Real-time terminal animation for 64-agent cluster-grouped visualization.
 * Renders clusters as collapsible groups — only active clusters are expanded.
 * Max ~30-35 terminal lines.
 *
 * Agent State Machine:
 *   IDLE → SPAWNING → RUNNING → REVIEWING → COMPLETED | ERROR → TERMINATED
 */
import * as readline from 'node:readline';

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
    clearLine: '\x1b[2K',
    col0: '\x1b[0G',
    up: (n) => `\x1b[${n}A`,
};

const DOT = '●';
const SPINNERS = ['◐', '◓', '◑', '◒'];

/** How long (ms) after last activity before a cluster auto-collapses */
const COLLAPSE_DELAY = 2000;

export class ClusterAnimationEngine {
    constructor() {
        /** @type {Map<string, { id: string, name: string, agents: Map<string, AgentState> , lastActive: number }>} */
        this.clusters = new Map();

        /** Flat agent lookup for setState / addAgent by ID */
        this._agentCluster = new Map();

        /** @type {'idle'|'active'|'highload'|'error'|'learning'} */
        this.coreState = 'idle';
        this.statusMessage = 'INITIALIZING';
        this.learningActive = false;

        this._frame = 0;
        this._pulse = 0;
        this._spinner = 0;
        this._lineCount = 0;
        this._timer = null;
    }

    // ─── Public API (same interface as AnimationEngine) ───────────────────────

    /**
     * Register a cluster for display.
     * @param {string} clusterId
     * @param {string} clusterName
     */
    addCluster(clusterId, clusterName) {
        if (!this.clusters.has(clusterId)) {
            this.clusters.set(clusterId, {
                id: clusterId,
                name: clusterName,
                agents: new Map(),
                lastActive: 0,
            });
        }
    }

    addAgent(id, name, clusterId) {
        // Ensure cluster exists (fallback to "default")
        if (clusterId && !this.clusters.has(clusterId)) {
            this.addCluster(clusterId, clusterId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
        }
        const cid = clusterId || 'default';
        if (!this.clusters.has(cid)) {
            this.addCluster(cid, 'Default');
        }
        const cluster = this.clusters.get(cid);
        cluster.agents.set(id, { id, name, state: 'idle', startTime: null, duration: null });
        this._agentCluster.set(id, cid);
    }

    setState(id, newState) {
        const cid = this._agentCluster.get(id);
        if (!cid) return;
        const cluster = this.clusters.get(cid);
        if (!cluster) return;
        const ag = cluster.agents.get(id);
        if (!ag) return;

        if (newState === 'running' && !ag.startTime) {
            ag.startTime = Date.now();
        }
        if ((newState === 'completed' || newState === 'error') && ag.startTime && !ag.duration) {
            ag.duration = (Date.now() - ag.startTime) / 1000;
        }

        ag.state = newState;

        // Track last active time for auto-collapse
        if (newState === 'running' || newState === 'spawning') {
            cluster.lastActive = Date.now();
        }
    }

    setCoreState(state) { this.coreState = state; }
    setStatus(msg) { this.statusMessage = msg; }

    start() {
        if (this._timer) return;
        this._lineCount = 0;
        this._render();
        this._timer = setInterval(() => { this._tick(); this._render(); }, 50); // 20 FPS
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._render();
        process.stdout.write('\n');
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    _tick() {
        this._frame++;
        this._pulse = (this._pulse + 1) % 20;
        this._spinner = Math.floor(this._frame / 3) % 4;
    }

    /** Should a cluster be expanded? */
    _isExpanded(cluster) {
        const now = Date.now();
        for (const ag of cluster.agents.values()) {
            if (ag.state === 'running' || ag.state === 'spawning') return true;
        }
        // Stay expanded for a brief period after last activity
        if (cluster.lastActive > 0 && (now - cluster.lastActive) < COLLAPSE_DELAY) {
            return true;
        }
        return false;
    }

    _dot(state) {
        switch (state) {
            case 'idle': return `${A.dim}${A.white}${DOT}${A.reset}`;
            case 'spawning': return this._pulse < 10 ? `${A.yellow}${DOT}${A.reset}` : `${A.dim}${A.yellow}${DOT}${A.reset}`;
            case 'running': return this._pulse < 10 ? `${A.brightGreen}${DOT}${A.reset}` : `${A.green}${DOT}${A.reset}`;
            case 'reviewing': return `${A.cyan}${DOT}${A.reset}`;
            case 'learning': return `${A.blue}${DOT}${A.reset}`;
            case 'error': return this._pulse < 5 ? `${A.brightRed}${DOT}${A.reset}` : `${A.red}${DOT}${A.reset}`;
            case 'completed': return `${A.brightGreen}${DOT}${A.reset}`;
            case 'terminated': return `${A.gray}${DOT}${A.reset}`;
            default: return `${A.dim}${DOT}${A.reset}`;
        }
    }

    _coreDot() {
        switch (this.coreState) {
            case 'active': {
                const phase = Math.floor(this._frame / 10) % 2;
                return phase === 0 ? `${A.brightGreen}${DOT}${A.reset}` : `${A.green}${DOT}${A.reset}`;
            }
            case 'highload': return `${A.yellow}${DOT}${A.reset}`;
            case 'error': return this._pulse < 5 ? `${A.brightRed}${DOT}${A.reset}` : `${A.red}${DOT}${A.reset}`;
            case 'learning': return `${A.blue}${DOT}${A.reset}`;
            default: return `${A.dim}${A.white}${DOT}${A.reset}`;
        }
    }

    _stateTag(state) {
        const tags = {
            idle: `${A.dim}[idle]${A.reset}`,
            spawning: `${A.yellow}[spawning...]${A.reset}`,
            running: `${A.green}[running]${A.reset}`,
            reviewing: `${A.cyan}[reviewing]${A.reset}`,
            learning: `${A.blue}[learning]${A.reset}`,
            error: `${A.red}[error]${A.reset}`,
            completed: `${A.brightGreen}[done]${A.reset}`,
            terminated: `${A.gray}[terminated]${A.reset}`,
        };
        return tags[state] ?? '';
    }

    _clusterSummary(cluster) {
        let running = 0, completed = 0, errored = 0, total = 0;
        for (const ag of cluster.agents.values()) {
            total++;
            if (ag.state === 'running' || ag.state === 'spawning') running++;
            else if (ag.state === 'completed' || ag.state === 'terminated') completed++;
            else if (ag.state === 'error') errored++;
        }
        return { running, completed, errored, total };
    }

    _buildFrame() {
        const lines = [];

        // ── APES CORE header ──
        lines.push(`  ${A.bold}${A.brightCyan}APES CORE${A.reset}  ${this._coreDot()}  ${A.dim}[64 agents · 8 clusters]${A.reset}`);
        lines.push('');

        const clusterArr = [...this.clusters.values()];

        if (clusterArr.length === 0) {
            lines.push(`  ${A.dim}(no agents spawned yet)${A.reset}`);
        } else {
            for (let ci = 0; ci < clusterArr.length; ci++) {
                const cluster = clusterArr[ci];
                const expanded = this._isExpanded(cluster);
                const summary = this._clusterSummary(cluster);
                const isLast = ci === clusterArr.length - 1;
                const connector = isLast ? '└' : '├';

                // Cluster color based on state
                let clusterColor = A.gray;
                if (summary.running > 0) clusterColor = A.cyan;
                else if (summary.errored > 0) clusterColor = A.red;
                else if (summary.completed > 0) clusterColor = A.green;

                const arrow = expanded ? '▼' : '▶';
                const stats = `${A.dim}${summary.running} active · ${summary.completed}/${summary.total} done${A.reset}`;

                lines.push(`  ${A.gray}${connector}─${A.reset} ${clusterColor}${arrow} ${A.bold}${cluster.name}${A.reset}  ${stats}`);

                if (expanded) {
                    const agents = [...cluster.agents.values()];
                    const vBar = isLast ? ' ' : '│';
                    for (let ai = 0; ai < agents.length; ai++) {
                        const ag = agents[ai];
                        const agLast = ai === agents.length - 1;
                        const agConn = agLast ? '└──' : '├──';
                        const dur = ag.duration != null ? ` ${A.dim}(${ag.duration.toFixed(1)}s)${A.reset}` : '';

                        lines.push(
                            `  ${A.gray}${vBar}  ${agConn}${A.reset} ` +
                            `${this._dot(ag.state)} ` +
                            `${ag.name} ` +
                            `${this._stateTag(ag.state)}${dur}`
                        );
                    }
                }
            }
        }

        lines.push('');

        // ── Footer ──
        if (this.learningActive) {
            const s = SPINNERS[this._spinner];
            lines.push(`  ${A.blue}${s} Memory Compression Active...${A.reset}`);
            lines.push(`  ${A.blue}${s} Learning Pattern Updated...${A.reset}`);
            lines.push(`  ${A.blue}${s} Policy Weights Adjusted...${A.reset}`);
        } else {
            let totalRunning = 0, totalCompleted = 0, totalAgents = 0;
            for (const cl of this.clusters.values()) {
                for (const ag of cl.agents.values()) {
                    totalAgents++;
                    if (ag.state === 'running' || ag.state === 'spawning') totalRunning++;
                    if (ag.state === 'completed' || ag.state === 'terminated') totalCompleted++;
                }
            }

            lines.push(`  ${A.dim}Status:${A.reset}    ${A.bold}${this.statusMessage}${A.reset}`);
            if (totalAgents > 0) {
                lines.push(
                    `  ${A.dim}Threads:${A.reset}   ${A.yellow}${totalRunning}${A.reset}` +
                    `   ${A.dim}Completed:${A.reset} ${A.brightGreen}${totalCompleted}/${totalAgents}${A.reset}` +
                    `   ${A.dim}Clusters:${A.reset} ${A.cyan}${this.clusters.size}${A.reset}`
                );
            }
        }

        return lines;
    }

    _render() {
        const frame = this._buildFrame();

        // Build the entire update as a single string and flush once.
        // This replaces up to 35 individual write/cursor syscalls per frame
        // (at 20 fps that was ~700 syscalls/sec) with a single write.
        const ESC = '\x1b';
        const parts = [];

        // Move cursor up to overwrite previous frame
        if (this._lineCount > 0) {
            parts.push(`${ESC}[${this._lineCount}A`); // cursor up N lines
        }

        // Write each new line with an erase-to-EOL prefix
        for (const line of frame) {
            parts.push(`${ESC}[2K${ESC}[0G${line}\n`); // erase line, go to col 0, write
        }

        // If the new frame is shorter, blank out leftover lines from the old frame
        if (this._lineCount > frame.length) {
            const diff = this._lineCount - frame.length;
            for (let i = 0; i < diff; i++) {
                parts.push(`${ESC}[2K${ESC}[0G\n`);
            }
            // Move cursor back up past the blank lines so next render overwrites them
            parts.push(`${ESC}[${diff}A`);
        }

        process.stdout.write(parts.join(''));
        this._lineCount = frame.length;
    }
}
