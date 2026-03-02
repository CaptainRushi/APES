/**
 * Pattern Bank — Self-Learning Reasoning Pattern Storage
 *
 * Implements the RETRIEVE → JUDGE → DISTILL → CONSOLIDATE → ROUTE cycle:
 *
 *   1. RETRIEVE  — Pull past reasoning patterns from the bank
 *   2. JUDGE     — Score the relevance and quality of retrieved patterns
 *   3. DISTILL   — Compress successful patterns into compact templates
 *   4. CONSOLIDATE — Merge overlapping patterns, prune low-value ones
 *   5. ROUTE     — Feed best patterns back to the Router for weight updates
 *
 * Pattern Schema:
 *   {
 *     id, type, description, template,
 *     successCount, failureCount, score,
 *     tags, createdAt, lastUsed
 *   }
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';

/**
 * @typedef {object} ReasoningPattern
 * @property {string}   id
 * @property {string}   type          - e.g. 'coding', 'debugging', 'architecture'
 * @property {string}   description   - Human-readable description
 * @property {string}   template      - The distilled pattern/prompt template
 * @property {number}   successCount
 * @property {number}   failureCount
 * @property {number}   score         - Quality score (0–1)
 * @property {string[]} tags
 * @property {number}   createdAt
 * @property {number}   lastUsed
 */

export class PatternBank extends EventEmitter {
    /**
     * @param {object} [opts]
     * @param {string} [opts.storagePath]
     * @param {number} [opts.maxPatterns=1000]
     * @param {number} [opts.consolidateThreshold=0.85] - Similarity above this merges
     */
    constructor({ storagePath, maxPatterns = 1000, consolidateThreshold = 0.85 } = {}) {
        super();
        this.storagePath = storagePath || join(homedir(), '.apes', 'memory', 'patterns');
        this.maxPatterns = maxPatterns;
        this.consolidateThreshold = consolidateThreshold;

        /** @type {Map<string, ReasoningPattern>} */
        this.patterns = new Map();

        /** @type {Map<string, Set<string>>} type → pattern IDs */
        this.typeIndex = new Map();
    }

    // ─── RETRIEVE ─────────────────────────────────────────────────

