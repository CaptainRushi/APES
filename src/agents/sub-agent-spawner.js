/**
 * Sub-Agent Spawner — Parallel Agent Orchestration
 *
 * Inspired by Claude Code's Task Tool for spawning sub-agents.
 * This is the KEY differentiator for APES: instead of a single agent,
 * we spawn multiple agents in TRUE parallel, each with:
 *   - Their own AgentLoop (master loop)
 *   - Their own ContextManager (clean context window)
 *   - Their own SteeringQueue (individually controllable)
 *   - A specialized system prompt for their subtask
 *
 * Spawning modes:
 *   1. Fan-out: one task → many parallel sub-agents
 *   2. Pipeline: sequential chain of specialized agents
 *   3. Swarm: all agents work on the same task, best result wins
 *
 * Concurrency is bounded by maxParallel to prevent resource exhaustion.
 */

import { AgentLoop } from './agent-loop.js';
import { SteeringQueue } from './steering-queue.js';

export class SubAgentSpawner {
    /**
     * @param {object} opts
     * @param {object} [opts.provider] — LLM provider instance
     * @param {object} [opts.providerRegistry] — Provider registry for selecting providers
     * @param {object} [opts.workspaceEngine] — Workspace engine for file I/O
     * @param {number} [opts.maxParallel=8] — Max agents running simultaneously
     * @param {number} [opts.maxIterationsPerAgent=20] — Max loop iterations per agent
     * @param {number} [opts.maxTokensPerAgent=8192] — Token budget per agent
     */
    constructor(opts = {}) {
        this.provider = opts.provider || null;
        this.providerRegistry = opts.providerRegistry || null;
        this.workspaceEngine = opts.workspaceEngine || null;
        this.maxParallel = opts.maxParallel ?? 8;
        this.maxIterationsPerAgent = opts.maxIterationsPerAgent ?? 20;
        this.maxTokensPerAgent = opts.maxTokensPerAgent ?? 8192;

        /** @type {Map<string, AgentLoop>} */
        this._activeAgents = new Map();

        /** @type {Array<{ agentId: string, task: string, result: any, duration: number }>} */
        this._completedAgents = [];

        // Event listeners
        this._listeners = new Map();
    }

    // ─── Spawning Modes ──────────────────────────────────────────

