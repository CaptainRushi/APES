/**
 * Permission Handler
 * 
 * Production-grade permission system for side-effect control.
 * Before any write/delete/deploy/external-API action, APES must:
 *   1. Detect side effect
 *   2. Request CLI confirmation
 *   3. Log decision
 *   4. Proceed or abort
 */

import * as readline from 'node:readline';

export class PermissionHandler {
    constructor() {
        /** @type {Map<string, 'allow' | 'deny' | 'always'>} */
        this.decisions = new Map();

        /** @type {Array<{action: string, decision: string, timestamp: number}>} */
        this.auditLog = [];

        /** Side-effect action categories */
        this.sideEffects = new Set([
            'file:write',
            'file:delete',
            'file:rename',
            'file:move',
            'process:execute',
            'network:request',
            'deploy:trigger',
            'config:modify',
            'system:install',
        ]);
    }

    /**
     * Check if an action requires permission
     * @param {string} action - Action identifier (e.g. 'file:write')
     * @returns {boolean}
     */
    requiresPermission(action) {
        return this.sideEffects.has(action);
    }

    /**
     * Request permission for a side-effect action
     * @param {string} action - Action type
     * @param {object} details - Action details (path, description, etc.)
     * @returns {Promise<boolean>} - Whether the action is approved
     */
    async requestPermission(action, details = {}) {
        // Check cached decisions
        const cacheKey = `${action}:${details.target ?? ''}`;
        if (this.decisions.has(cacheKey)) {
            const cached = this.decisions.get(cacheKey);
            if (cached === 'always') return true;
            if (cached === 'deny') return false;
        }

        // No side-effect, auto-approve
        if (!this.requiresPermission(action)) {
            return true;
        }

        // Interactive approval
        const approved = await this.promptUser(action, details);

        // Log the decision
        this.auditLog.push({
            action,
            details,
            decision: approved ? 'approved' : 'denied',
            timestamp: Date.now(),
        });

        return approved;
    }

    /**
     * Prompt user for interactive approval
     */
    async promptUser(action, details) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const description = details.description || action;
        const target = details.target ? ` → ${details.target}` : '';

        return new Promise((resolve) => {
            const prompt = `\n\x1b[33m⚠ Permission Required\x1b[0m\n` +
                `  Action: \x1b[1m${description}\x1b[0m${target}\n` +
                `  [Y]es / [N]o / [A]lways : `;

            rl.question(prompt, (answer) => {
                rl.close();
                const choice = answer.trim().toLowerCase();

                if (choice === 'a' || choice === 'always') {
                    this.decisions.set(`${action}:${details.target ?? ''}`, 'always');
                    resolve(true);
                } else if (choice === 'y' || choice === 'yes' || choice === '') {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    }

    /**
     * Get audit log of all permission decisions
     */
    getAuditLog() {
        return [...this.auditLog];
    }
}
