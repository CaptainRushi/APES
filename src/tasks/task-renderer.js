/**
 * Task Tree Renderer — Compact Live Terminal Display
 *
 * Renders a pinned task checklist at the bottom of the terminal,
 * exactly like Claude Code's "Update Todos" panel:
 *
 *   ┌ Task Progress ──────────────────────────────────
 *   ├  ✓  Research watch designs
 *   ├  ◐  Create HTML structure           ← agent-frontend
 *   ├  ⊘  Style with CSS
 *   └  ☐  Deploy the website
 *   ─────────────────────────────────────────────────
 *   Agents: ■ frontend ■ research ■ styling  (3 active)
 *   4 done · 1 running · 2 blocked · 0 failed / 7 total
 *
 * Features:
 *   - Bottom-pinned: task list always stays at the bottom
 *   - Console interception: logs scroll ABOVE the task list
 *   - Compact agent cluster: small team box, no flickering tree
 *   - Live updating: checkboxes update as tasks complete
 */

import { TaskEngine } from './task-engine.js';
import * as readline from 'node:readline';

// ─── Status symbols and colors ───────────────────────────────────
const STATUS_DISPLAY = {
    pending: { symbol: '☐', color: 'dim', label: '☐' },
    blocked: { symbol: '⊘', color: 'yellow', label: '⊘' },
    in_progress: { symbol: '◐', color: 'cyan', label: '◐' },
    completed: { symbol: '✓', color: 'green', label: '✓' },
    failed: { symbol: '✗', color: 'red', label: '✗' },
};

// ─── ANSI color codes ────────────────────────────────────────────
const COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
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
    bgGray: '\x1b[48;5;236m',
};