    /**
     * Fan-out: Run multiple tasks in parallel, each with their own agent.
     * This is the primary mode for APES.
     *
     * @param {Array<{ task: string, systemPrompt?: string, specialization?: string, context?: object }>} tasks
     * @returns {Promise<Array<{ agentId: string, output: string, iterations: number, duration: number, completed: boolean }>>}
     */
    async fanOut(tasks) {
        this._emit('spawn:fanout', { count: tasks.length });

        // Bound concurrency
        const results = [];
        const batches = this._chunk(tasks, this.maxParallel);

        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
            const batch = batches[batchIdx];
            this._emit('spawn:batch', { batchIndex: batchIdx, size: batch.length, total: batches.length });

            // Run all agents in this batch in parallel
            const batchResults = await Promise.allSettled(
                batch.map((taskDef, idx) => this.spawn({
                    task: taskDef.task,
                    systemPrompt: taskDef.systemPrompt,
                    specialization: taskDef.specialization || `worker-${batchIdx * this.maxParallel + idx}`,
                    initialContext: taskDef.context,
                }))
            );

            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    results.push({
                        agentId: 'unknown',
                        output: `Agent failed: ${result.reason?.message || 'Unknown error'}`,
                        iterations: 0,
                        duration: 0,
                        completed: false,
                        error: result.reason?.message,
                    });
                }
            }
        }

        this._emit('spawn:complete', { total: results.length, successful: results.filter(r => r.completed).length });
        return results;
    }

    /**
     * Pipeline: Run tasks sequentially, each agent's output feeds into the next.
     * @param {Array<{ task: string, systemPrompt?: string, specialization?: string }>} stages
     * @returns {Promise<{ finalOutput: string, stages: object[] }>}
     */
    async pipeline(stages) {
        this._emit('spawn:pipeline', { stages: stages.length });

        let previousOutput = null;
        const stageResults = [];

        for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];
            const context = previousOutput
                ? { previousStageOutput: previousOutput }
                : undefined;

            const result = await this.spawn({
                task: stage.task,
                systemPrompt: stage.systemPrompt,
                specialization: stage.specialization || `stage-${i}`,
                initialContext: context,
            });

            stageResults.push(result);
            previousOutput = result.output;
        }

        return {
            finalOutput: previousOutput,
            stages: stageResults,
        };
    }

    /**
     * Swarm: Multiple agents work on the SAME task.
     * Returns the best result based on a scoring function.
     *
     * @param {string} task
     * @param {number} [count=3] — Number of parallel agents
     * @param {function} [scorer] — Custom scoring function (result) => number
     * @returns {Promise<{ best: object, all: object[] }>}
     */
    async swarm(task, count = 3, scorer = null) {
        this._emit('spawn:swarm', { task, count });

        const tasks = Array.from({ length: count }, (_, i) => ({
            task,
            specialization: `swarm-${i}`,
            systemPrompt: `You are agent ${i + 1} of ${count} working on the same task. Provide your best, most thorough solution.`,
        }));

        const results = await this.fanOut(tasks);

        // Score and pick the best
        const defaultScorer = (r) => {
            let score = 0;
            if (r.completed) score += 10;
            score += Math.min(r.iterations, 5); // More iterations = more thorough (up to a point)
            score += (r.output?.length || 0) / 500; // Longer output = more detailed (rough heuristic)
            return score;
        };

        const scoreFn = scorer || defaultScorer;
        const scored = results.map(r => ({ ...r, score: scoreFn(r) }));
        scored.sort((a, b) => b.score - a.score);

        return {
            best: scored[0],
            all: scored,
        };
    }

    // ─── Single Agent Spawn ──────────────────────────────────────

    /**
     * Spawn a single sub-agent with its own loop.
     *
     * @param {object} opts
     * @param {string} opts.task — The task description
     * @param {string} [opts.systemPrompt] — Custom system prompt
     * @param {string} [opts.specialization] — Agent specialization tag
     * @param {string} [opts.parentAgentId] — Parent agent that spawned this one
     * @param {object} [opts.initialContext] — Context from parent or dependencies
     * @returns {Promise<{ agentId: string, output: string, iterations: number, duration: number, completed: boolean }>}
     */
    async spawn(opts = {}) {
        const agentId = `sub-${opts.specialization || 'agent'}-${Date.now().toString(36)}`;

        // Get provider
        const provider = this._getProvider();

        // Create a fresh AgentLoop for this sub-agent
        const loop = new AgentLoop({
            agentId,
            role: opts.specialization || 'sub-agent',
            provider,
            workspaceEngine: this.workspaceEngine,
            subAgentSpawner: this, // Allow recursive spawning
            maxIterations: this.maxIterationsPerAgent,
            maxTokens: this.maxTokensPerAgent,
        });

        // Forward events
        loop.on('loop:iteration', (data) => this._emit('agent:iteration', data));
        loop.on('tool:call', (data) => this._emit('agent:tool_call', data));
        loop.on('tool:result', (data) => this._emit('agent:tool_result', data));
        loop.on('loop:error', (data) => this._emit('agent:error', data));
        loop.on('context:compacted', (data) => this._emit('agent:compacted', data));

        this._activeAgents.set(agentId, loop);
        this._emit('agent:spawned', { agentId, task: opts.task, specialization: opts.specialization });

        try {
            const result = await loop.run(opts.task, {
                systemPrompt: opts.systemPrompt,
                initialContext: opts.initialContext,
            });

            this._activeAgents.delete(agentId);
            const completionData = {
                agentId,
                task: opts.task,
                result,
                duration: result.duration,
            };
            this._completedAgents.push(completionData);
            this._emit('agent:completed', completionData);

            return {
                agentId,
                output: result.output,
                iterations: result.iterations,
                toolCalls: result.toolCalls,
                duration: result.duration,
                completed: result.completed,
            };
        } catch (error) {
            this._activeAgents.delete(agentId);
            this._emit('agent:failed', { agentId, error: error.message });

            return {
                agentId,
                output: `Error: ${error.message}`,
                iterations: 0,
                toolCalls: [],
                duration: 0,
                completed: false,
                error: error.message,
            };
        }
    }

    // ─── Control ─────────────────────────────────────────────────

    /**
     * Stop all running agents.
     */
    stopAll() {
        for (const [id, loop] of this._activeAgents) {
            loop.stop();
            this._emit('agent:stopped', { agentId: id });
        }
        this._activeAgents.clear();
    }

    /**
     * Steer a specific agent.
     * @param {string} agentId
     * @param {string} direction
     */
    steerAgent(agentId, direction) {
        const loop = this._activeAgents.get(agentId);
        if (loop) {
            loop.steeringQueue.steer(direction);
        }
    }

    /**
     * Get stats for all agents (active + completed).
     */
    getStats() {
        return {
            activeCount: this._activeAgents.size,
            completedCount: this._completedAgents.length,
            maxParallel: this.maxParallel,
            activeAgents: [...this._activeAgents.entries()].map(([id, loop]) => ({
                agentId: id,
                ...loop.getStats(),
            })),
            completedAgents: this._completedAgents.map(a => ({
                agentId: a.agentId,
                task: a.task.slice(0, 80),
                duration: a.duration,
            })),
        };
    }

    // ─── Events ──────────────────────────────────────────────────

    on(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(fn);
    }

    /** @private */
    _emit(event, data) {
        const fns = this._listeners.get(event) || [];
        for (const fn of fns) {
            try { fn(data); } catch { /* swallow */ }
        }
    }

    // ─── Internal ────────────────────────────────────────────────

    /** @private */
    _getProvider() {
        if (this.provider) return this.provider;
        if (this.providerRegistry?.isReady()) {
            return this.providerRegistry.getProvider();
        }
        return null;
    }

    /** @private */
    _chunk(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }
}
