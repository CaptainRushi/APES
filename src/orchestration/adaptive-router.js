/**
 * Adaptive Router — RL-Inspired Agent Task Assignment
 *
 * Selects the optimal agent for a task using a scoring model inspired by
 * Mixture-of-Experts (MoE) and Q-Learning:
 *
 *   routingScore = Σ  weight_i × feature_i
 *
 * Features:
 *   - skillMatch     (0–1)  Does the agent have the required skills?
 *   - successRate    (0–1)  Historical success rate
 *   - latencyScore   (0–1)  Inverse of average latency
 *   - costScore      (0–1)  Inverse of estimated cost
 *   - confidenceScore(0–1)  From CapabilityRegistry
 *   - capacityScore  (0–1)  Available capacity
 *
 * Weights are adaptive: updated after each task outcome using a simple
 * policy gradient step (reinforce successful weight distributions).
 *
 * Also supports:
 *   - Pre-task hooks and post-task hooks
 *   - Quality gates (validators before commit)
 *   - Error handler escalation
 */

import { EventEmitter } from 'node:events';

// ─── Default Routing Weights ──────────────────────────────────────
const DEFAULT_WEIGHTS = Object.freeze({
    skillMatch: 0.25,
    successRate: 0.20,
    latency: 0.15,
    cost: 0.15,
    confidence: 0.15,
    capacity: 0.10,
});

// ─── Hook Types ───────────────────────────────────────────────────
export const HOOK_TYPE = Object.freeze({
    PRE_TASK: 'preTask',
    POST_TASK: 'postTask',
    ON_ERROR: 'onError',
    QUALITY_GATE: 'qualityGate',
});

export class AdaptiveRouter extends EventEmitter {
    /**
     * @param {object} opts
     * @param {import('./capability-registry.js').CapabilityRegistry} opts.capabilityRegistry
     * @param {object} [opts.weights] - Override default routing weights
     * @param {number} [opts.learningRate=0.01] - Weight update step size
     */
    constructor({ capabilityRegistry, weights, learningRate = 0.01 } = {}) {
        super();
        this.capReg = capabilityRegistry;
        this.weights = { ...DEFAULT_WEIGHTS, ...weights };
        this.learningRate = learningRate;

        /** @type {Map<string, Function[]>} hookType → handler[] */
        this.hooks = new Map();
        for (const type of Object.values(HOOK_TYPE)) {
            this.hooks.set(type, []);
        }

        /** Routing history for analytics */
        this.history = [];
        this.maxHistory = 500;
    }

    // ─── Core Routing ─────────────────────────────────────────────

    /**
     * Route a task to the best agent.
     *
     * @param {object} task
     * @param {string[]} task.requiredSkills
     * @param {string}   task.description
     * @param {string}   [task.complexity] - 'simple'|'medium'|'complex'
     * @param {number}   [task.estimatedCost] - Estimated cost (0..1 normalized)
     * @returns {Promise<{ agentId: string, score: number, breakdown: object }|null>}
     */
    async route(task) {
        // ── Pre-task hooks ──
        await this._runHooks(HOOK_TYPE.PRE_TASK, { task });

        const candidates = this.capReg.findBySkills(task.requiredSkills || []);
        if (candidates.length === 0) {
            // Fallback: return any available agent
            const all = [...this.capReg.capabilities.values()]
                .filter(c => c.activeTasks < c.maxConcurrency);
            if (all.length === 0) return null;
            candidates.push(...all);
        }

        // Score each candidate
        const scored = candidates.map(cap => {
            const breakdown = this._score(cap, task);
            const total = Object.entries(breakdown).reduce(
                (sum, [key, val]) => sum + (this.weights[key] || 0) * val, 0
            );
            return { agentId: cap.agentId, score: total, breakdown };
        });

        // Sort descending by score
        scored.sort((a, b) => b.score - a.score);

        const best = scored[0];

        // Record routing decision
        this.history.push({
            timestamp: Date.now(),
            taskDescription: task.description?.slice(0, 100),
            selectedAgent: best.agentId,
            score: best.score,
            candidateCount: scored.length,
        });
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }

        this.emit('router:assigned', {
            agentId: best.agentId,
            score: best.score,
            candidates: scored.length,
        });

