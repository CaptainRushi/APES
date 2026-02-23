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

        // ─── Layer 3: Skill Evolution ────────────────
        /** @type {Array<{pattern: string, optimization: string, discoveredAt: number, appliedCount: number}>} */
        this.skillEvolution = [];

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
        this.performanceMemory.push({
            ...entry,
            timestamp: Date.now(),
        });

        // Keep only last 1000 entries in memory
        if (this.performanceMemory.length > 1000) {
            this.performanceMemory = this.performanceMemory.slice(-500);
        }
    }

    getAgentPerformance(agentId) {
        const entries = this.performanceMemory.filter(e => e.agentId === agentId);

        if (entries.length === 0) return null;

        const avgDuration = entries.reduce((sum, e) => sum + e.duration, 0) / entries.length;
        const successRate = entries.filter(e => e.success).length / entries.length;
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
        const entries = this.performanceMemory.filter(e => e.cluster === cluster);
        if (entries.length === 0) return null;

        return {
            cluster,
            avgDuration: Math.round(
                entries.reduce((sum, e) => sum + e.duration, 0) / entries.length
            ),
            successRate: Math.round(
                (entries.filter(e => e.success).length / entries.length) * 100
            ) / 100,
        };
    }

    // ═══════════════════════════════════════════════
    // Skill Evolution (Layer 3)
    // ═══════════════════════════════════════════════

    recordPattern(pattern) {
        const existing = this.skillEvolution.find(p => p.pattern === pattern.pattern);

        if (existing) {
            existing.appliedCount += 1;
            existing.lastApplied = Date.now();
        } else {
            this.skillEvolution.push({
                ...pattern,
                discoveredAt: Date.now(),
                appliedCount: 1,
            });
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
            this.skillEvolution = data.skillEvolution || [];
            this.vectorMemory = data.vectorMemory || [];
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
