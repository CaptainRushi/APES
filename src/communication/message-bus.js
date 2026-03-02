/**
 * Message Bus
 *
 * Central pub/sub message bus for inter-agent communication.
 *
 * Channel types:
 *   global      — all agents receive
 *   cluster:X   — agents in cluster X
 *   task:X      — agents working on task X
 *   agent:X     — direct message to agent X
 */

import { MessageValidator } from './message-validator.js';

export class MessageBus {
    constructor() {
        this.validator = new MessageValidator();

        /** @type {Map<string, Set<function>>} channel → listeners */
        this._subscriptions = new Map();

        /**
         * Circular buffer for message history.
         * _historyBuf is a fixed-length array; _historyHead points to the
         * slot that will be overwritten next.  Reading is O(1) slice,
         * writing is O(1) — no array recreation on overflow.
         */
        this._maxHistory = 1000;
        this._historyBuf = new Array(this._maxHistory);
        this._historyHead = 0;   // next write position
        this._historySize = 0;   // number of valid entries (≤ maxHistory)

        /** @type {Map<string, object>} mailbox ref (agentId → mailbox) */
        this._mailboxes = new Map();
    }

    /**
     * Subscribe to a channel.
     * @param {string} channel
     * @param {function} listener - fn(message)
     * @returns {function} unsubscribe function
     */
    subscribe(channel, listener) {
        if (!this._subscriptions.has(channel)) {
            this._subscriptions.set(channel, new Set());
        }
        this._subscriptions.get(channel).add(listener);

        return () => {
            const subs = this._subscriptions.get(channel);
            if (subs) {
                subs.delete(listener);
                if (subs.size === 0) this._subscriptions.delete(channel);
            }
        };
    }

    /**
     * Publish a message to a channel.
     * @param {object} fields - Message fields (see MessageValidator.create)
     * @returns {{ delivered: number, message: object }|{ error: string }}
     */
    publish(fields) {
        const message = this.validator.create(fields);
        const validation = this.validator.validate(message);

        if (!validation.valid) {
            return { error: `Invalid message: ${validation.errors.join('; ')}` };
        }

        // Store in circular history buffer — O(1), no array reallocation
        this._historyBuf[this._historyHead] = message;
        this._historyHead = (this._historyHead + 1) % this._maxHistory;
        if (this._historySize < this._maxHistory) this._historySize++;

        let delivered = 0;

        // Deliver to channel subscribers
        const subs = this._subscriptions.get(message.channel);
        if (subs) {
            for (const listener of subs) {
                try {
                    listener(message);
                    delivered++;
                } catch {
                    // listener error — don't crash the bus
                }
            }
        }

        // Also deliver to 'global' subscribers if channel isn't global
        if (message.channel !== 'global') {
            const globalSubs = this._subscriptions.get('global');
            if (globalSubs) {
                for (const listener of globalSubs) {
                    try {
                        listener(message);
                        delivered++;
                    } catch {
                        // listener error
                    }
                }
            }
        }

        // Deliver to directed agent mailbox
        if (message.toAgentId) {
            const mailbox = this._mailboxes.get(message.toAgentId);
            if (mailbox && typeof mailbox.deliver === 'function') {
                try {
                    mailbox.deliver(message);
                    delivered++;
                } catch {
                    // mailbox error
                }
            }
        }

        message.status = 'delivered';
        return { delivered, message };
    }

    /**
     * Register a mailbox for direct agent messaging.
     * @param {string} agentId
     * @param {{ deliver: function }} mailbox
     */
    registerMailbox(agentId, mailbox) {
        this._mailboxes.set(agentId, mailbox);
    }

    /**
     * Unregister a mailbox.
     * @param {string} agentId
     */
    unregisterMailbox(agentId) {
        this._mailboxes.delete(agentId);
    }

    /**
     * Get message history for a channel.
     * Reconstructs chronological order from the circular buffer in O(n).
     * @param {string} [channel] - Filter by channel. If omitted, returns all.
     * @param {number} [limit=50]
     * @returns {object[]}
     */
    getHistory(channel, limit = 50) {
        // Reconstruct in insertion order from the circular buffer
        const size = this._historySize;
        const buf  = this._historyBuf;
        const head = this._historyHead;
        // Oldest entry is at (head - size + maxHistory) % maxHistory when full
        const startIdx = size < this._maxHistory
            ? 0
            : head;

        const msgs = [];
        for (let i = 0; i < size; i++) {
            const entry = buf[(startIdx + i) % this._maxHistory];
            if (entry && (!channel || entry.channel === channel)) {
                msgs.push(entry);
            }
        }

        return msgs.slice(-limit);
    }

    /**
     * Get bus statistics.
     */
    getStats() {
        return {
            totalMessages: this._historySize,
            activeChannels: this._subscriptions.size,
            registeredMailboxes: this._mailboxes.size,
            channels: [...this._subscriptions.keys()],
        };
    }

    /**
     * Clear all subscriptions and history.
     */
    reset() {
        this._subscriptions.clear();
        this._historyBuf  = new Array(this._maxHistory);
        this._historyHead = 0;
        this._historySize = 0;
        this._mailboxes.clear();
    }
}
