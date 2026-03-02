/**
 * Mailbox Store
 *
 * File-backed persistence for agent mailboxes.
 * Stores messages at ~/.apes/teams/{teamId}/mailbox/{agentId}.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class MailboxStore {
    /**
     * @param {string} [teamId='default']
     */
    constructor(teamId = 'default') {
        this.teamId = teamId;
        this.baseDir = join(homedir(), '.apes', 'teams', teamId, 'mailbox');
    }

    /**
     * Ensure the mailbox directory exists.
     */
    _ensureDir() {
        if (!existsSync(this.baseDir)) {
            mkdirSync(this.baseDir, { recursive: true });
        }
    }

    /**
     * Get the file path for an agent's mailbox.
     * @param {string} agentId
     * @returns {string}
     */
    _filePath(agentId) {
        return join(this.baseDir, `${agentId}.json`);
    }

    /**
     * Load messages for an agent.
     * @param {string} agentId
     * @returns {object[]}
     */
    load(agentId) {
        const fp = this._filePath(agentId);
        if (!existsSync(fp)) return [];
        try {
            return JSON.parse(readFileSync(fp, 'utf-8'));
        } catch {
            return [];
        }
    }

    /**
     * Save messages for an agent.
     * @param {string} agentId
     * @param {object[]} messages
     */
    save(agentId, messages) {
        this._ensureDir();
        writeFileSync(this._filePath(agentId), JSON.stringify(messages, null, 2), 'utf-8');
    }

    /**
     * Append a message to an agent's mailbox file.
     * @param {string} agentId
     * @param {object} message
     */
    append(agentId, message) {
        const messages = this.load(agentId);
        messages.push(message);
        // Keep last 200 messages per agent
        const trimmed = messages.length > 200 ? messages.slice(-200) : messages;
        this.save(agentId, trimmed);
    }

    /**
     * Clear an agent's mailbox.
     * @param {string} agentId
     */
    clear(agentId) {
        this.save(agentId, []);
    }
}
