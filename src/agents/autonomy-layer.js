/**
 * Autonomy Layer — Agent Intelligence
 *
 * This is where agents become intelligent.
 *
 * Responsibilities:
 *   - Planning (micro-task decomposition)
 *   - Learning (from past executions)
 *   - Escalation (when stuck or low confidence)
 *   - Conflict detection (disagreement with peers)
 *   - Retry logic (with strategy switching)
 *   - Strategy switching (adapt approach on failure)
 *
 * Autonomy State:
 *   { attempts, failureCount, lastConfidence, strategy, escalated }
 *
 * Rules:
 *   - confidence < 0.7 → ask Research cluster for help
 *   - stuck 2 times    → escalate to Lead/meta-evaluator
 *   - conflict detected → call Conflict Resolver
 */

/**
 * @typedef {object} AutonomyState
 * @property {number} attempts       — total execution attempts
 * @property {number} failureCount   — consecutive failures
 * @property {number} lastConfidence — confidence from last attempt
 * @property {string} strategy       — current execution strategy
 * @property {boolean} escalated     — has this been escalated?
 * @property {string[]} strategies   — strategies tried so far
 */

/** Available strategies in order of preference */
const STRATEGIES = [
    'direct',          // Straight skill execution
    'decompose_first', // Break down then execute
    'research_assist', // Query research cluster first
    'consensus',       // Multi-perspective approach
];

export class AutonomyLayer {
    /**
     * @param {object} config
     * @param {string} config.agentId
     * @param {string} config.cluster
     * @param {string} [config.autonomyLevel='medium'] — 'low'|'medium'|'high'
     * @param {number} [config.maxRetries=2]
     * @param {number} [config.confidenceThreshold=0.75]
     */
    constructor(config) {
        this.agentId = config.agentId;
        this.cluster = config.cluster;
        this.autonomyLevel = config.autonomyLevel || 'medium';
        this.maxRetries = config.maxRetries ?? 2;
        this.confidenceThreshold = config.confidenceThreshold ?? 0.75;

        /** @type {AutonomyState} */
        this.state = {
            attempts: 0,
            failureCount: 0,
            lastConfidence: 1.0,
            strategy: 'direct',
            escalated: false,
            strategies: [],
        };
    }

    /**
     * Plan the execution strategy before starting.
     * @param {object} agentInput - Structured agent input
     * @returns {{ strategy: string, steps: string[], shouldDecompose: boolean }}
     */
    plan(agentInput) {
        const complexity = agentInput.complexityLevel || 'medium';
        const hasDeps = (agentInput.dependencies?.length || 0) > 0;

        let strategy = 'direct';
        const steps = [];

        if (complexity === 'complex' || hasDeps) {
            strategy = 'decompose_first';
            steps.push('decompose_task', 'resolve_dependencies', 'execute_skills', 'validate');
        } else if (complexity === 'medium') {
            strategy = 'direct';
            steps.push('execute_skills', 'validate');
        } else {
            strategy = 'direct';
            steps.push('execute_skills');
        }

        // If we've failed before, switch strategy
        if (this.state.failureCount > 0) {
            strategy = this._nextStrategy();
            steps.unshift('retry_with_new_strategy');
        }

        this.state.strategy = strategy;
        if (!this.state.strategies.includes(strategy)) {
            this.state.strategies.push(strategy);
        }

        return {
            strategy,
            steps,
            shouldDecompose: strategy === 'decompose_first',
        };
    }

    /**
     * Record an execution attempt.
     * @param {{ success: boolean, confidence: number }} result
     * @returns {{ shouldRetry: boolean, shouldEscalate: boolean, action: string }}
     */
    recordAttempt(result) {
        this.state.attempts++;
        this.state.lastConfidence = result.confidence;

        if (!result.success) {
            this.state.failureCount++;
        } else {
            this.state.failureCount = 0; // Reset on success
        }

        return this.decide(result);
    }

