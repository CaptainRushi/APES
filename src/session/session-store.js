/**
 * Session Store — File-System Persistence Layer
 *
 * Manages session data on disk at ~/.apes/sessions/{session-id}/
 *
 * Directory structure per session:
 *   config.json     — Session metadata, mode, terminal list
 *   tasks/          — Shared task graph (pending, claimed, completed)
 *   agents/         — Distributed agent registry snapshots
 *   memory/         — Shared memory embeddings (lazy-loaded)
 *   mailbox/        — Inter-terminal message queue
 *   locks/          — Mutex lock files for atomic task claiming
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class SessionStore {
    constructor() {
        this.rootDir = join(homedir(), '.apes', 'sessions');
        this._ensureDir(this.rootDir);
    }

    // ─── Directory helpers ────────────────────────────────────────────

    _ensureDir(dir) {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }

    _sessionDir(sessionId) {
        return join(this.rootDir, sessionId);
    }

    // ─── Session lifecycle ────────────────────────────────────────────

    /**
     * Create a new session directory and config.
     * @param {string} sessionId
     * @param {object} config — { mode, createdBy, role, ... }
     * @returns {object} The saved config
     */
    createSession(sessionId, config) {
        const dir = this._sessionDir(sessionId);
        this._ensureDir(dir);

        const subdirs = ['tasks/pending', 'tasks/claimed', 'tasks/completed', 'tasks/failed', 'agents', 'memory', 'mailbox', 'locks'];
        for (const sub of subdirs) {
            this._ensureDir(join(dir, sub));
        }

        const fullConfig = {
            sessionId,
            mode: config.mode || 'shared',
            createdAt: Date.now(),
            createdBy: config.createdBy || 'unknown',
            status: 'active',
            terminals: {},
            ...config,
        };

        writeFileSync(join(dir, 'config.json'), JSON.stringify(fullConfig, null, 2), 'utf-8');
        return fullConfig;
    }

    /**
     * Read session config.
     * @param {string} sessionId
     * @returns {object|null}
     */
    getConfig(sessionId) {
        const fp = join(this._sessionDir(sessionId), 'config.json');
        if (!existsSync(fp)) return null;
        try {
            return JSON.parse(readFileSync(fp, 'utf-8'));
        } catch {
            return null;
        }
    }

    /**
     * Update session config.
     */
    updateConfig(sessionId, patch) {
        const cfg = this.getConfig(sessionId);
        if (!cfg) return null;
        const updated = { ...cfg, ...patch, updatedAt: Date.now() };
        writeFileSync(
            join(this._sessionDir(sessionId), 'config.json'),
            JSON.stringify(updated, null, 2),
            'utf-8',
        );
        return updated;
    }

    /**
     * List all active sessions.
     * @returns {{ sessionId: string, config: object }[]}
     */
    listSessions() {
        try {
            const dirs = readdirSync(this.rootDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            return dirs.map(sessionId => {
                const config = this.getConfig(sessionId);
                return { sessionId, config };
            }).filter(s => s.config !== null);
        } catch {
            return [];
        }
    }

    /**
     * List only active sessions.
     */
    listActiveSessions() {
        return this.listSessions().filter(s => s.config.status === 'active');
    }

    /**
     * Archive a session (mark as archived but keep files).
     */
    archiveSession(sessionId) {
        return this.updateConfig(sessionId, { status: 'archived', archivedAt: Date.now() });
    }

    /**
     * Delete a session entirely.
     */
    deleteSession(sessionId) {
        const dir = this._sessionDir(sessionId);
        if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    // ─── Terminal registration ────────────────────────────────────────

    /**
     * Register a terminal in the session.
     */
    registerTerminal(sessionId, terminalId, info = {}) {
        const cfg = this.getConfig(sessionId);
        if (!cfg) return null;

        cfg.terminals[terminalId] = {
            terminalId,
            role: info.role || 'executor',
            status: 'connected',
            connectedAt: Date.now(),
            pid: process.pid,
            ...info,
        };

        return this.updateConfig(sessionId, { terminals: cfg.terminals });
    }

    /**
     * Unregister a terminal from the session.
     */
    unregisterTerminal(sessionId, terminalId) {
        const cfg = this.getConfig(sessionId);
        if (!cfg) return null;

        if (cfg.terminals[terminalId]) {
            cfg.terminals[terminalId].status = 'disconnected';
            cfg.terminals[terminalId].disconnectedAt = Date.now();
        }

        return this.updateConfig(sessionId, { terminals: cfg.terminals });
    }

    /**
     * Get connected terminals for a session.
     */
    getConnectedTerminals(sessionId) {
        const cfg = this.getConfig(sessionId);
        if (!cfg) return [];

        return Object.values(cfg.terminals).filter(t => t.status === 'connected');
    }

    // ─── Shared Task Graph ────────────────────────────────────────────

    /**
     * Add a task to the shared pending queue.
     */
    addTask(sessionId, task) {
        const dir = join(this._sessionDir(sessionId), 'tasks', 'pending');
        this._ensureDir(dir);
        const filename = `${task.priority ?? 5}_${task.id}.json`;
        writeFileSync(join(dir, filename), JSON.stringify({ ...task, addedAt: Date.now() }, null, 2), 'utf-8');
    }

    /**
     * List tasks in a specific state (pending, claimed, completed).
     */
    listTasks(sessionId, state = 'pending') {
        const dir = join(this._sessionDir(sessionId), 'tasks', state);
        try {
            return readdirSync(dir)
                .filter(f => f.endsWith('.json'))
                .map(f => {
                    try {
                        return JSON.parse(readFileSync(join(dir, f), 'utf-8'));
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Get full task graph status for a session.
     */
    getTaskGraph(sessionId) {
        return {
            pending: this.listTasks(sessionId, 'pending'),
            claimed: this.listTasks(sessionId, 'claimed'),
            completed: this.listTasks(sessionId, 'completed'),
            failed: this.listTasks(sessionId, 'failed'),
        };
    }

    // ─── Agent Registry ───────────────────────────────────────────────

    /**
     * Register an agent in the shared session registry.
     */
    registerAgent(sessionId, agent) {
        const dir = join(this._sessionDir(sessionId), 'agents');
        this._ensureDir(dir);
        writeFileSync(
            join(dir, `${agent.agentId}.json`),
            JSON.stringify({ ...agent, registeredAt: Date.now() }, null, 2),
            'utf-8',
        );
    }

    /**
     * List all registered agents in a session.
     */
    listAgents(sessionId) {
        const dir = join(this._sessionDir(sessionId), 'agents');
        try {
            return readdirSync(dir)
                .filter(f => f.endsWith('.json'))
                .map(f => {
                    try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')); } catch { return null; }
                })
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * Remove an agent from the registry.
     */
    removeAgent(sessionId, agentId) {
        const fp = join(this._sessionDir(sessionId), 'agents', `${agentId}.json`);
        try { unlinkSync(fp); } catch { /* ignore */ }
    }

    // ─── Mailbox (Inter-Terminal Messages) ────────────────────────────

    /**
     * Post a message to the session mailbox.
     */
    postMessage(sessionId, message) {
        const dir = join(this._sessionDir(sessionId), 'mailbox');
        this._ensureDir(dir);
        const filename = `${Date.now()}_${message.fromTerminal}_${Math.random().toString(36).slice(2, 8)}.json`;
        writeFileSync(join(dir, filename), JSON.stringify({ ...message, timestamp: Date.now() }, null, 2), 'utf-8');
    }

    /**
     * Read messages from the mailbox (optionally filter by recipient).
     */
    readMessages(sessionId, forTerminal = null, sinceTimestamp = 0) {
        const dir = join(this._sessionDir(sessionId), 'mailbox');
        try {
            const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
            return files.map(f => {
                try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')); } catch { return null; }
            })
                .filter(Boolean)
                .filter(m => m.timestamp > sinceTimestamp)
                .filter(m => !forTerminal || !m.toTerminal || m.toTerminal === forTerminal || m.toTerminal === 'all');
        } catch {
            return [];
        }
    }

    /**
     * Clean up old mailbox messages (older than maxAge ms).
     */
    cleanMailbox(sessionId, maxAge = 60000) {
        const dir = join(this._sessionDir(sessionId), 'mailbox');
        const cutoff = Date.now() - maxAge;
        try {
            for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
                try {
                    const msg = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
                    if (msg.timestamp < cutoff) unlinkSync(join(dir, f));
                } catch { /* ignore */ }
            }
        } catch { /* ignore */ }
    }
}