        return best;
    }

    /**
     * Compute feature scores for a candidate agent.
     * @private
     */
    _score(cap, task) {
        // Skill match: fraction of required skills the agent possesses
        const required = task.requiredSkills || [];
        const skillMatch = required.length > 0
            ? required.filter(s => cap.skills.includes(s)).length / required.length
            : 1.0;

        // Success rate (already 0–1)
        const successRate = cap.successRate;

        // Latency score: inverted, clamped
        const latency = Math.max(0, 1 - cap.averageLatencyMs / 30000);

        // Cost score: lower is better (simple proxy)
        const cost = task.estimatedCost != null
            ? Math.max(0, 1 - task.estimatedCost)
            : 0.5;

        // Confidence from registry
        const confidence = cap.confidenceScore;

        // Capacity: fraction of capacity available
        const capacity = cap.maxConcurrency > 0
            ? Math.max(0, 1 - cap.activeTasks / cap.maxConcurrency)
            : 0;

        return { skillMatch, successRate, latency, cost, confidence, capacity };
    }

    // ─── Weight Adaptation ────────────────────────────────────────

    /**
     * After a task completes, update routing weights using a simple policy
     * gradient: reinforce the feature dimensions that contributed to success;
     * penalize those that contributed to failure.
     *
     * @param {object}  result
     * @param {boolean} result.success
     * @param {object}  result.breakdown - Feature scores from routing
     */
    updateWeights({ success, breakdown }) {
        if (!breakdown) return;

        const direction = success ? 1 : -1;

        for (const key of Object.keys(this.weights)) {
            const featureVal = breakdown[key] ?? 0;
            // Gradient: move weight towards features that were high on success
            this.weights[key] += this.learningRate * direction * featureVal;
            // Clamp to [0.01, 0.50]
            this.weights[key] = Math.max(0.01, Math.min(0.50, this.weights[key]));
        }

        // Normalize so weights sum to 1
        const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
        for (const key of Object.keys(this.weights)) {
            this.weights[key] /= sum;
        }

        this.emit('router:weights-updated', { weights: { ...this.weights } });
    }

    // ─── Hooks System ─────────────────────────────────────────────

    /**
     * Register a hook.
     * @param {string}   type - One of HOOK_TYPE values
     * @param {Function} handler - async (context) => void
     */
    registerHook(type, handler) {
        const handlers = this.hooks.get(type);
        if (!handlers) throw new Error(`Unknown hook type: ${type}`);
        handlers.push(handler);
    }

    /**
     * Run all hooks of a given type.
     * @param {string} type
     * @param {object} context
     * @private
     */
    async _runHooks(type, context) {
        const handlers = this.hooks.get(type) || [];
        for (const handler of handlers) {
            try {
                await handler(context);
            } catch (err) {
                this.emit('router:hook-error', { type, error: err.message });
            }
        }
    }

    /**
     * Run post-task hooks + optional quality gate.
     * Quality gates can throw to reject the result.
     *
     * @param {object} context - { task, agentId, result }
     * @returns {Promise<{ passed: boolean, errors: string[] }>}
     */
    async runPostTask(context) {
        await this._runHooks(HOOK_TYPE.POST_TASK, context);

        const errors = [];
        const gates = this.hooks.get(HOOK_TYPE.QUALITY_GATE) || [];
        for (const gate of gates) {
            try {
                await gate(context);
            } catch (err) {
                errors.push(err.message);
            }
        }

        return { passed: errors.length === 0, errors };
    }

    /**
     * Run error handlers.
     * @param {object} context - { task, agentId, error }
     */
    async runErrorHandlers(context) {
        await this._runHooks(HOOK_TYPE.ON_ERROR, context);
    }

    // ─── Status ───────────────────────────────────────────────────

    getStatus() {
        return {
            weights: { ...this.weights },
            hookCounts: Object.fromEntries(
                [...this.hooks.entries()].map(([k, v]) => [k, v.length])
            ),
            totalRoutings: this.history.length,
            recentRoutings: this.history.slice(-5).map(h => ({
                agent: h.selectedAgent,
                score: h.score.toFixed(3),
                desc: h.taskDescription,
            })),
        };
    }
}