    /**
     * Retrieve patterns matching a task type and optional tags.
     * @param {object} query
     * @param {string} [query.type]
     * @param {string[]} [query.tags]
     * @param {number} [query.topK=5]
     * @returns {ReasoningPattern[]}
     */
    retrieve({ type, tags, topK = 5 } = {}) {
        let candidates = [...this.patterns.values()];

        if (type) {
            candidates = candidates.filter(p => p.type === type);
        }

        if (tags && tags.length > 0) {
            candidates = candidates.filter(p =>
                tags.some(t => p.tags.includes(t))
            );
        }

        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);
        return candidates.slice(0, topK);
    }

    // ─── JUDGE ────────────────────────────────────────────────────

    /**
     * Judge whether a retrieved pattern was useful for a task.
     * @param {string}  patternId
     * @param {boolean} wasUseful
     */
    judge(patternId, wasUseful) {
        const pattern = this.patterns.get(patternId);
        if (!pattern) return;

        if (wasUseful) {
            pattern.successCount++;
        } else {
            pattern.failureCount++;
        }

        pattern.lastUsed = Date.now();

        // Recompute score
        const total = pattern.successCount + pattern.failureCount;
        pattern.score = total > 0 ? pattern.successCount / total : 0.5;

        this.emit('pattern:judged', { patternId, wasUseful, newScore: pattern.score });
    }

    // ─── DISTILL ──────────────────────────────────────────────────

    /**
     * Distill a new reasoning pattern from a completed task.
     *
     * @param {object} opts
     * @param {string} opts.type
     * @param {string} opts.description
     * @param {string} opts.template     - The reasoning/prompt template
     * @param {string[]} [opts.tags]
     * @returns {ReasoningPattern}
     */
    distill({ type, description, template, tags = [] }) {
        const id = `pat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const pattern = {
            id,
            type,
            description,
            template,
            successCount: 1,
            failureCount: 0,
            score: 1.0,
            tags,
            createdAt: Date.now(),
            lastUsed: Date.now(),
        };

        this.patterns.set(id, pattern);

        if (!this.typeIndex.has(type)) this.typeIndex.set(type, new Set());
        this.typeIndex.get(type).add(id);

        // Consolidate if at capacity
        if (this.patterns.size > this.maxPatterns) {
            this.consolidate();
        }

        this.emit('pattern:distilled', { id, type, description: description.slice(0, 60) });
        return pattern;
    }

    // ─── CONSOLIDATE ──────────────────────────────────────────────

    /**
     * Merge duplicate/overlapping patterns and prune low-value ones.
     */
    consolidate() {
        const all = [...this.patterns.values()];

        // Step 1: prune patterns with very low scores and > 5 uses
        for (const p of all) {
            const total = p.successCount + p.failureCount;
            if (total >= 5 && p.score < 0.2) {
                this.patterns.delete(p.id);
                this.typeIndex.get(p.type)?.delete(p.id);
            }
        }

        // Step 2: merge near-duplicates within same type
        for (const [type, ids] of this.typeIndex) {
            const typePatterns = [...ids]
                .map(id => this.patterns.get(id))
                .filter(Boolean);

            for (let i = 0; i < typePatterns.length; i++) {
                for (let j = i + 1; j < typePatterns.length; j++) {
                    const sim = this._textSimilarity(
                        typePatterns[i].description,
                        typePatterns[j].description
                    );
                    if (sim >= this.consolidateThreshold) {
                        // Merge j into i (keep higher-scored)
                        const keep = typePatterns[i].score >= typePatterns[j].score
                            ? typePatterns[i] : typePatterns[j];
                        const discard = keep === typePatterns[i] ? typePatterns[j] : typePatterns[i];

                        keep.successCount += discard.successCount;
                        keep.failureCount += discard.failureCount;
                        const total = keep.successCount + keep.failureCount;
                        keep.score = total > 0 ? keep.successCount / total : 0.5;

                        this.patterns.delete(discard.id);
                        ids.delete(discard.id);
                    }
                }
            }
        }

        this.emit('pattern:consolidated', { remaining: this.patterns.size });
    }

    // ─── ROUTE ────────────────────────────────────────────────────

    /**
     * Export top patterns per type for the Router to use in weight adaptation.
     * @param {number} [topPerType=3]
     * @returns {object} { [type]: ReasoningPattern[] }
     */
    getRoutingInsights(topPerType = 3) {
        const insights = {};
        for (const [type, ids] of this.typeIndex) {
            const patterns = [...ids]
                .map(id => this.patterns.get(id))
                .filter(Boolean)
                .sort((a, b) => b.score - a.score)
                .slice(0, topPerType);
            if (patterns.length > 0) insights[type] = patterns;
        }
        return insights;
    }

    // ─── Similarity ───────────────────────────────────────────────

    /**
     * Simple Jaccard-like text similarity.
     * @private
     */
    _textSimilarity(a, b) {
        const tokensA = new Set(a.toLowerCase().split(/\s+/));
        const tokensB = new Set(b.toLowerCase().split(/\s+/));
        const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
        const union = new Set([...tokensA, ...tokensB]).size;
        return union > 0 ? intersection / union : 0;
    }

    // ─── Persistence ──────────────────────────────────────────────

    async save() {
        try {
            await mkdir(this.storagePath, { recursive: true });
            const data = {
                patterns: [...this.patterns.entries()],
                savedAt: new Date().toISOString(),
            };
            await writeFile(
                join(this.storagePath, 'patterns.json'),
                JSON.stringify(data),
                'utf-8'
            );
        } catch { /* non-critical */ }
    }

    async load() {
        try {
            const raw = await readFile(join(this.storagePath, 'patterns.json'), 'utf-8');
            const data = JSON.parse(raw);
            this.patterns = new Map(data.patterns || []);
            // Rebuild index
            this.typeIndex.clear();
            for (const [id, p] of this.patterns) {
                if (!this.typeIndex.has(p.type)) this.typeIndex.set(p.type, new Set());
                this.typeIndex.get(p.type).add(id);
            }
        } catch { /* start fresh */ }
    }

    // ─── Status ───────────────────────────────────────────────────

    getStatus() {
        return {
            totalPatterns: this.patterns.size,
            types: [...this.typeIndex.keys()],
            topPatterns: [...this.patterns.values()]
                .sort((a, b) => b.score - a.score)
                .slice(0, 5)
                .map(p => ({ id: p.id, type: p.type, score: p.score.toFixed(2), desc: p.description.slice(0, 50) })),
        };
    }
}