function c(color, text) {
    return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

export class TaskTreeRenderer {
    /**
     * @param {string} sessionId
     */
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.engine = new TaskEngine(sessionId);
        this._pollTimer = null;
        this._lastSnapshot = '';
        this._lineCount = 0;
        this._isRendering = false;
        this._isPatched = false;
        this._originalWrite = null;
        this._originalErrWrite = null;

        // Compact agent tracking (no animation engine needed)
        this._agents = new Map(); // agentId -> { name, task, state }
    }

    // ─── Agent Tracking (compact, no animation) ──────────────────

    /**
     * Register an agent for compact display.
     * @param {string} agentId
     * @param {string} name — short display name
     * @param {string} taskTitle — the task this agent is working on
     */
    addAgent(agentId, name, taskTitle = '') {
        this._agents.set(agentId, {
            name: name || agentId.split('-').pop(),
            task: taskTitle.slice(0, 40),
            state: 'running',
        });
    }

    setAgentState(agentId, state) {
        const ag = this._agents.get(agentId);
        if (ag) ag.state = state;
    }

    // ─── Static Rendering ────────────────────────────────────────

    renderPlannerHeader(objective) {
        console.log('');
        console.log(`  ${c('cyan', 'apes')}${c('dim', ' ›')} ${c('white', objective)}`);
        console.log('');
    }

    renderTaskTree(tasks, silent = false) {
        const tree = tasks || this.engine.getTaskTree();
        if (tree.length === 0) {
            const line = `  ${c('dim', '  No tasks created yet.')}`;
            if (!silent) console.log(line);
            return silent ? [line] : line;
        }

        const lines = [];
        for (let i = 0; i < tree.length; i++) {
            const isLast = i === tree.length - 1;
            this._renderNode(tree[i], '', isLast, lines);
        }

        if (!silent) {
            const output = lines.join('\n');
            console.log(output);
            return output;
        }
        return lines;
    }

    renderStatusBar(silent = false) {
        const status = this.engine.getStatus();
        const lines = [
            `  ${c('dim', '─'.repeat(48))}`,
            `  Tasks: ${c('green', status.completed + '✓')} ` +
            `${c('cyan', status.inProgress + '→')} ` +
            `${c('dim', status.pending + '○')} ` +
            `${c('yellow', status.blocked + '⊘')} ` +
            `${c('red', status.failed + '✗')} ` +
            `${c('dim', '/ ' + status.total + ' total')}`,
            `  ${c('dim', '─'.repeat(48))}`
        ];

        if (!silent) {
            const output = lines.join('\n');
            console.log(output);
            return output;
        }
        return lines;
    }

    renderFull(objective) {
        this.renderPlannerHeader(objective);
        this.renderTaskTree();
        this.renderStatusBar();
    }

    // ─── Bottom-Pinned Live Mode ─────────────────────────────────

    /**
     * Build the compact pinned frame.
     * Shows: agent cluster box + task list + status bar.
     * No animation engine — pure status-based rendering.
     */
    _buildPinnedFrame() {
        const status = this.engine.getStatus();
        const lines = [];

        // ─── Compact Agent Cluster Box ──────────────────────────
        const agents = [...this._agents.values()];
        const running = agents.filter(a => a.state === 'running');
        const completed = agents.filter(a => a.state === 'completed');

        if (agents.length > 0) {
            // Compact one-line agent summary
            const agentChips = running
                .map(a => `${c('cyan', '■')} ${c('white', a.name)}`)
                .join('  ');

            const completedChips = completed.length > 0
                ? `  ${c('dim', `+${completed.length} done`)}`
                : '';

            lines.push(`  ${c('bold', c('magenta', '🦍 Agents'))} ${c('dim', `(${running.length} active · ${completed.length} done / ${agents.length} spawned)`)}`);

            if (running.length > 0) {
                // Show up to 6 running agents on one compact line
                const shown = running.slice(0, 6);
                const overflow = running.length > 6 ? `  ${c('dim', `+${running.length - 6} more`)}` : '';
                lines.push(`  ${shown.map(a => `${c('cyan', '■')} ${c('dim', a.name)}`).join('  ')}${overflow}`);
            }

            lines.push('');
        }

        // ─── Task List ──────────────────────────────────────────
        lines.push(`  ${c('bold', c('cyan', '┌ Task Progress'))}`);

        const flatTasks = this.engine.getAllTasks();
        for (let i = 0; i < flatTasks.length; i++) {
            const task = flatTasks[i];
            const isLast = i === flatTasks.length - 1;
            const connector = isLast ? '└' : '├';

            let statusIcon;
            switch (task.status) {
                case 'completed':
                    statusIcon = c('green', '✓');
                    break;
                case 'in_progress':
                    statusIcon = c('cyan', '◐');
                    break;
                case 'failed':
                    statusIcon = c('red', '✗');
                    break;
                case 'blocked':
                    statusIcon = c('yellow', '⊘');
                    break;
                default:
                    statusIcon = c('dim', '☐');
            }

            const title = task.status === 'completed'
                ? c('dim', task.title)
                : task.status === 'in_progress'
                    ? c('cyan', task.title)
                    : c('white', task.title);

            const agentTag = task.assignedAgent
                ? ` ${c('dim', '← ' + task.assignedAgent.split('-').pop())}`
                : '';

            lines.push(`  ${c('dim', connector)}  ${statusIcon}  ${title}${agentTag}`);
        }

        // ─── Status Summary ─────────────────────────────────────
        lines.push(`  ${c('dim', '─'.repeat(48))}`);
        lines.push(
            `  ${c('green', status.completed + ' done')} ` +
            `${c('cyan', status.inProgress + ' running')} ` +
            `${c('dim', status.pending + ' pending')} ` +
            `${c('yellow', status.blocked + ' blocked')} ` +
            `${c('red', status.failed + ' failed')} ` +
            `${c('dim', '/ ' + status.total + ' total')}`
        );

        return lines;
    }

    /**
     * Draw the pinned frame at the bottom of the terminal.
     * Uses VT100 escape codes to overwrite in-place without scrolling.
     */
    _drawPinnedFrame() {
        if (this._isRendering) return; // prevent re-entrant rendering
        this._isRendering = true;

        const lines = this._buildPinnedFrame();
        const write = this._originalWrite || process.stdout.write.bind(process.stdout);

        // Move cursor to start of our pinned region and clear everything below
        if (this._lineCount > 0) {
            write(`\x1b[${this._lineCount}A\x1b[0G\x1b[J`);
        } else {
            write(`\x1b[0G\x1b[J`);
        }

        // Write the frame lines joined by newline (NO trailing newline to prevent scroll)
        if (lines.length > 0) {
            write(lines.join('\n'));
            this._lineCount = lines.length - 1;
        } else {
            this._lineCount = 0;
        }

        this._isRendering = false;
    }

    /**
     * Intercept process.stdout so any console.log() while live mode is on:
     *   1. Erases the pinned frame
     *   2. Writes the log content
     *   3. Re-draws the pinned frame below it
     */
    _patchConsole() {
        if (this._isPatched) return;
        this._isPatched = true;
        this._originalWrite = process.stdout.write.bind(process.stdout);
        this._originalErrWrite = process.stderr.write.bind(process.stderr);

        const self = this;

        process.stdout.write = function (...args) {
            if (self._isRendering) {
                return self._originalWrite(...args);
            }

            self._isRendering = true;

            // 1. Erase the pinned UI
            if (self._lineCount > 0) {
                self._originalWrite(`\x1b[${self._lineCount}A\x1b[0G\x1b[J`);
            } else {
                self._originalWrite(`\x1b[0G\x1b[J`);
            }

            // 2. Write log content
            const ret = self._originalWrite(...args);

            // 3. Reset line count and redraw pinned UI below
            self._lineCount = 0;
            self._isRendering = false;
            self._drawPinnedFrame();

            return ret;
        };
    }

    _unpatchConsole() {
        if (this._isPatched && this._originalWrite) {
            process.stdout.write = this._originalWrite;
            this._isPatched = false;
        }
    }

    /**
     * Start live mode — pins task list to bottom and redraws on interval.
     * Uses a 500ms poll (not 50ms) to prevent flickering.
     * @param {number} [interval=500] — Refresh rate
     */
    startLive(interval = 500) {
        this.stopLive();
        this._lastSnapshot = '';
        this._lineCount = 0;

        // Patch console FIRST so all output goes above the pinned frame
        this._patchConsole();

        // Draw initial frame
        this._drawPinnedFrame();

        // Poll for task status changes only (no animation ticking)
        this._pollTimer = setInterval(() => {
            const taskStr = JSON.stringify(this.engine.getAllTasks().map(t => t.status));
            const agentStr = JSON.stringify([...this._agents.values()].map(a => a.state));
            const snapshot = taskStr + agentStr;

            if (snapshot !== this._lastSnapshot) {
                this._lastSnapshot = snapshot;
                this._drawPinnedFrame();
            }
        }, interval);
    }

    /**
     * Stop live mode and clean up.
     */
    stopLive() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this._unpatchConsole();
    }

    /**
     * Force a manual refresh of the pinned frame.
     */
    renderLiveFrame(force = false) {
        this._drawPinnedFrame();
    }

    isLive() {
        return this._pollTimer !== null;
    }

    // ─── Internal Tree Rendering ─────────────────────────────────

    _renderNode(node, prefix, isLast, lines) {
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';
        const display = STATUS_DISPLAY[node.status] || STATUS_DISPLAY.pending;

        const checkbox = c(display.color, `[${display.label}]`);
        const title = node.status === 'completed'
            ? c('dim', node.title)
            : c('white', node.title);

        const agentSuffix = node.assignedAgent
            ? ` ${c('dim', '← ' + node.assignedAgent)}`
            : '';

        const retrySuffix = node.retryCount > 0
            ? ` ${c('yellow', `(retry ${node.retryCount})`)}`
            : '';

        const line = `  ${c('dim', prefix + connector)}${node.id} ${checkbox} ${title}${agentSuffix}${retrySuffix}`;
        lines.push(line);

        if (node.children && node.children.length > 0) {
            for (let i = 0; i < node.children.length; i++) {
                const isChildLast = i === node.children.length - 1;
                this._renderNode(node.children[i], prefix + childPrefix, isChildLast, lines);
            }
        }
    }
}
