/**
 * Session Manager — Core Distributed Session Controller
 *
 * Orchestrates the multi-terminal parallel execution system.
 *
 * Supports 4 modes:
 *   1. CREATE   — Start a new shared session, become the host
 *   2. JOIN     — Join an existing session by ID
 *   3. PLANNER  — Join a session as the dedicated planner terminal
 *   4. ISOLATED — Run a completely fresh, isolated APES instance
 *
 * Architecture:
 *   SessionManager
 *     ├── SessionStore       (file-system persistence)
 *     ├── TaskLock           (atomic task claiming)
 *     ├── InterTerminalBus   (file-based IPC)
 *     └── TerminalId         (unique identity for this terminal)
 */

import { randomUUID } from 'node:crypto';
import { SessionStore } from './session-store.js';
import { TaskLock } from './task-lock.js';
import { InterTerminalBus } from './inter-terminal-bus.js';

export class SessionManager {
    constructor() {
        this.store = new SessionStore();

        /** This terminal's unique ID */
        this.terminalId = `terminal-${randomUUID().slice(0, 8)}`;

        /** Currently attached session ID (null if isolated/not attached) */
        this.activeSessionId = null;

        /** Session mode: 'shared' | 'planner' | 'executor' | 'isolated' | null */
        this.mode = null;

        /** Role within a shared session: 'planner' | 'executor' | 'tester' | 'observer' */
        this.role = null;

        /** @type {TaskLock|null} */
        this.taskLock = null;

        /** @type {InterTerminalBus|null} */
        this.bus = null;

        /** Max parallel agents this terminal can run */
        this.maxAgentsPerTerminal = 2;

        /** Whether this manager has been initialized */
        this._initialized = false;
    }

    // ─── Session lifecycle ────────────────────────────────────────────

    /**
     * Create a new shared session and register this terminal as host.
     * @param {object} [opts] — { role: 'planner'|'executor' }
     * @returns {object} Session config
     */
    createSession(opts = {}) {
        const sessionId = `ses-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
        const role = opts.role || 'planner';

        const config = this.store.createSession(sessionId, {
            mode: 'shared',
            createdBy: this.terminalId,
            hostTerminal: this.terminalId,
        });

        this.store.registerTerminal(sessionId, this.terminalId, { role, isHost: true });

        this._attachToSession(sessionId, 'shared', role);

        // Announce ourselves
        this.bus.broadcast('TERMINAL_JOINED', {
            terminalId: this.terminalId,
            role,
            isHost: true,
        });

        return config;
    }

    /**
     * Join an existing session.
     * @param {string} sessionId
     * @param {object} [opts] — { role: 'executor'|'planner'|'tester' }
     * @returns {object|null} Session config or null if not found
     */
    joinSession(sessionId, opts = {}) {
        const config = this.store.getConfig(sessionId);
        if (!config) return null;
        if (config.status !== 'active') return null;

        const role = opts.role || 'executor';
        this.store.registerTerminal(sessionId, this.terminalId, { role, isHost: false });

        this._attachToSession(sessionId, 'shared', role);

        this.bus.broadcast('TERMINAL_JOINED', {
            terminalId: this.terminalId,
            role,
            isHost: false,
        });

        return config;
    }

    /**
     * Join a session specifically as the planner.
     * @param {string} sessionId
     */
    joinAsPlanner(sessionId) {
        return this.joinSession(sessionId, { role: 'planner' });
    }

    /**
     * Start an isolated session (no shared state).
     * @returns {object} Isolated config
     */
    isolateSession() {
        const sessionId = `iso-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;

        const config = this.store.createSession(sessionId, {
            mode: 'isolated',
            createdBy: this.terminalId,
            hostTerminal: this.terminalId,
        });

        this.store.registerTerminal(sessionId, this.terminalId, { role: 'standalone', isHost: true });

        this.activeSessionId = sessionId;
        this.mode = 'isolated';
        this.role = 'standalone';
        this.taskLock = new TaskLock(sessionId);
        this.bus = null; // No inter-terminal bus in isolated mode
        this._initialized = true;

        return config;
    }

    /**
     * Internal: attach to a session (shared mode).
     */
    _attachToSession(sessionId, mode, role) {
        this.activeSessionId = sessionId;
        this.mode = mode;
        this.role = role;
        this.taskLock = new TaskLock(sessionId);
        this.bus = new InterTerminalBus(sessionId, this.terminalId);

        // Setup event listeners
        this._setupEventListeners();

        // Start polling for messages
        this.bus.startPolling(2000);

        this._initialized = true;
    }

    /**
     * Disconnect from the current session.
     */
    disconnect() {
        if (!this.activeSessionId) return;

        if (this.bus) {
            this.bus.broadcast('TERMINAL_LEFT', {
                terminalId: this.terminalId,
                role: this.role,
            });
            this.bus.destroy();
        }

        if (this.taskLock) {
            this.taskLock.releaseAllLocks(this.terminalId);
        }

        this.store.unregisterTerminal(this.activeSessionId, this.terminalId);

        this.activeSessionId = null;
        this.mode = null;
        this.role = null;
        this.taskLock = null;
        this.bus = null;
        this._initialized = false;
    }