    /**
     * Make autonomy decision based on current state.
     * @param {{ success: boolean, confidence: number }} result
     * @returns {{ shouldRetry: boolean, shouldEscalate: boolean, action: string, reason: string }}
     */
    decide(result) {
        // Rule 1: If stuck 2+ times → escalate to Lead
        if (this.state.failureCount >= this.maxRetries) {
            this.state.escalated = true;
            return {
                shouldRetry: false,
                shouldEscalate: true,
                action: 'escalate',
                reason: `Failed ${this.state.failureCount} times — escalating to Lead`,
            };
        }

        // Rule 2: If confidence < threshold → request research assistance
        if (result.confidence < 0.5) {
            return {
                shouldRetry: true,
                shouldEscalate: false,
                action: 'research_assist',
                reason: `Low confidence (${result.confidence}) — requesting research cluster assistance`,
            };
        }

        // Rule 3: If confidence below threshold but above 0.5 → retry with different strategy
        if (result.confidence < this.confidenceThreshold && !result.success) {
            return {
                shouldRetry: this.state.attempts < this.maxRetries + 1,
                shouldEscalate: false,
                action: 'retry',
                reason: `Confidence ${result.confidence} below threshold ${this.confidenceThreshold} — retrying`,
            };
        }

        // Rule 4: Success
        if (result.success) {
            return {
                shouldRetry: false,
                shouldEscalate: false,
                action: 'accept',
                reason: 'Task completed successfully',
            };
        }

        // Rule 5: Failed but can retry
        if (this.state.failureCount < this.maxRetries) {
            return {
                shouldRetry: true,
                shouldEscalate: false,
                action: 'retry',
                reason: `Attempt ${this.state.attempts} failed — retrying`,
            };
        }

        return {
            shouldRetry: false,
            shouldEscalate: true,
            action: 'escalate',
            reason: 'All strategies exhausted',
        };
    }

    /**
     * Detect if this agent's output conflicts with peer outputs.
     * @param {any} myOutput
     * @param {any[]} peerOutputs
     * @returns {{ hasConflict: boolean, conflictScore: number }}
     */
    detectConflict(myOutput, peerOutputs) {
        if (!peerOutputs || peerOutputs.length === 0) {
            return { hasConflict: false, conflictScore: 0 };
        }

        const myText = String(myOutput || '').toLowerCase();
        const myWords = new Set(myText.split(/\s+/).filter(w => w.length > 3));

        let totalSimilarity = 0;

        for (const peer of peerOutputs) {
            const peerText = String(peer || '').toLowerCase();
            const peerWords = new Set(peerText.split(/\s+/).filter(w => w.length > 3));

            if (myWords.size === 0 || peerWords.size === 0) continue;

            let overlap = 0;
            for (const w of myWords) {
                if (peerWords.has(w)) overlap++;
            }
            totalSimilarity += overlap / Math.max(myWords.size, peerWords.size);
        }

        const avgSimilarity = totalSimilarity / peerOutputs.length;

        // Low similarity = potential conflict
        const hasConflict = avgSimilarity < 0.2 && peerOutputs.length > 0;

        return {
            hasConflict,
            conflictScore: 1 - avgSimilarity,
        };
    }

    /**
     * Get the next strategy to try on retry.
     */
    _nextStrategy() {
        for (const s of STRATEGIES) {
            if (!this.state.strategies.includes(s)) {
                return s;
            }
        }
        // All strategies tried — circle back to direct
        return 'direct';
    }

    /**
     * Reset autonomy state (for reuse).
     */
    reset() {
        this.state = {
            attempts: 0,
            failureCount: 0,
            lastConfidence: 1.0,
            strategy: 'direct',
            escalated: false,
            strategies: [],
        };
    }

    /**
     * Get current autonomy state snapshot.
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Get autonomy summary for debugging.
     */
    getSummary() {
        return {
            agentId: this.agentId,
            autonomyLevel: this.autonomyLevel,
            maxRetries: this.maxRetries,
            confidenceThreshold: this.confidenceThreshold,
            state: this.getState(),
        };
    }
}
