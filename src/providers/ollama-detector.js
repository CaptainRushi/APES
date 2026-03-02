/**
 * Ollama Detector
 *
 * Auto-detects a running Ollama instance, lists installed models,
 * and runs performance benchmarks.
 *
 * Used by:
 *   - ProviderRegistry  → auto-register at startup
 *   - ProviderCommand   → model picker during /provider add
 *   - /provider test    → rich benchmark output
 */

const BENCH_TOKENS = 64;

export class OllamaDetector {
    /** @param {string} baseUrl  e.g. http://localhost:11434 */
    constructor(baseUrl = 'http://localhost:11434') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    // ─── Detection ───────────────────────────────────────────────────────────

    /** Returns true if Ollama responds at baseUrl within timeoutMs. */
    async isRunning(timeoutMs = 3000) {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(timeoutMs),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Fetch installed model metadata from /api/tags.
     * Returns [] on any error.
     *
     * @param {number} [timeoutMs]
     * @returns {Promise<Array<{name:string,size:number,family:string,params:string,digest:string}>>}
     */
    async listModels(timeoutMs = 5000) {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) return [];
            const json = await res.json();
            return (json.models ?? []).map(m => ({
                name:   m.name   ?? '',
                size:   m.size   ?? 0,
                digest: (m.digest ?? '').slice(0, 12),
                family: m.details?.family         ?? '',
                params: m.details?.parameter_size ?? '',
            }));
        } catch {
            return [];
        }
    }

    /**
     * Convenience: check running + list models in one call.
     * @returns {Promise<{running:boolean, models:Array}>}
     */
    async detectFull(timeoutMs = 4000) {
        const running = await this.isRunning(timeoutMs);
        if (!running) return { running: false, models: [] };
        const models  = await this.listModels(timeoutMs);
        return { running: true, models };
    }

    // ─── Benchmark ───────────────────────────────────────────────────────────

    /**
     * Benchmark a model using /api/chat (non-streaming).
     * Ollama returns precise nanosecond timing metadata we use for tokens/sec.
     *
     * @param {string} model
     * @param {string} [prompt]
     * @param {number} [timeoutMs]
     * @returns {Promise<BenchResult|null>}
     *
     * @typedef {{ latencyMs:number, tokensPerSec:number, evalCount:number,
     *             loadDurationMs:number, totalDurationMs:number, content:string }} BenchResult
     */
    async benchmark(model, prompt = 'Write a function that checks if a number is prime. Be concise.', timeoutMs = 45000) {
        const body = {
            model,
            messages: [
                { role: 'system', content: 'You are a helpful assistant. Be concise.' },
                { role: 'user',   content: prompt },
            ],
            stream:  false,
            options: { num_predict: BENCH_TOKENS, temperature: 0 },
        };

        const t0 = Date.now();
        try {
            const res = await fetch(`${this.baseUrl}/api/chat`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
                signal:  AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) return null;

            const json = await res.json();
            const wallMs       = Date.now() - t0;
            const evalCount    = json.eval_count    ?? 0;
            const evalDurNs    = json.eval_duration ?? 1;   // nanoseconds
            const tokensPerSec = evalCount > 0
                ? Math.round(evalCount / (evalDurNs / 1e9))
                : 0;

            return {
                latencyMs:       wallMs,
                tokensPerSec,
                evalCount,
                loadDurationMs:  Math.round((json.load_duration  ?? 0) / 1e6),
                totalDurationMs: Math.round((json.total_duration ?? 0) / 1e6),
                content:         json.message?.content ?? '',
            };
        } catch {
            return null;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Format bytes to human-readable string.
     * @param {number} bytes
     * @returns {string}
     */
    static formatSize(bytes) {
        if (!bytes) return '';
        const gb = bytes / 1e9;
        return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / 1e6).toFixed(0)}MB`;
    }
}