    /**
     * Graceful shutdown of entire session (host only).
     */
    closeSession(sessionId = null) {
        const sid = sessionId || this.activeSessionId;
        if (!sid) return { success: false, reason: 'No active session' };

        // Broadcast shutdown to all terminals
        if (this.bus) {
            this.bus.broadcast('SHUTDOWN', {
                initiatedBy: this.terminalId,
                reason: 'Session closed by host',
            });
        }

        // Release all locks
        if (this.taskLock) {
            this.taskLock.releaseAllLocks(this.terminalId);
            this.taskLock.cleanStaleLocks(0); // Clean all locks
        }

        // Archive the session
        this.store.archiveSession(sid);

        // Disconnect ourselves
        this.disconnect();

        return { success: true, sessionId: sid };
    }

    // ─── Task operations ──────────────────────────────────────────────

    /**
     * Add a task to the shared graph (typically called by planner terminal).
     */
    addTask(task) {
        if (!this.activeSessionId) return null;
        this.store.addTask(this.activeSessionId, task);

        if (this.bus) {
            this.bus.broadcast('TASK_CREATED', { task });
        }

        return task;
    }

    /**
     * Claim the next available task.
     */
    claimNextTask() {
        if (!this.taskLock) return { success: false, reason: 'No active session' };

        const result = this.taskLock.claimNext(this.terminalId);

        if (result.success && this.bus) {
            this.bus.broadcast('TASK_CLAIMED', {
                taskId: result.task.id,
                claimedBy: this.terminalId,
            });
        }

        return result;
    }

    /**
     * Complete a task.
     */
    completeTask(taskId, result = {}) {
        if (!this.taskLock) return { success: false, reason: 'No active session' };

        const res = this.taskLock.completeTask(taskId, this.terminalId, result);

        if (res.success && this.bus) {
            this.bus.broadcast('TASK_COMPLETED', {
                taskId,
                completedBy: this.terminalId,
                result: result,
            });
        }

        return res;
    }

    // ─── Agent registration ───────────────────────────────────────────

    /**
     * Register a spawned agent in the shared registry.
     */
    registerAgent(agent) {
        if (!this.activeSessionId) return;
        this.store.registerAgent(this.activeSessionId, {
            ...agent,
            hostTerminal: this.terminalId,
            status: 'running',
        });

        if (this.bus) {
            this.bus.broadcast('AGENT_SPAWNED', {
                agentId: agent.agentId || agent.id,
                hostTerminal: this.terminalId,
                role: agent.role,
            });
        }
    }

    // ─── Status & Queries ─────────────────────────────────────────────

    /**
     * Get the full session state (dashboard data).
     */
    getSessionState() {
        if (!this.activeSessionId) {
            return {
                status: 'disconnected',
                terminalId: this.terminalId,
                mode: null,
            };
        }

        const config = this.store.getConfig(this.activeSessionId);
        const terminals = this.store.getConnectedTerminals(this.activeSessionId);
        const agents = this.store.listAgents(this.activeSessionId);
        const taskGraph = this.store.getTaskGraph(this.activeSessionId);
        const lockStatus = this.taskLock?.getStatus() || {};

        return {
            status: 'connected',
            sessionId: this.activeSessionId,
            mode: this.mode,
            role: this.role,
            terminalId: this.terminalId,
            connectedTerminals: terminals.length,
            terminals: terminals,
            activeAgents: agents.length,
            agents: agents,
            tasks: {
                pending: taskGraph.pending.length,
                claimed: taskGraph.claimed.length,
                completed: taskGraph.completed.length,
                graph: taskGraph,
            },
            locks: lockStatus,
            createdAt: config?.createdAt,
            hostTerminal: config?.hostTerminal,
        };
    }

    /**
     * Get list of all sessions (for /apes sessions command).
     */
    listAllSessions() {
        return this.store.listSessions();
    }

    /**
     * Get list of active sessions only.
     */
    listActiveSessions() {
        return this.store.listActiveSessions();
    }

    // ─── Event listeners ──────────────────────────────────────────────

    _setupEventListeners() {
        if (!this.bus) return;

        // Log terminal joins/leaves
        this.bus.on('TERMINAL_JOINED', (msg) => {
            // Could trigger UI refresh
        });

        this.bus.on('TERMINAL_LEFT', (msg) => {
            // Could trigger UI refresh
        });

        // Handle shutdown signal
        this.bus.on('SHUTDOWN', (msg) => {
            if (msg.fromTerminal !== this.terminalId) {
                console.log(`\n\x1b[33m⚠ Session shutting down (initiated by ${msg.fromTerminal})\x1b[0m`);
                this.disconnect();
            }
        });

        // Task events for live UI updates
        this.bus.on('TASK_CREATED', (msg) => {
            // Could trigger executor terminals to auto-claim
        });

        this.bus.on('TASK_CLAIMED', (msg) => {
            // UI update: show which terminal claimed which task
        });

        this.bus.on('TASK_COMPLETED', (msg) => {
            // UI update: mark task as done
        });
    }

    // ─── Cleanup ──────────────────────────────────────────────────────

    /**
     * Full cleanup on process exit.
     */
    cleanup() {
        if (this.bus) {
            this.bus.destroy();
            this.bus.cleanup(0); // Clean all messages
        }
        if (this.taskLock) {
            this.taskLock.releaseAllLocks(this.terminalId);
        }
        if (this.activeSessionId) {
            this.store.unregisterTerminal(this.activeSessionId, this.terminalId);
        }
    }
}
