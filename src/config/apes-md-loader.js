/**
 * APES.md Loader — Project-level instruction system
 *
 * Works like Claude Code's CLAUDE.md:
 *   - Discovers `apes.md` (or `APES.md`) files by walking up from CWD
 *   - Merges multiple apes.md files with nearest-wins precedence
 *   - Provides project instructions to the orchestrator and agents
 *
 * Discovery order (highest precedence first):
 *   1. CWD/apes.md
 *   2. CWD/.apes/apes.md
 *   3. Parent directories (walking up to root)
 *   4. ~/.apes/apes.md (global user config)
 *
 * Sections parsed:
 *   - # Project Overview
 *   - # Rules / # Instructions
 *   - # Agent Instructions
 *   - # Skills
 *   - # Conventions
 *   - Free-form markdown (passed as context)
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export class ApesMdLoader {
    constructor() {
        /** @type {ApesMdConfig[]} */
        this.configs = [];

        /** @type {ApesMdConfig|null} merged result */
        this.merged = null;
    }

    /**
     * Discover and load all apes.md files from startDir up to root + home.
     * @param {string} [startDir=process.cwd()]
     * @returns {ApesMdConfig} merged config
     */
    load(startDir = process.cwd()) {
        this.configs = [];
        const found = this._discover(startDir);

        for (const filePath of found) {
            try {
                const raw = readFileSync(filePath, 'utf-8');
                const config = this._parse(raw, filePath);
                this.configs.push(config);
            } catch {
                // Skip unreadable files
            }
        }

        this.merged = this._merge(this.configs);
        return this.merged;
    }

    /**
     * Walk up directories looking for apes.md files.
     * Returns paths in precedence order (nearest first).
     * @param {string} startDir
     * @returns {string[]}
     */
    _discover(startDir) {
        const candidates = [];
        const names = ['apes.md', 'APES.md'];
        let dir = resolve(startDir);
        const root = dirname(dir) === dir ? dir : undefined;
        const visited = new Set();

        while (dir && !visited.has(dir)) {
            visited.add(dir);

            // Direct in directory
            for (const name of names) {
                const p = join(dir, name);
                if (this._isFile(p)) {
                    candidates.push(p);
                    break; // Only pick one per directory
                }
            }

            // Inside .apes/ subdirectory
            for (const name of names) {
                const p = join(dir, '.apes', name);
                if (this._isFile(p)) {
                    candidates.push(p);
                    break;
                }
            }

            const parent = dirname(dir);
            if (parent === dir) break; // reached root
            dir = parent;
        }

        // Global user config
        const homeDir = homedir();
        for (const name of names) {
            const p = join(homeDir, '.apes', name);
            if (this._isFile(p) && !candidates.includes(p)) {
                candidates.push(p);
            }
        }

        return candidates;
    }

    /**
     * Parse a single apes.md file into structured config.
     * @param {string} raw
     * @param {string} filePath
     * @returns {ApesMdConfig}
     */
    _parse(raw, filePath) {
        const config = {
            filePath,
            raw,
            projectName: '',
            rules: [],
            agentInstructions: {},
            conventions: [],
            skills: [],
            sections: {},
            freeText: '',
        };

        const lines = raw.split('\n');
        let currentSection = null;
        let currentSectionLines = [];
        let freeLines = [];

        for (const line of lines) {
            const heading = line.match(/^#{1,3}\s+(.+)/);

            if (heading) {
                // Flush previous section
                if (currentSection) {
                    this._flushSection(config, currentSection, currentSectionLines);
                }

                currentSection = heading[1].trim().toLowerCase();
                currentSectionLines = [];
                continue;
            }

            if (currentSection) {
                currentSectionLines.push(line);
            } else {
                freeLines.push(line);
            }
        }

        // Flush last section
        if (currentSection) {
            this._flushSection(config, currentSection, currentSectionLines);
        }

        config.freeText = freeLines.join('\n').trim();

        return config;
    }

    /**
     * Flush accumulated section lines into the config.
     */
    _flushSection(config, sectionName, lines) {
        const content = lines.join('\n').trim();
        config.sections[sectionName] = content;

        // Normalize section name for matching
        const normalized = sectionName.replace(/[^a-z0-9]/g, '_');

        if (normalized.includes('project') && (normalized.includes('overview') || normalized.includes('name'))) {
            config.projectName = this._extractFirstLine(content);
        }

        // Check agent instructions FIRST (more specific match)
        if (normalized.includes('agent') && normalized.includes('instruction')) {
            config.agentInstructions = this._extractKeyValueBlocks(content);
        } else if (normalized.includes('rule') || normalized.includes('instruction')) {
            // Only match rules/instructions if NOT "agent instructions"
            config.rules = this._extractBulletList(content);
        }

        if (normalized.includes('convention')) {
            config.conventions = this._extractBulletList(content);
        }

        if (normalized.includes('skill')) {
            config.skills = this._extractBulletList(content);
        }
    }

    /**
     * Merge multiple configs with nearest-wins precedence.
     * configs[0] has highest precedence (nearest to CWD).
     * @param {ApesMdConfig[]} configs
     * @returns {ApesMdConfig}
     */
    _merge(configs) {
        if (configs.length === 0) {
            return {
                filePath: null,
                raw: '',
                projectName: '',
                rules: [],
                agentInstructions: {},
                conventions: [],
                skills: [],
                sections: {},
                freeText: '',
            };
        }

        if (configs.length === 1) return configs[0];

        // Start from lowest precedence and overlay
        const merged = {
            filePath: configs[0].filePath,
            raw: configs.map(c => c.raw).join('\n---\n'),
            projectName: '',
            rules: [],
            agentInstructions: {},
            conventions: [],
            skills: [],
            sections: {},
            freeText: '',
        };

        // Reverse so we apply lowest-precedence first
        const reversed = [...configs].reverse();

        for (const c of reversed) {
            if (c.projectName) merged.projectName = c.projectName;
            if (c.rules.length) merged.rules = [...c.rules, ...merged.rules.filter(r => !c.rules.includes(r))];
            if (c.conventions.length) merged.conventions = [...c.conventions, ...merged.conventions.filter(cv => !c.conventions.includes(cv))];
            if (c.skills.length) merged.skills = [...c.skills, ...merged.skills.filter(s => !c.skills.includes(s))];
            if (c.freeText) merged.freeText = c.freeText + (merged.freeText ? '\n' + merged.freeText : '');

            // Merge agent instructions (nearest wins per agent)
            for (const [agent, instructions] of Object.entries(c.agentInstructions)) {
                merged.agentInstructions[agent] = instructions;
            }

            // Merge sections (nearest wins per section name)
            for (const [name, content] of Object.entries(c.sections)) {
                merged.sections[name] = content;
            }
        }

        // Deduplicate rules/conventions while preserving order
        merged.rules = [...new Set(merged.rules)];
        merged.conventions = [...new Set(merged.conventions)];
        merged.skills = [...new Set(merged.skills)];

        return merged;
    }

    /**
     * Get the full context string to inject into agent prompts.
     * @returns {string}
     */
    getContextString() {
        if (!this.merged) return '';

        const parts = [];

        if (this.merged.projectName) {
            parts.push(`# Project: ${this.merged.projectName}`);
        }

        if (this.merged.rules.length > 0) {
            parts.push(`## Rules\n${this.merged.rules.map(r => `- ${r}`).join('\n')}`);
        }

        if (this.merged.conventions.length > 0) {
            parts.push(`## Conventions\n${this.merged.conventions.map(c => `- ${c}`).join('\n')}`);
        }

        if (this.merged.freeText) {
            parts.push(this.merged.freeText);
        }

        return parts.join('\n\n');
    }

    /**
     * Get instructions for a specific agent role.
     * @param {string} agentRole
     * @returns {string}
     */
    getAgentInstructions(agentRole) {
        if (!this.merged) return '';
        return this.merged.agentInstructions[agentRole] || '';
    }

    // ─── Helpers ─────────────────────────────────────────────────

    _isFile(p) {
        try {
            return existsSync(p) && statSync(p).isFile();
        } catch {
            return false;
        }
    }

    _extractFirstLine(content) {
        const first = content.split('\n').find(l => l.trim().length > 0);
        return first ? first.trim() : '';
    }

    _extractBulletList(content) {
        return content
            .split('\n')
            .filter(l => /^\s*[-*]\s+/.test(l))
            .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
            .filter(Boolean);
    }

    _extractKeyValueBlocks(content) {
        const result = {};
        const blocks = content.split(/\n(?=\*\*|###\s)/);

        for (const block of blocks) {
            const match = block.match(/(?:\*\*|###\s*)([^*\n]+?)(?:\*\*|$)/);
            if (match) {
                const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
                const value = block.replace(/(?:\*\*|###\s*)[^*\n]+?\*\*/, '').trim();
                result[key] = value;
            }
        }

        return result;
    }
}
