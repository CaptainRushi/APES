/**
 * Inter-Terminal Message Bus
 *
 * File-based message passing between terminals in a shared session.
 * Terminals poll the mailbox directory for new messages.
 *
 * Supports:
 *   - Broadcast (to: 'all')
 *   - Direct (to: 'terminal-2')
 *   - Event types: TASK_CREATED, TASK_CLAIMED, TASK_COMPLETED, TASK_FAILED,
 *                  TERMINAL_JOINED, TERMINAL_LEFT, PLAN_READY, AGENT_SPAWNED,
 *                  SHUTDOWN, PING, PONG
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export class InterTerminalBus {
    /**
     * @param {string} sessionId
     * @param {string} terminalId — This terminal's identity
     */
    constructor(sessionId, terminalId) {
        this.sessionId = sessionId;
        this.terminalId = terminalId;
        this.mailboxDir = join(homedir(), '.apes', 'sessions', sessionId, 'mailbox');
        this._ensureDir(this.mailboxDir);

        /** @type {Map<string, function[]>} event type → handlers */
        this._handlers = new Map();

        /** Timestamp of last poll */
        this._lastPoll = Date.now();

        /** Polling interval reference */
        this._pollInterval = null;

        /** Whether polling is active */
        this._polling = false;
    }

    _ensureDir(dir) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // ─── Sending ──────────────────────────────────────────────────────

    /**
     * Send a message to the inter-terminal bus.
     * @param {object} opts
     * @param {string} opts.type — Event type (TASK_CREATED, SHUTDOWN, etc.)
     * @param {string} [opts.to='all'] — Target terminal or 'all' for broadcast
     * @param {object} [opts.payload={}] — Event data
     */
    send(opts) {
        const message = {
            id: randomUUID(),
            fromTerminal: this.terminalId,
            toTerminal: opts.to || 'all',
            type: opts.type,
            payload: opts.payload || {},
            timestamp: Date.now(),
        };

        const filename = `${message.timestamp}_${this.terminalId}_${message.id.slice(0, 8)}.json`;
        writeFileSync(join(this.mailboxDir, filename), JSON.stringify(message, null, 2), 'utf-8');
        return message;
    }

    /**
     * Broadcast a message to all terminals.
     */
    broadcast(type, payload = {}) {
        return this.send({ type, to: 'all', payload });
    }

    /**
     * Send a direct message to a specific terminal.
     */
    sendTo(terminalId, type, payload = {}) {
        return this.send({ type, to: terminalId, payload });
    }

    // ─── Receiving / Polling ──────────────────────────────────────────

    /**
     * Poll for new messages since last check.
     * @returns {object[]} New messages for this terminal
     */
    poll() {
        const since = this._lastPoll;
        this._lastPoll = Date.now();

        try {
            const files = readdirSync(this.mailboxDir)
                .filter(f => f.endsWith('.json'))
                .sort();

            const messages = [];
            for (const f of files) {
                try {
                    const msg = JSON.parse(readFileSync(join(this.mailboxDir, f), 'utf-8'));

                    // Skip old messages
                    if (msg.timestamp <= since) continue;

                    // Skip messages from ourselves
                    if (msg.fromTerminal === this.terminalId) continue;

                    // Check if addressed to us or broadcast
                    if (msg.toTerminal !== 'all' && msg.toTerminal !== this.terminalId) continue;

                    messages.push(msg);
                } catch { /* skip corrupt files */ }
            }

            // Dispatch to handlers
            for (const msg of messages) {
                this._dispatch(msg);
            }

            return messages;
        } catch {
            return [];
        }
    }

    /**
     * Start auto-polling at the specified interval.
     * @param {number} intervalMs — Polling interval (default 2000ms)
     */
    startPolling(intervalMs = 2000) {
        if (this._polling) return;
        this._polling = true;
        this._pollInterval = setInterval(() => this.poll(), intervalMs);

        // Don't let polling keep the process alive
        if (this._pollInterval.unref) {
            this._pollInterval.unref();
        }
    }

    /**
     * Stop auto-polling.
     */
    stopPolling() {
        this._polling = false;
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    }

    // ─── Event handling ───────────────────────────────────────────────

    /**
     * Register a handler for a specific message type.
     * @param {string} type
     * @param {function} handler — fn(message)
     */
    on(type, handler) {
        if (!this._handlers.has(type)) {
            this._handlers.set(type, []);
        }
        this._handlers.get(type).push(handler);
    }

    /**
     * Remove a handler.
     */
    off(type, handler) {
        const handlers = this._handlers.get(type);
        if (handlers) {
            const idx = handlers.indexOf(handler);
            if (idx !== -1) handlers.splice(idx, 1);
        }
    }

    /**
     * Dispatch a message to registered handlers.
     */
    _dispatch(message) {
        const handlers = this._handlers.get(message.type) || [];
        for (const h of handlers) {
            try { h(message); } catch { /* handler error */ }
        }

        // Also dispatch to wildcard handlers
        const wildcardHandlers = this._handlers.get('*') || [];
        for (const h of wildcardHandlers) {
            try { h(message); } catch { /* handler error */ }
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────────

    /**
     * Remove messages older than maxAge.
     * @param {number} maxAge — Max message age in ms (default 2 min)
     */
    cleanup(maxAge = 120000) {
        const cutoff = Date.now() - maxAge;
        try {
            for (const f of readdirSync(this.mailboxDir).filter(f => f.endsWith('.json'))) {
                try {
                    const msg = JSON.parse(readFileSync(join(this.mailboxDir, f), 'utf-8'));
                    if (msg.timestamp < cutoff) unlinkSync(join(this.mailboxDir, f));
                } catch { /* ignore */ }
            }
        } catch { /* ignore */ }
    }

    /**
     * Destroy the bus (stop polling, cleanup).
     */
    destroy() {
        this.stopPolling();
        this.broadcast('TERMINAL_LEFT', { terminalId: this.terminalId });
    }
}
