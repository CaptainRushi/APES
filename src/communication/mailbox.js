/**
 * Mailbox
 *
 * Per-agent message queue with inbox/outbox.
 * Integrates with MessageBus for delivery and MailboxStore for persistence.
 */

import { MailboxStore } from './mailbox-store.js';

export class Mailbox {
    /**
     * @param {string} agentId
     * @param {import('./message-bus.js').MessageBus} messageBus
     * @param {string} [teamId='default']
     */
    constructor(agentId, messageBus, teamId = 'default') {
        this.agentId = agentId;
        this.messageBus = messageBus;
        this.store = new MailboxStore(teamId);

        /** @type {object[]} in-memory inbox */
        this.inbox = [];

        /** @type {object[]} in-memory outbox */
        this.outbox = [];

        // Register with message bus for direct delivery
        if (messageBus) {
            messageBus.registerMailbox(agentId, this);
        }

        // Load persisted messages
        this.inbox = this.store.load(agentId);
    }

    /**
     * Deliver a message to this agent's inbox (called by MessageBus).
     * @param {object} message
     */
    deliver(message) {
        message.status = 'delivered';
        this.inbox.push(message);
        this.store.append(this.agentId, message);
    }

    /**
     * Read unread messages (marks them as read).
     * @param {number} [limit=20]
     * @returns {object[]}
     */
    read(limit = 20) {
        const unread = this.inbox.filter(m => m.status === 'delivered' || m.status === 'pending');
        const batch = unread.slice(0, limit);
        for (const msg of batch) {
            msg.status = 'read';
        }
        return batch;
    }

    /**
     * Receive messages matching a filter.
     * @param {{ type?: string, fromAgentId?: string, taskId?: string }} [filter]
     * @returns {object[]}
     */
    receive(filter = {}) {
        return this.inbox.filter(m => {
            if (filter.type && m.type !== filter.type) return false;
            if (filter.fromAgentId && m.fromAgentId !== filter.fromAgentId) return false;
            if (filter.taskId && m.taskId !== filter.taskId) return false;
            return true;
        });
    }

    /**
     * Send a message through the message bus.
     * @param {object} fields - Message fields
     * @returns {object} publish result
     */
    send(fields) {
        const enriched = {
            ...fields,
            fromAgentId: this.agentId,
        };

        // If directed to a specific agent, set channel
        if (fields.toAgentId && !fields.channel) {
            enriched.channel = `agent:${fields.toAgentId}`;
        }

        this.outbox.push(enriched);
        return this.messageBus.publish(enriched);
    }

    /**
     * Get mailbox statistics.
     */
    getStats() {
        const unread = this.inbox.filter(m => m.status === 'delivered' || m.status === 'pending').length;
        return {
            agentId: this.agentId,
            totalInbox: this.inbox.length,
            unread,
            totalOutbox: this.outbox.length,
        };
    }

    /**
     * Clear inbox and persisted store.
     */
    clear() {
        this.inbox = [];
        this.outbox = [];
        this.store.clear(this.agentId);
    }

    /**
     * Cleanup: unregister from message bus.
     */
    destroy() {
        if (this.messageBus) {
            this.messageBus.unregisterMailbox(this.agentId);
        }
    }
}
