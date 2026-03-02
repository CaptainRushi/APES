/**
 * Capability Registry — Agent Specialization & Routing Metadata
 *
 * An overlay on top of AgentRegistry that provides:
 *   1. A capability index (skill → agent IDs)
 *   2. Live performance scoring per agent
 *   3. Runtime agent registration via JSON capability descriptors
 *   4. Efficient lookup for the Router (adaptive assignment)
 *
 * Capability Descriptor Schema:
 *   {
 *     agentId:     string,
 *     skills:      string[],        // e.g. ['coding', 'security', 'review']
 *     rank:        number,          // 0–100 initial competence
 *     tags:        string[],        // free-form labels
 *     maxConcurrency: number,       // max parallel tasks
 *   }
 */

import { EventEmitter } from 'node:events';

/**
 * @typedef {object} AgentCapability
 * @property {string}   agentId
 * @property {string[]} skills
 * @property {number}   rank
 * @property {string[]} tags
 * @property {number}   maxConcurrency
 * @property {number}   successRate        - rolling success ratio (0–1)
 * @property {number}   averageLatencyMs   - EMA of task latency
 * @property {number}   totalTasks
 * @property {number}   activeTasks        - currently in-flight
 * @property {number}   confidenceScore    - composite routing score
 * @property {number}   lastUpdated        - timestamp
 */

export class CapabilityRegistry extends EventEmitter {
    /**
     * @param {import('../agents/registry.js').AgentRegistry} [baseRegistry]
     */
    constructor(baseRegistry = null) {
        super();
        this.baseRegistry = baseRegistry;

        /** @type {Map<string, AgentCapability>} */
        this.capabilities = new Map();

        /** @type {Map<string, Set<string>>} skill → agent IDs */
        this.skillIndex = new Map();

        /** @type {Map<string, Set<string>>} tag → agent IDs */
        this.tagIndex = new Map();

        // Bootstrap from base registry if available
        if (baseRegistry) {
            this._bootstrapFromBase();
        }
    }

    // ─── Registration ─────────────────────────────────────────────

    /**
     * Register an agent's capabilities (or update existing).
     * @param {object} descriptor — JSON capability descriptor
     */
    register(descriptor) {
        const {
            agentId,
            skills = [],
            rank = 50,
            tags = [],
            maxConcurrency = 3,
        } = descriptor;

        if (!agentId) throw new Error('Capability descriptor requires agentId');

        const existing = this.capabilities.get(agentId);

        const cap = {
            agentId,
            skills,
            rank,
            tags,
            maxConcurrency,
            successRate: existing?.successRate ?? 1.0,
            averageLatencyMs: existing?.averageLatencyMs ?? 0,
            totalTasks: existing?.totalTasks ?? 0,
            activeTasks: existing?.activeTasks ?? 0,
            confidenceScore: existing?.confidenceScore ?? (rank / 100),
            lastUpdated: Date.now(),
        };

        this.capabilities.set(agentId, cap);

        // Update skill index
        for (const skill of skills) {
            if (!this.skillIndex.has(skill)) this.skillIndex.set(skill, new Set());
            this.skillIndex.get(skill).add(agentId);
        }

        // Update tag index
        for (const tag of tags) {
            if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
            this.tagIndex.get(tag).add(agentId);
        }

        this.emit('capability:registered', { agentId, skills, rank });
    }

    /**
     * Unregister an agent.
     * @param {string} agentId
     */
    unregister(agentId) {
        const cap = this.capabilities.get(agentId);
        if (!cap) return;

        // Clean indexes
        for (const skill of cap.skills) {
            this.skillIndex.get(skill)?.delete(agentId);
        }
        for (const tag of cap.tags) {
            this.tagIndex.get(tag)?.delete(agentId);
        }

        this.capabilities.delete(agentId);
        this.emit('capability:unregistered', { agentId });
    }

    // ─── Queries ──────────────────────────────────────────────────

    /**
     * Find agents that have ALL of the required skills.
     * @param {string[]} requiredSkills
     * @returns {AgentCapability[]} Sorted by confidenceScore desc
     */
    findBySkills(requiredSkills) {
        if (!requiredSkills || requiredSkills.length === 0) {
            return [...this.capabilities.values()]
                .sort((a, b) => b.confidenceScore - a.confidenceScore);
        }

        // Intersection: agents that possess every required skill
        const candidateSets = requiredSkills
            .map(s => this.skillIndex.get(s))
            .filter(Boolean);

        if (candidateSets.length === 0) return [];

        const intersection = [...candidateSets[0]].filter(id =>
            candidateSets.every(set => set.has(id))
        );

        return intersection
            .map(id => this.capabilities.get(id))
            .filter(Boolean)
            .sort((a, b) => b.confidenceScore - a.confidenceScore);
    }

