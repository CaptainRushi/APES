/**
 * Skill Loader — Project-level skill/plugin system for APES
 *
 * Works like Claude Code's skill system:
 *   - Discovers skill.md files in .apes/skills/<name>/skill.md
 *   - Each skill has a name, trigger patterns, and instructions
 *   - Skills are matched against user input and injected into agent context
 *   - Supports both project-level and global skills
 *
 * Skill file format (skill.md):
 * ```markdown
 * # Skill Name
 * Description of what this skill does.
 *
 * ## Triggers
 * - keyword1
 * - keyword2
 * - /slash-command
 *
 * ## Instructions
 * Detailed instructions for agents when this skill is activated.
 *
 * ## Agent Hints
 * - cluster: core_development
 * - priority: high
 * ```
 *
 * Discovery:
 *   1. <project>/.apes/skills/<name>/skill.md
 *   2. ~/.apes/skills/<name>/skill.md
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';

export class SkillLoader {
    constructor() {
        /** @type {Map<string, Skill>} */
        this.skills = new Map();

        /** @type {string[]} loaded directories */
        this._loadedDirs = [];
    }

    /**
     * Discover and load all skills from project and global directories.
     * @param {string} [projectDir=process.cwd()]
     * @returns {Map<string, Skill>}
     */
    load(projectDir = process.cwd()) {
        this.skills.clear();
        this._loadedDirs = [];

        // Project-level skills (highest precedence)
        const projectSkillDir = join(resolve(projectDir), '.apes', 'skills');
        this._loadFromDir(projectSkillDir, 'project');

        // Global user skills
        const globalSkillDir = join(homedir(), '.apes', 'skills');
        this._loadFromDir(globalSkillDir, 'global');

        return this.skills;
    }

    /**
     * Load skills from a single directory.
     * @param {string} dir
     * @param {'project'|'global'} scope
     */
    _loadFromDir(dir, scope) {
        if (!this._isDir(dir)) return;

        this._loadedDirs.push(dir);
        let entries;
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            const skillDir = join(dir, entry);
            if (!this._isDir(skillDir)) continue;

            const skillFile = join(skillDir, 'skill.md');
            if (!this._isFile(skillFile)) continue;

            // Don't override project-level skills with global ones
            if (this.skills.has(entry) && scope === 'global') continue;

            try {
                const raw = readFileSync(skillFile, 'utf-8');
                const skill = this._parse(raw, entry, skillFile, scope);
                this.skills.set(entry, skill);
            } catch {
                // Skip unparseable skill files
            }
        }
    }

    /**
     * Parse a skill.md file into a Skill object.
     * @param {string} raw
     * @param {string} name
     * @param {string} filePath
     * @param {'project'|'global'} scope
     * @returns {Skill}
     */
    _parse(raw, name, filePath, scope) {
        const skill = {
            name,
            filePath,
            scope,
            description: '',
            triggers: [],
            slashCommands: [],
            instructions: '',
            agentHints: {},
            raw,
        };

        const lines = raw.split('\n');
        let currentSection = null;
        let currentLines = [];
        let descriptionLines = [];

        for (const line of lines) {
            const heading = line.match(/^#{1,3}\s+(.+)/);

            if (heading) {
                // Flush previous section
                if (currentSection) {
                    this._flushSkillSection(skill, currentSection, currentLines);
                } else if (descriptionLines.length > 0) {
                    skill.description = descriptionLines.join('\n').trim();
                }

                const sectionName = heading[1].trim().toLowerCase();
                // First heading is the skill title, skip if it matches name
                if (!currentSection && !skill.description && sectionName !== 'triggers' && sectionName !== 'instructions' && sectionName !== 'agent hints') {
                    skill.description = ''; // title heading, description follows
                    currentSection = null;
                    descriptionLines = [];
                    continue;
                }

                currentSection = sectionName;
                currentLines = [];
                continue;
            }

            if (currentSection) {
                currentLines.push(line);
            } else {
                descriptionLines.push(line);
            }
        }

        // Flush last section
        if (currentSection) {
            this._flushSkillSection(skill, currentSection, currentLines);
        }

        if (!skill.description && descriptionLines.length > 0) {
            skill.description = descriptionLines.join('\n').trim();
        }

        return skill;
    }

    /**
     * Flush section content into skill.
     */
    _flushSkillSection(skill, section, lines) {
        const content = lines.join('\n').trim();
        const normalized = section.replace(/[^a-z0-9]/g, '_');

        if (normalized.includes('trigger')) {
            const items = this._extractBulletList(content);
            for (const item of items) {
                if (item.startsWith('/')) {
                    skill.slashCommands.push(item);
                } else {
                    skill.triggers.push(item.toLowerCase());
                }
            }
        } else if (normalized.includes('instruction')) {
            skill.instructions = content;
        } else if (normalized.includes('agent') && normalized.includes('hint')) {
            const items = this._extractBulletList(content);
            for (const item of items) {
                const match = item.match(/^(\w+)\s*:\s*(.+)/);
                if (match) {
                    skill.agentHints[match[1].trim()] = match[2].trim();
                }
            }
        }
    }

    /**
     * Match user input against loaded skills.
     * Returns all matching skills sorted by relevance.
     * @param {string} input
     * @returns {Skill[]}
     */
    match(input) {
        if (!input) return [];

        const lower = input.toLowerCase();
        const tokens = lower.split(/\s+/);
        const matches = [];

        for (const [, skill] of this.skills) {
            let score = 0;

            // Check slash commands (exact match)
            if (input.startsWith('/')) {
                const cmd = input.split(/\s/)[0];
                if (skill.slashCommands.includes(cmd)) {
                    score += 100;
                }
            }

            // Check trigger keywords
            for (const trigger of skill.triggers) {
                if (lower.includes(trigger)) {
                    score += 10;
                }
                // Partial token matching
                for (const token of tokens) {
                    if (trigger.includes(token) && token.length >= 3) {
                        score += 3;
                    }
                }
            }

            // Check name match
            if (lower.includes(skill.name.toLowerCase())) {
                score += 5;
            }

            if (score > 0) {
                matches.push({ skill, score });
            }
        }

        // Sort by score descending
        matches.sort((a, b) => b.score - a.score);
        return matches.map(m => m.skill);
    }

    /**
     * Get a skill by name.
     * @param {string} name
     * @returns {Skill|undefined}
     */
    get(name) {
        return this.skills.get(name);
    }

    /**
     * Get all loaded skill names.
     * @returns {string[]}
     */
    list() {
        return [...this.skills.keys()];
    }

    /**
     * Get a summary of all loaded skills for display.
     * @returns {{ name: string, scope: string, triggers: string[], description: string }[]}
     */
    getSummary() {
        const result = [];
        for (const [, skill] of this.skills) {
            result.push({
                name: skill.name,
                scope: skill.scope,
                triggers: [...skill.triggers, ...skill.slashCommands],
                description: skill.description,
            });
        }
        return result;
    }

    // ─── Helpers ─────────────────────────────────────────────────

    _isFile(p) {
        try {
            return existsSync(p) && statSync(p).isFile();
        } catch {
            return false;
        }
    }

    _isDir(p) {
        try {
            return existsSync(p) && statSync(p).isDirectory();
        } catch {
            return false;
        }
    }

    _extractBulletList(content) {
        return content
            .split('\n')
            .filter(l => /^\s*[-*]\s+/.test(l))
            .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
            .filter(Boolean);
    }
}
