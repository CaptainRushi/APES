/**
 * Team Store
 *
 * Persists team configurations to ~/.apes/teams/{id}/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class TeamStore {
    constructor() {
        this.baseDir = join(homedir(), '.apes', 'teams');
    }

    _ensureDir(teamId) {
        const dir = join(this.baseDir, teamId);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    _configPath(teamId) {
        return join(this.baseDir, teamId, 'config.json');
    }

    /**
     * Save team config.
     * @param {string} teamId
     * @param {object} config
     */
    save(teamId, config) {
        this._ensureDir(teamId);
        writeFileSync(this._configPath(teamId), JSON.stringify(config, null, 2), 'utf-8');
    }

    /**
     * Load team config.
     * @param {string} teamId
     * @returns {object|null}
     */
    load(teamId) {
        const fp = this._configPath(teamId);
        if (!existsSync(fp)) return null;
        try {
            return JSON.parse(readFileSync(fp, 'utf-8'));
        } catch {
            return null;
        }
    }

    /**
     * List all stored team IDs.
     * @returns {string[]}
     */
    list() {
        if (!existsSync(this.baseDir)) return [];
        try {
            return readdirSync(this.baseDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);
        } catch {
            return [];
        }
    }

    /**
     * Delete a team's stored data.
     * @param {string} teamId
     */
    delete(teamId) {
        const dir = join(this.baseDir, teamId);
        if (!existsSync(dir)) return;
        // Remove config file (keep directory for mailbox cleanup)
        const fp = this._configPath(teamId);
        if (existsSync(fp)) {
            writeFileSync(fp, '', 'utf-8'); // Clear contents
        }
    }
}
