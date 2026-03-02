/**
 * Provider Router
 *
 * Intelligent provider selection using a weighted scoring algorithm:
 *
 *   score = (taskMatch × 0.30) + (successRate × 0.20)
 *         + (latencyScore × 0.15) + (costScore × 0.15)
 *         + (tokenFit × 0.10) + (loadScore × 0.10)
 *
 * Features:
 *   - Task-cluster specialization routing
 *   - Local-first routing for cost-sensitive/offline tasks
 *   - Hybrid mode: Ollama draft → cloud refinement for complex tasks
 *   - Per-task parallel local-agent cap (maxParallelLocalAgents)
 *   - Failover with configurable retries
 *   - Cost-optimization mode
 *   - Consensus mode for complex tasks (top-N providers, best response wins)
 *   - Automatic skip on 401 (bad key) and 429 (rate limit)
 */

import { BaseProvider } from './base-provider.js';

const MAX_LATENCY_REF  = 10000; // ms — anything above this scores 0
const MAX_COST_REF     = 0.05;  // USD/1k tokens — anything above scores 0

export class ProviderRouter {
    /**
     * @param {Map<string, import('./base-provider.js').BaseProvider>} providers
     * @param {import('./provider-stats.js').ProviderStats} stats
     * @param {object} config
     */
    constructor(providers, stats, config) {
        this.providers = providers;
        this.stats     = stats;
        this.config    = config;
    }

    // ─── Public ──────────────────────────────────────────────────────────────

    /**
     * Route a task to the best available provider.
     * Applies failover, hybrid mode, and local-parallel cap automatically.
     *
     * @param {{ systemPrompt: string, userMessage: string, maxTokens?: number, temperature?: number }} input
     * @param {{ cluster?: string, description?: string }} task
     * @param {string} [complexityLevel]  'simple' | 'medium' | 'complex'
     * @returns {Promise<import('./base-provider.js').LLMOutput>}
     */
    async route(input, task, complexityLevel = 'medium') {
        const candidates = this._rankProviders(task, input);

        if (candidates.length === 0) {
            throw new Error('No available providers');
        }

        // Hybrid mode: Ollama draft → cloud refinement for complex tasks
        if (
            this.config.hybridMode &&
            complexityLevel === 'complex' &&
            this._hasLocalProvider(candidates) &&
            this._hasCloudProvider(candidates) &&
            this._isHybridCluster(task.cluster)
        ) {
            return this._runHybrid(input, task, candidates);
        }

        // Consensus mode: run top-N providers for complex tasks and pick best response
        if (
            this.config.consensusMode &&
            complexityLevel === 'complex' &&
            candidates.length >= 2
        ) {
            return this._runConsensus(input, candidates.slice(0, this.config.maxConsensusProviders ?? 2));
        }

        return this._runWithFailover(input, candidates);
    }

    // ─── Scoring ─────────────────────────────────────────────────────────────

