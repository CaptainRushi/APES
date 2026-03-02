/**
 * Provider Stats
 *
 * Tracks per-provider runtime metrics:
 *   - Request counts (total, success, failure)
 *   - Latency and cost accumulation
 *   - Active request load
 *   - Degradation state with cooldown timer
 *   - Rolling history for adaptive scoring
 */

const HISTORY_LIMIT = 50; // rolling window for success rate calc

export class ProviderStats {
    constructor() {
        /** @type {Map<string, ProviderRecord>} */
        this._data = new Map();
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    /** Ensure a provider record exists. */
    _ensure(name) {
        if (!this._data.has(name)) {
            this._data.set(name, {
                totalRequests:    0,
                successCount:     0,
                failureCount:     0,
                totalLatencyMs:   0,
                totalCostUSD:     0,
                activeRequests:   0,
                degraded:         false,
                degradedUntil:    null,
                disabledPermanent: false,
                history:          [],   // boolean[], true = success
            });
        }
        return this._data.get(name);
    }

    // ─── Recording ───────────────────────────────────────────────────────────

    /** Call when a request is about to be sent (increments active count). */
    recordRequest(name) {
        const d = this._ensure(name);
        d.totalRequests++;
        d.activeRequests++;
    }

    /** Call when a request succeeds. */
    recordSuccess(name, latencyMs, costUSD = 0) {
        const d = this._ensure(name);
        d.activeRequests   = Math.max(0, d.activeRequests - 1);
        d.successCount++;
        d.totalLatencyMs  += latencyMs;
        d.totalCostUSD    += costUSD;

        d.history.push(true);
        if (d.history.length > HISTORY_LIMIT) d.history.shift();

        // Auto-recover from degradation if recent requests succeed
        if (d.degraded && this._recentSuccessRate(d) >= 0.8) {
            d.degraded      = false;
            d.degradedUntil = null;
        }
    }

    /**
     * Call when a request fails.
     * @param {string} name
     * @param {Error|null} error
     * @param {number} cooldownMs  - how long to degrade (0 = no degradation)
     * @param {boolean} permanent  - disable provider entirely (e.g. invalid key)
     */
    recordFailure(name, error = null, cooldownMs = 0, permanent = false) {
        const d = this._ensure(name);
        d.activeRequests = Math.max(0, d.activeRequests - 1);
        d.failureCount++;

        d.history.push(false);
        if (d.history.length > HISTORY_LIMIT) d.history.shift();

        if (permanent) {
            d.disabledPermanent = true;
            d.degraded          = true;
            d.degradedUntil     = Infinity;
        } else if (cooldownMs > 0) {
            d.degraded      = true;
            d.degradedUntil = Date.now() + cooldownMs;
        }

        if (process.env.DEBUG) {
            console.error(`[ProviderStats] ${name} failure:`, error?.message ?? error);
        }
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    /** Returns true if this provider should not receive requests. */
    isDegraded(name) {
        const d = this._data.get(name);
        if (!d) return false;
        if (d.disabledPermanent) return true;
        if (!d.degraded) return false;

        // Auto-recover after cooldown
        if (d.degradedUntil !== Infinity && Date.now() >= d.degradedUntil) {
            d.degraded      = false;
            d.degradedUntil = null;
            return false;
        }
        return true;
    }

    /**
     * Returns scoring inputs for the router.
     * @param {string} name
     * @returns {{ successRate: number, avgLatency: number, activeRequests: number, totalCost: number }}
     */
    getScore(name) {
        const d = this._data.get(name);
        if (!d || d.totalRequests === 0) {
            return { successRate: 1.0, avgLatency: 1500, activeRequests: 0, totalCost: 0 };
        }
        return {
            successRate:    this._recentSuccessRate(d),
            avgLatency:     d.totalRequests > 0 ? d.totalLatencyMs / d.totalRequests : 1500,
            activeRequests: d.activeRequests,
            totalCost:      d.totalCostUSD,
        };
    }

    /**
     * Returns a summary of all providers for the /status command.
     * @returns {Array<object>}
     */
    getSummary() {
        const result = [];
        for (const [name, d] of this._data) {
            result.push({
                name,
                totalRequests: d.totalRequests,
                successRate:   d.totalRequests > 0
                    ? ((d.successCount / d.totalRequests) * 100).toFixed(1) + '%'
                    : 'n/a',
                avgLatencyMs:  d.successCount > 0
                    ? Math.round(d.totalLatencyMs / d.successCount)
                    : 0,
                totalCostUSD:  d.totalCostUSD.toFixed(4),
                degraded:      this.isDegraded(name),
                activeRequests: d.activeRequests,
            });
        }
        return result;
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    _recentSuccessRate(d) {
        if (d.history.length === 0) return 1.0;
        const successes = d.history.filter(Boolean).length;
        return successes / d.history.length;
    }
}
