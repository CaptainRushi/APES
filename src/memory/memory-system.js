/**
 * Memory System
 * 
 * Multi-layered memory architecture:
 * 
 *   1. Session Memory     — current task context, temporary reasoning
 *   2. Performance Memory — agent metrics, time taken, failure rate
 *   3. Skill Evolution    — new patterns learned, optimizations discovered
 *   4. Vector Memory      — (future) embeddings of completed tasks for similarity retrieval
 * 
 * Currently implements layers 1-3 using in-memory storage.
 * Vector memory (Layer 4) will use a vector DB (e.g., Supabase pgvector).
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class MemorySystem {
    constructor(storagePath = null) {
        this.storagePath = storagePath;

        // ─── Layer 1: Session Memory ─────────────────
        /** @type {Map<string, any>} */
        this.sessionMemory = new Map();

        // ─── Layer 2: Performance Memory ─────────────
        /** @type {Array<{timestamp: number, agentId: string, duration: number, success: boolean, complexity: string}>} */
        this.performanceMemory = [];

        /**
         * Secondary index: agentId → entries[] for O(1) agent lookup.
         * Kept in sync with performanceMemory by recordPerformance().
         * @type {Map<string, Array>}
         */
        this._agentPerfIndex = new Map();

        /**
         * Secondary index: cluster → entries[] for O(1) cluster lookup.
         * @type {Map<string, Array>}
         */
        this._clusterPerfIndex = new Map();

        // ─── Layer 3: Skill Evolution ────────────────
        /** @type {Array<{pattern: string, optimization: string, discoveredAt: number, appliedCount: number}>} */
        this.skillEvolution = [];

        /**
         * Index: pattern string → skillEvolution entry for O(1) pattern lookup
         * in recordPattern (replaces linear find).
         * @type {Map<string, object>}
         */
        this._skillPatternIndex = new Map();

        // ─── Layer 4: Vector Memory (Future) ─────────
        // Will store embeddings of completed tasks for pattern matching
        /** @type {Array<{embedding: number[], taskDescription: string, solution: string}>} */
        this.vectorMemory = [];
    }

    // ═══════════════════════════════════════════════
    // Session Memory (Layer 1)
    // ═══════════════════════════════════════════════

    setSession(key, value) {
        this.sessionMemory.set(key, {
            value,
            updatedAt: Date.now(),
        });
    }

    getSession(key) {
        const entry = this.sessionMemory.get(key);
        return entry ? entry.value : null;
    }

    clearSession() {
        this.sessionMemory.clear();
    }

    // ═══════════════════════════════════════════════
    // Performance Memory (Layer 2)
    // ═══════════════════════════════════════════════

    recordPerformance(entry) {
        const record = { ...entry, timestamp: Date.now() };
        this.performanceMemory.push(record);

        // Maintain agentId index
        if (entry.agentId) {
            if (!this._agentPerfIndex.has(entry.agentId)) {
                this._agentPerfIndex.set(entry.agentId, []);
            }
            this._agentPerfIndex.get(entry.agentId).push(record);
        }

        // Maintain cluster index
        if (entry.cluster) {
            if (!this._clusterPerfIndex.has(entry.cluster)) {
                this._clusterPerfIndex.set(entry.cluster, []);
            }
            this._clusterPerfIndex.get(entry.cluster).push(record);
        }

        // Keep only last 1000 entries total; rebuild indexes on trim to stay consistent.
        if (this.performanceMemory.length > 1000) {
            this.performanceMemory = this.performanceMemory.slice(-500);
            this._rebuildPerfIndexes();
        }
    }

    /** @private Rebuild secondary indexes after a trim. */
    _rebuildPerfIndexes() {
        this._agentPerfIndex.clear();
        this._clusterPerfIndex.clear();
        for (const record of this.performanceMemory) {
            if (record.agentId) {
                if (!this._agentPerfIndex.has(record.agentId)) this._agentPerfIndex.set(record.agentId, []);
                this._agentPerfIndex.get(record.agentId).push(record);
            }
            if (record.cluster) {
                if (!this._clusterPerfIndex.has(record.cluster)) this._clusterPerfIndex.set(record.cluster, []);
                this._clusterPerfIndex.get(record.cluster).push(record);
            }
        }
    }

    getAgentPerformance(agentId) {
        // O(agent_executions) via index instead of O(all_executions) linear scan
        const entries = this._agentPerfIndex.get(agentId);
        if (!entries || entries.length === 0) return null;

        let totalDuration = 0;
        let successCount  = 0;
        for (const e of entries) {
            totalDuration += e.duration;
            if (e.success) successCount++;
        }

        const avgDuration = totalDuration / entries.length;
        const successRate = successCount / entries.length;
        const recentTrend = this.calculateTrend(entries.slice(-10));

        return {
            agentId,
            totalExecutions: entries.length,
            avgDuration: Math.round(avgDuration),
            successRate: Math.round(successRate * 100) / 100,
            recentTrend,
        };
    }

    getClusterPerformance(cluster) {
        // O(cluster_executions) via index instead of O(all_executions) linear scan
        const entries = this._clusterPerfIndex.get(cluster);
        if (!entries || entries.length === 0) return null;

        let totalDuration = 0;
        let successCount  = 0;
        for (const e of entries) {
            totalDuration += e.duration;
            if (e.success) successCount++;
        }

        return {
            cluster,
            avgDuration: Math.round(totalDuration / entries.length),
            successRate: Math.round((successCount / entries.length) * 100) / 100,
        };
    }

    // ═══════════════════════════════════════════════
    // Skill Evolution (Layer 3)
    // ═══════════════════════════════════════════════

    recordPattern(pattern) {
        // O(1) index lookup instead of O(n) Array.find
        const existing = this._skillPatternIndex.get(pattern.pattern);

        if (existing) {
            existing.appliedCount += 1;
            existing.lastApplied = Date.now();
        } else {
            const record = {
                ...pattern,
                discoveredAt: Date.now(),
                appliedCount: 1,
            };
            this.skillEvolution.push(record);
            this._skillPatternIndex.set(pattern.pattern, record);
        }
    }

    getLearnedPatterns() {
        return [...this.skillEvolution].sort((a, b) => b.appliedCount - a.appliedCount);
    }

    // ═══════════════════════════════════════════════
    // Vector Memory (Layer 4 — Stub)
    // ═══════════════════════════════════════════════

    async findSimilarTasks(taskDescription) {
        // Future: use embedding similarity search
        // For now, simple keyword matching
        const keywords = taskDescription.toLowerCase().split(/\s+/);

        return this.vectorMemory
            .filter(entry => {
                const entryWords = entry.taskDescription.toLowerCase().split(/\s+/);
                const overlap = keywords.filter(kw => entryWords.includes(kw)).length;
                return overlap >= 2;
            })
            .slice(0, 5);
    }

    storeTaskSolution(taskDescription, solution) {
        this.vectorMemory.push({
            taskDescription,
            solution,
            storedAt: Date.now(),
            embedding: [], // Future: compute embedding
        });
    }

    // ═══════════════════════════════════════════════
    // Persistence
    // ═══════════════════════════════════════════════

    async save() {
        if (!this.storagePath) return;

        try {
            await mkdir(this.storagePath, { recursive: true });

            const data = {
                performanceMemory: this.performanceMemory,
                skillEvolution: this.skillEvolution,
                vectorMemory: this.vectorMemory,
                savedAt: Date.now(),
            };

            await writeFile(
                join(this.storagePath, 'memory.json'),
                JSON.stringify(data, null, 2)
            );
        } catch (error) {
            console.error('Failed to save memory:', error.message);
        }
    }

    async load() {
        if (!this.storagePath) return;

        try {
            const raw = await readFile(join(this.storagePath, 'memory.json'), 'utf-8');
            const data = JSON.parse(raw);

            this.performanceMemory = data.performanceMemory || [];
            this.skillEvolution    = data.skillEvolution    || [];
            this.vectorMemory      = data.vectorMemory      || [];

            // Rebuild indexes from loaded data
            this._rebuildPerfIndexes();
            this._skillPatternIndex.clear();
            for (const record of this.skillEvolution) {
                if (record.pattern) this._skillPatternIndex.set(record.pattern, record);
            }
        } catch {
            // No saved memory — start fresh
        }
    }

    // ═══════════════════════════════════════════════
    // Utilities
    // ═══════════════════════════════════════════════

    calculateTrend(recentEntries) {
        if (recentEntries.length < 3) return 'stable';

        const half = Math.floor(recentEntries.length / 2);
        const firstHalf = recentEntries.slice(0, half);
        const secondHalf = recentEntries.slice(half);

        const firstAvg = firstHalf.reduce((s, e) => s + e.duration, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((s, e) => s + e.duration, 0) / secondHalf.length;

        if (secondAvg < firstAvg * 0.8) return 'improving';
        if (secondAvg > firstAvg * 1.2) return 'degrading';
        return 'stable';
    }

    getStatus() {
        return {
            sessionEntries: this.sessionMemory.size,
            performanceEntries: this.performanceMemory.length,
            learnedPatterns: this.skillEvolution.length,
            vectorEntries: this.vectorMemory.length,
        };
    }
}
