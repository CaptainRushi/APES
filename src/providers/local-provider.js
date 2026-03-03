/**
 * Local Provider (Ollama)
 *
 * Adapter for locally-running LLMs via Ollama.
 * Env: OLLAMA_URL (default: http://localhost:11434)
 * Models: llama3.2 (default), mistral, codellama, phi3, gemma2, etc.
 *
 * Start Ollama: https://ollama.ai
 * Pull a model: ollama pull llama3.2
 */

import { BaseProvider } from './base-provider.js';

export class LocalProvider extends BaseProvider {
    /**
     * @param {object} [config]
     * @param {string} [config.name]           Provider name (default: 'local')
     * @param {string} [config.model]          Ollama model name
     * @param {string} [config.baseUrl]        Ollama base URL
     * @param {number} [config.maxTokens]
     * @param {number} [config.timeout]
     * @param {boolean} [config.lowResourceMode]  Reduce context/tokens on low-end hardware
     */
    constructor(config = {}) {
        const lowRes = config.lowResourceMode ?? false;
        const maxTokens = config.maxTokens ?? (lowRes ? 2048 : 4096);

        super({
            name: config.name ?? 'local',
            model: config.model ?? process.env.OLLAMA_MODEL ?? 'llama3.2',
            supportsStreaming: true,
            maxTokens,
            costPer1kTokens: 0,   // free — local inference
            averageLatency: config.averageLatency ?? 5000,
            timeout: config.timeout ?? 180000, // local models need 3 min for large code generation
        });

        this.baseUrl = (config.baseUrl ?? process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '');
        this.lowResourceMode = lowRes;

        /** Marks this as a local provider for the router's parallel-cap logic. */
        this.isLocal = true;
    }

    // ─── Core API ────────────────────────────────────────────────────────────

    async generate(input) {
        const { systemPrompt, userMessage, maxTokens = 1024, temperature = 0.7, responseFormat } = input;
        const effectiveTokens = this.lowResourceMode
            ? Math.min(maxTokens, 1024)
            : maxTokens;

        const body = {
            model: this.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            stream: false,
            options: {
                num_predict: effectiveTokens,
                temperature,
            },
        };

        const t0 = Date.now();
        const res = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeout),
        });

        if (!res.ok) {
            const err = new Error(`Ollama ${res.status}: ${await res.text()}`);
            err.status = res.status;
            throw err;
        }

        const json = await res.json();
        const latency = Date.now() - t0;
        const content = json.message?.content ?? json.response ?? '';

        // Some reasoning/thinking models (e.g. glm-4, deepseek-r1) surface their
        // chain-of-thought in message.thinking rather than message.content.
        // Expose it so callers can detect a live-but-thinking model response.
        const thinking = json.message?.thinking ?? '';

        // Ollama provides precise token counts and timing
        const promptTokens = json.prompt_eval_count ?? BaseProvider.estimateTokens(systemPrompt + userMessage);
        const completionTokens = json.eval_count ?? BaseProvider.estimateTokens(content);
        const totalTokens = promptTokens + completionTokens;

        // Tokens/sec from Ollama's eval_duration (nanoseconds)
        const evalDurNs = json.eval_duration ?? 0;
        const tokensPerSec = evalDurNs > 0 && completionTokens > 0
            ? Math.round(completionTokens / (evalDurNs / 1e9))
            : 0;

        return {
            content,
            thinking,       // chain-of-thought from reasoning models (may be non-empty when content is '')
            model: json.model ?? this.model,
            provider: this.name,
            promptTokens,
            completionTokens,
            totalTokens,
            latency,
            cost: 0,
            tokensPerSec,   // Ollama-specific — exposed for /provider test
        };
    }

    async* stream(input) {
        const { systemPrompt, userMessage, maxTokens = 1024, temperature = 0.7 } = input;
        const effectiveTokens = this.lowResourceMode
            ? Math.min(maxTokens, 512)
            : maxTokens;

        const body = {
            model: this.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            stream: true,
            options: { num_predict: effectiveTokens, temperature },
        };

        const res = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeout),
        });

        if (!res.ok) {
            const err = new Error(`Ollama stream ${res.status}: ${await res.text()}`);
            err.status = res.status;
            throw err;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    const token = json.message?.content ?? json.response ?? '';
                    // Reasoning models (e.g. glm-5, deepseek-r1) emit chain-of-thought in
                    // message.thinking while message.content stays empty until the final
                    // answer. Fall back to thinking so the stream isn't silent.
                    const thinkToken = json.message?.thinking ?? '';
                    if (token) {
                        yield token;
                    } else if (thinkToken) {
                        yield thinkToken;
                    }
                    if (json.done) return;
                } catch { /* skip malformed chunk */ }
            }
        }
    }

    // ─── Health & Discovery ──────────────────────────────────────────────────

    async healthCheck() {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) return false;

            const json = await res.json();
            const models = json.models ?? [];
            // Check if our target model is installed (prefix match for tagged variants)
            return models.some(m => m.name?.startsWith(this.model.split(':')[0]));
        } catch {
            return false;
        }
    }

    /**
     * List all models installed in this Ollama instance.
     * @returns {Promise<Array<{name:string,size:number,family:string,params:string}>>}
     */
    async listModels() {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) return [];
            const json = await res.json();
            return (json.models ?? []).map(m => ({
                name: m.name ?? '',
                size: m.size ?? 0,
                family: m.details?.family ?? '',
                params: m.details?.parameter_size ?? '',
            }));
        } catch {
            return [];
        }
    }
}
