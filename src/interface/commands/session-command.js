/**
 * Session Command — CLI handler for multi-terminal session management
 *
 * Commands:
 *   /session status     — Show current session state
 *   /session list       — List all sessions
 *   /session connect ID — Join an existing session
 *   /session disconnect — Leave current session
 *   /session close      — Shutdown entire session (host only)
 *   /session tasks      — Show shared task graph
 *   /session terminals  — Show connected terminals
 *   /session agents     — Show distributed agent registry
 */

import { TaskTreeRenderer } from '../../tasks/task-renderer.js';
export class SessionCommand {
    /**
     * @param {import('../../session/session-manager.js').SessionManager} sessionManager
     * @param {import('../renderer.js').Renderer} renderer
     */
    constructor(sessionManager, renderer) {
        this.sessionManager = sessionManager;
        this.renderer = renderer;
    }

    /**
     * Execute a session subcommand.
     * @param {string[]} parts — subcommand + args
     * @param {object} [rl] — readline interface (for interactive prompts)
     */
    async execute(parts, rl = null) {
        const sub = (parts[0] || 'status').toLowerCase();
        const c = this.renderer.c.bind(this.renderer);

        switch (sub) {
            case 'status':
                return this._showStatus(c);

            case 'list':
            case 'sessions':
                return this._listSessions(c);

            case 'connect':
            case 'join':
                return this._connect(parts[1], parts[2], c);

            case 'disconnect':
            case 'leave':
                return this._disconnect(c);

            case 'close':
            case 'shutdown':
                return this._close(c);

            case 'tasks':
                return this._showTasks(c);

            case 'terminals':
                return this._showTerminals(c);

            case 'agents':
                return this._showAgents(c);

            case 'claim':
                return this._claimTask(c);

            default:
                console.log(`\n${c('yellow', '  Unknown session command:')} ${sub}`);
                this._showSessionHelp(c);
        }
    }

    _showStatus(c) {
        const state = this.sessionManager.getSessionState();
        const box = '─'.repeat(52);

        console.log(`\n${c('cyan', `  ╔${'═'.repeat(52)}╗`)}`);
        console.log(`${c('cyan', '  ║')}  ${c('bold', '🦍 APES v2 | Distributed Session Status')}       ${c('cyan', '║')}`);
        console.log(`${c('cyan', `  ╚${'═'.repeat(52)}╝`)}`);

        if (state.status === 'disconnected') {
            console.log(`  ${c('dim', box)}`);
            console.log(`  ${c('yellow', '⚠')} No active session`);
            console.log(`  ${c('dim', 'Use /session list or startup menu to connect')}`);
            console.log(`  ${c('dim', box)}\n`);
            return;
        }

        console.log(`  ${c('dim', box)}`);
        console.log(`  ${c('bold', 'Session:')}     ${c('cyan', state.sessionId)}`);
        console.log(`  ${c('bold', 'Mode:')}        ${this._modeLabel(state.mode, c)}`);
        console.log(`  ${c('bold', 'Role:')}        ${this._roleLabel(state.role, c)}`);
        console.log(`  ${c('bold', 'Terminal:')}    ${c('dim', state.terminalId)}`);
        console.log(`  ${c('bold', 'Network:')}     ${c('green', state.connectedTerminals + ' Connected')} ${c('dim', '·')} ${c('cyan', state.activeAgents + ' Agents')}`);
        console.log(`  ${c('dim', box)}`);

        // Task graph
        console.log(`  ${c('bold', '[TASK GRAPH]')}`);
        const g = state.tasks;
        if (g.pending + g.claimed + g.completed === 0) {
            console.log(`  ${c('dim', '  No tasks yet')}`);
        } else {
            const graph = g.graph;
            for (const t of graph.completed) {
                console.log(`   ${c('green', '✓')} ${t.id}: ${t.description || 'Task'} ${c('dim', '(Done)')}`);
            }
            for (const t of graph.claimed) {
                console.log(`   ${c('yellow', '→')} ${t.id}: ${t.description || 'Task'} ${c('dim', `(Claimed by ${t.claimedBy || '?'})`)}`);
            }
            for (const t of graph.pending) {
                console.log(`   ${c('dim', '○')} ${t.id}: ${t.description || 'Task'} ${c('dim', '(Pending)')}`);
            }
        }
        console.log(`  ${c('dim', box)}\n`);
    }