    /**
     * Find agents matching any of the given tags.
     * @param {string[]} tags
     * @returns {AgentCapability[]}
     */
    findByTags(tags) {
        const ids = new Set();
        for (const tag of tags) {
            const set = this.tagIndex.get(tag);
            if (set) for (const id of set) ids.add(id);
        }
        return [...ids]
            .map(id => this.capabilities.get(id))
            .filter(Boolean)
            .sort((a, b) => b.confidenceScore - a.confidenceScore);
    }

    /**
     * Get the single best agent for a set of required skills,
     * respecting concurrency limits.
     * @param {string[]} requiredSkills
     * @returns {AgentCapability|null}
     */
    getBestAgent(requiredSkills) {
        const candidates = this.findBySkills(requiredSkills);
        for (const cap of candidates) {
            if (cap.activeTasks < cap.maxConcurrency) {
                return cap;
            }
        }
        // All at capacity — return highest-scored anyway
        return candidates[0] || null;
    }

    // ─── Metrics Reporting ────────────────────────────────────────

    /**
     * Called when an agent begins a task.
     * @param {string} agentId
     */
    markTaskStarted(agentId) {
        const cap = this.capabilities.get(agentId);
        if (!cap) return;
        cap.activeTasks++;
        cap.lastUpdated = Date.now();
    }

    /**
     * Called when an agent completes or fails a task.
     * @param {string}  agentId
     * @param {object}  result
     * @param {boolean} result.success
     * @param {number}  result.durationMs
     */
    reportTaskResult(agentId, { success, durationMs }) {
        const cap = this.capabilities.get(agentId);
        if (!cap) return;

        cap.activeTasks = Math.max(0, cap.activeTasks - 1);
        cap.totalTasks++;
        cap.lastUpdated = Date.now();

        // EMA for latency (α = 0.3)
        const alpha = 0.3;
        cap.averageLatencyMs = cap.averageLatencyMs * (1 - alpha) + durationMs * alpha;

        // EMA for success rate
        cap.successRate = cap.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;

        // Recompute composite confidence
        cap.confidenceScore = this._computeConfidence(cap);

        // Propagate to base registry
        if (this.baseRegistry) {
            this.baseRegistry.updateAgentMetrics(agentId, {
                duration: durationMs,
                failed: !success,
            });
        }

        this.emit('capability:metric', { agentId, success, durationMs, confidence: cap.confidenceScore });
    }

    // ─── Confidence Score ─────────────────────────────────────────

    /**
     * Composite confidence = weighted sum.
     *
     *   Score = (successRate × 0.30)
     *         + (rankNorm    × 0.20)
     *         + (latencyNorm × 0.20)
     *         + (capacityNorm× 0.15)
     *         + (recency     × 0.15)
     *
     * @param {AgentCapability} cap
     * @returns {number} 0..1
     */
    _computeConfidence(cap) {
        const successW = 0.30;
        const rankW = 0.20;
        const latencyW = 0.20;
        const capacityW = 0.15;
        const recencyW = 0.15;

        const rankNorm = cap.rank / 100;
        const latencyNorm = Math.max(0, 1 - cap.averageLatencyMs / 30000);
        const capacityNorm = cap.maxConcurrency > 0
            ? 1 - (cap.activeTasks / cap.maxConcurrency)
            : 0;
        const recency = Math.max(0, 1 - (Date.now() - cap.lastUpdated) / (60 * 60 * 1000));

        return (
            cap.successRate * successW +
            rankNorm * rankW +
            latencyNorm * latencyW +
            capacityNorm * capacityW +
            recency * recencyW
        );
    }

    // ─── Bootstrap ────────────────────────────────────────────────

    /** @private */
    _bootstrapFromBase() {
        if (!this.baseRegistry) return;
        for (const [id, agent] of this.baseRegistry.agents) {
            this.register({
                agentId: id,
                skills: agent.skills || [],
                rank: Math.round((agent.confidenceScore ?? 0.7) * 100),
                tags: [agent.cluster].filter(Boolean),
                maxConcurrency: 3,
            });
        }
    }

    // ─── Status ───────────────────────────────────────────────────

    getStatus() {
        return {
            totalAgents: this.capabilities.size,
            totalSkills: this.skillIndex.size,
            totalTags: this.tagIndex.size,
            topAgents: [...this.capabilities.values()]
                .sort((a, b) => b.confidenceScore - a.confidenceScore)
                .slice(0, 10)
                .map(c => ({ agentId: c.agentId, score: c.confidenceScore.toFixed(3), skills: c.skills })),
        };
    }
}