    /**
     * Score and sort all non-degraded providers for a given task.
     * @returns {Array<import('./base-provider.js').BaseProvider>}
     */
    _rankProviders(task, input) {
        const maxLocal = this.config.maxParallelLocalAgents ?? 2;

        const available = [...this.providers.values()].filter(p =>
            p.enabled && !this.stats.isDegraded(p.name)
        );

        if (available.length === 0) return [];

        const specialization  = this.config.clusterSpecialization?.[task.cluster] ?? [];
        const estimatedTokens = BaseProvider.estimateTokens(
            (input.systemPrompt ?? '') + (input.userMessage ?? '')
        );

        // Total active local requests across all local providers
        const activeLocalRequests = this._totalActiveLocalRequests();

        const scored = available.map(provider => {
            const s = this.stats.getScore(provider.name);
            return {
                provider,
                score: this._computeScore(
                    provider, s, specialization, estimatedTokens,
                    activeLocalRequests, maxLocal
                ),
            };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.provider);
    }

    _computeScore(provider, stats, specialization, estimatedTokens, activeLocalRequests, maxLocal) {
        // 1. Task cluster match (0.30)
        const taskMatch = specialization.includes(provider.name) ? 1.0 : 0.4;

        // 2. Historical success rate (0.20)
        const successRate = stats.successRate;

        // 3. Latency score — lower latency is better (0.15)
        const latencyScore = 1 - Math.min(stats.avgLatency, MAX_LATENCY_REF) / MAX_LATENCY_REF;

        // 4. Cost score — cheaper is better, local = free (0.15)
        const costScore = 1 - Math.min(provider.costPer1kTokens, MAX_COST_REF) / MAX_COST_REF;

        // 5. Token fit — does the provider handle the expected size? (0.10)
        const tokenFit = provider.maxTokens >= estimatedTokens ? 1.0 : 0.0;

        // 6. Load score — fewer active requests is better (0.10)
        //    For local providers: apply extra penalty when at/above maxParallelLocalAgents
        let loadScore;
        if (provider.isLocal) {
            const localLoad = activeLocalRequests / Math.max(maxLocal, 1);
            loadScore = localLoad >= 1.0 ? 0.0 : 1 - localLoad;
        } else {
            loadScore = 1 - Math.min(stats.activeRequests / 10, 1.0);
        }

        return (taskMatch    * 0.30) +
               (successRate  * 0.20) +
               (latencyScore * 0.15) +
               (costScore    * 0.15) +
               (tokenFit     * 0.10) +
               (loadScore    * 0.10);
    }

    // ─── Execution ───────────────────────────────────────────────────────────

    /**
     * Try providers in order, applying per-provider retry logic.
     */
    async _runWithFailover(input, candidates) {
        const maxRetries  = this.config.degradation?.maxRetries ?? 1;
        const cooldownMs  = this.config.degradation?.cooldownMs ?? 300_000;
        let   lastError   = null;

        for (const provider of candidates) {
            let attempt = 0;

            while (attempt <= maxRetries) {
                this.stats.recordRequest(provider.name);
                const t0 = Date.now();

                try {
                    const result  = await provider.generate(input);
                    const latency = Date.now() - t0;
                    this.stats.recordSuccess(provider.name, latency, result.cost ?? 0);
                    return result;

                } catch (err) {
                    lastError = err;
                    const status = err.status ?? err.statusCode ?? 0;

                    if (status === 401) {
                        // Bad API key — disable permanently, skip immediately
                        this.stats.recordFailure(provider.name, err, 0, true);
                        console.error(`[Router] ${provider.name} disabled: invalid API key`);
                        break;
                    }

                    if (status === 429) {
                        // Rate limit — degrade and skip immediately (no retry)
                        this.stats.recordFailure(provider.name, err, cooldownMs);
                        break;
                    }

                    attempt++;
                    if (attempt > maxRetries) {
                        this.stats.recordFailure(provider.name, err, cooldownMs);
                    } else {
                        await this._sleep(300 * attempt);
                    }
                }
            }
        }

        const names = candidates.map(p => p.name).join(', ');
        throw new Error(`All providers failed [${names}]. Last: ${lastError?.message ?? 'unknown'}`);
    }

    /**
     * Hybrid mode: run local provider for an initial draft,
     * then ask the best cloud provider to refine it.
     *
     * This cuts cloud costs significantly for complex tasks:
     *   - Local = free draft (fast for simple reasoning)
     *   - Cloud = targeted refinement (focused, shorter prompt)
     */
    async _runHybrid(input, task, candidates) {
        const local  = candidates.find(p => p.isLocal);
        const clouds = candidates.filter(p => !p.isLocal);

        // Phase 1: Ollama draft
        let draft = '';
        try {
            this.stats.recordRequest(local.name);
            const t0       = Date.now();
            const draftRes = await local.generate({ ...input, maxTokens: 512 });
            this.stats.recordSuccess(local.name, Date.now() - t0, 0);
            draft = draftRes.content ?? '';
        } catch (err) {
            this.stats.recordFailure(local.name, err, this.config.degradation?.cooldownMs ?? 300_000);
            // Draft failed → fall back to normal routing with cloud only
            return this._runWithFailover(input, clouds.length > 0 ? clouds : candidates);
        }

        if (!draft || clouds.length === 0) {
            // No cloud providers or no draft → return draft as final result
            return {
                content:   draft,
                model:     local.model,
                provider:  local.name,
                promptTokens: 0, completionTokens: 0, totalTokens: 0,
                latency: 0, cost: 0,
            };
        }

        // Phase 2: Cloud refinement
        const refinePrompt = [
            `Below is an initial draft response to the task. Review it and provide an improved, final answer.`,
            ``,
            `Task: ${input.userMessage}`,
            ``,
            `Draft:`,
            draft,
            ``,
            `Provide your refined response in the same format requested.`,
        ].join('\n');

        const refineInput = { ...input, userMessage: refinePrompt, maxTokens: input.maxTokens ?? 1024 };

        try {
            const result = await this._runWithFailover(refineInput, clouds);
            // Tag the result to show it went through hybrid mode
            result.hybridDraft    = draft;
            result.hybridProvider = local.name;
            return result;
        } catch {
            // Cloud refinement failed → return local draft
            return {
                content:  draft,
                model:    local.model,
                provider: local.name,
                promptTokens: 0, completionTokens: 0, totalTokens: 0,
                latency: 0, cost: 0,
            };
        }
    }

    /**
     * Consensus mode: run multiple providers in parallel, pick the best response.
     * "Best" = longest content (most comprehensive) among non-failed results.
     */
    async _runConsensus(input, candidates) {
        const results = await Promise.allSettled(
            candidates.map(async provider => {
                this.stats.recordRequest(provider.name);
                const t0 = Date.now();
                try {
                    const result = await provider.generate(input);
                    this.stats.recordSuccess(provider.name, Date.now() - t0, result.cost ?? 0);
                    return result;
                } catch (err) {
                    this.stats.recordFailure(provider.name, err, this.config.degradation?.cooldownMs ?? 300_000);
                    throw err;
                }
            })
        );

        const successful = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        if (successful.length === 0) {
            throw new Error('Consensus: all providers failed');
        }

        return successful.reduce((best, curr) =>
            (curr.content?.length ?? 0) > (best.content?.length ?? 0) ? curr : best
        );
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    _hasLocalProvider(candidates) {
        return candidates.some(p => p.isLocal);
    }

    _hasCloudProvider(candidates) {
        return candidates.some(p => !p.isLocal);
    }

    _isHybridCluster(cluster) {
        const hybridClusters = this.config.hybridClusters ?? [];
        return !cluster || hybridClusters.includes(cluster);
    }

    /** Sum active requests across all local providers. */
    _totalActiveLocalRequests() {
        let total = 0;
        for (const [name] of this.providers) {
            const p = this.providers.get(name);
            if (!p?.isLocal) continue;
            total += this.stats.getScore(name).activeRequests;
        }
        return total;
    }

    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}