    _listSessions(c) {
        const sessions = this.sessionManager.listAllSessions();
        console.log(`\n  ${c('bold', c('cyan', '📋 All Sessions'))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        if (sessions.length === 0) {
            console.log(`  ${c('dim', 'No sessions found. Use /session create to start one.')}`);
        } else {
            for (const s of sessions) {
                const cfg = s.config;
                const statusIcon = cfg.status === 'active' ? c('green', '●') : c('dim', '○');
                const terminals = Object.values(cfg.terminals || {}).filter(t => t.status === 'connected').length;
                console.log(`  ${statusIcon} ${c('cyan', s.sessionId)}`);
                console.log(`    Mode: ${this._modeLabel(cfg.mode, c)} · Terminals: ${c('yellow', terminals)} · Status: ${cfg.status}`);
            }
        }
        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    _connect(sessionId, role, c) {
        if (!sessionId) {
            console.log(`\n  ${c('red', '✗')} Usage: /session connect <session-id> [role]`);
            return;
        }

        const config = this.sessionManager.joinSession(sessionId, { role: role || 'executor' });
        if (!config) {
            console.log(`\n  ${c('red', '✗')} Session "${sessionId}" not found or not active.`);
            return;
        }

        console.log(`\n  ${c('green', '✓')} Connected to session ${c('cyan', sessionId)} as ${c('yellow', role || 'executor')}`);
    }

    _disconnect(c) {
        if (!this.sessionManager.activeSessionId) {
            console.log(`\n  ${c('yellow', '⚠')} Not connected to any session.`);
            return;
        }

        const sid = this.sessionManager.activeSessionId;
        this.sessionManager.disconnect();
        console.log(`\n  ${c('green', '✓')} Disconnected from session ${c('cyan', sid)}`);
    }

    _close(c) {
        if (!this.sessionManager.activeSessionId) {
            console.log(`\n  ${c('yellow', '⚠')} Not connected to any session.`);
            return;
        }

        const result = this.sessionManager.closeSession();
        if (result.success) {
            console.log(`\n  ${c('green', '✓')} Session ${c('cyan', result.sessionId)} closed and archived.`);
        } else {
            console.log(`\n  ${c('red', '✗')} ${result.reason}`);
        }
    }

    _showTasks(c) {
        const state = this.sessionManager.getSessionState();
        if (state.status === 'disconnected') {
            console.log(`\n  ${c('yellow', '⚠')} Not connected to any session.`);
            return;
        }

        console.log(`\n  ${c('bold', c('cyan', '📋 Shared Task Graph'))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        // Try TaskTreeRenderer for rich display
        try {
            const treeRenderer = new TaskTreeRenderer(this.sessionManager.activeSessionId);
            const tree = treeRenderer.engine.getTaskTree();

            if (tree.length > 0) {
                treeRenderer.renderTaskTree(tree);
                treeRenderer.renderStatusBar();
                return;
            }
        } catch { /* fall through to legacy display */ }

        const g = state.tasks.graph;
        const all = [...g.completed, ...g.claimed, ...g.pending];

        if (all.length === 0) {
            console.log(`  ${c('dim', 'No tasks yet. Planner terminal creates tasks.')}`);
        } else {
            for (const t of g.completed) {
                console.log(`  ${c('green', '✓')} ${t.id}: ${t.description} ${c('dim', `· Done by ${t.claimedBy || '?'}`)}`);
            }
            for (const t of g.claimed) {
                console.log(`  ${c('yellow', '→')} ${t.id}: ${t.description} ${c('dim', `· Claimed by ${t.claimedBy || '?'}`)}`);
            }
            for (const t of g.pending) {
                console.log(`  ${c('dim', '○')} ${t.id}: ${t.description} ${c('dim', '· Pending')}`);
            }
        }
        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    _showTerminals(c) {
        const state = this.sessionManager.getSessionState();
        if (state.status === 'disconnected') {
            console.log(`\n  ${c('yellow', '⚠')} Not connected to any session.`);
            return;
        }

        console.log(`\n  ${c('bold', c('cyan', '🖥  Connected Terminals'))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        for (const t of state.terminals) {
            const isMe = t.terminalId === this.sessionManager.terminalId;
            const icon = t.status === 'connected' ? c('green', '●') : c('red', '○');
            const label = isMe ? c('cyan', `${t.terminalId} (you)`) : t.terminalId;
            console.log(`  ${icon} ${label} · Role: ${c('yellow', t.role || '?')} · PID: ${c('dim', t.pid || '?')}`);
        }
        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    _showAgents(c) {
        const state = this.sessionManager.getSessionState();
        if (state.status === 'disconnected') {
            console.log(`\n  ${c('yellow', '⚠')} Not connected to any session.`);
            return;
        }

        console.log(`\n  ${c('bold', c('cyan', '🤖 Distributed Agent Registry'))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        if (state.agents.length === 0) {
            console.log(`  ${c('dim', 'No agents registered yet.')}`);
        } else {
            for (const a of state.agents) {
                console.log(`  ${c('green', '●')} ${c('cyan', a.agentId)} · Host: ${c('dim', a.hostTerminal)} · Role: ${c('yellow', a.role || '?')}`);
            }
        }
        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    _claimTask(c) {
        const result = this.sessionManager.claimNextTask();
        if (result.success) {
            console.log(`\n  ${c('green', '✓')} Claimed task: ${c('cyan', result.task.id)} — ${result.task.description || ''}`);
        } else {
            console.log(`\n  ${c('yellow', '⚠')} ${result.reason}`);
        }
    }

    _showSessionHelp(c) {
        console.log(`\n  ${c('bold', 'Session Commands:')}`);
        console.log(`    ${c('green', '/session status')}       — Show current session state`);
        console.log(`    ${c('green', '/session list')}         — List all sessions`);
        console.log(`    ${c('green', '/session connect')} ${c('dim', 'ID')}  — Join an existing session`);
        console.log(`    ${c('green', '/session disconnect')}   — Leave current session`);
        console.log(`    ${c('green', '/session close')}        — Shutdown & archive session`);
        console.log(`    ${c('green', '/session tasks')}        — Show shared task graph`);
        console.log(`    ${c('green', '/session terminals')}    — Show connected terminals`);
        console.log(`    ${c('green', '/session agents')}       — Show distributed agents`);
        console.log(`    ${c('green', '/session claim')}        — Claim next pending task\n`);
    }

    _modeLabel(mode, c) {
        const labels = {
            shared: c('green', '🔗 Shared'),
            isolated: c('yellow', '🔒 Isolated'),
            planner: c('cyan', '📋 Planner'),
            executor: c('magenta', '⚡ Executor'),
        };
        return labels[mode] || c('dim', mode || 'None');
    }

    _roleLabel(role, c) {
        const labels = {
            planner: c('cyan', '📋 Planner'),
            executor: c('magenta', '⚡ Executor'),
            tester: c('green', '🧪 Tester'),
            observer: c('dim', '👁 Observer'),
            standalone: c('yellow', '🔒 Standalone'),
        };
        return labels[role] || c('dim', role || 'None');
    }
}
