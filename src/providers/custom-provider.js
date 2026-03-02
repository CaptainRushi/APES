/**
 * Custom Provider
 *
 * Generic adapter for any OpenAI-compatible API endpoint.
 * Supports private deployments, enterprise gateways, and open-source servers:
 *   LM Studio, LocalAI, vLLM, Ollama OpenAI-compat, Together AI, etc.
 *
 * Requires: baseURL pointing to an OpenAI-compatible /chat/completions endpoint.
 */

import { BaseProvider } from './base-provider.js';

export class CustomProvider extends BaseProvider {
    /**
     * @param {object} config
     * @param {string}  config.name
     * @param {string}  config.baseURL      e.g. https://api.mycompany.ai/v1
     * @param {string}  [config.apiKey]     optional — some local servers need no auth
     * @param {string}  config.model
     * @param {number}  [config.maxTokens]
     * @param {number}  [config.costPer1kTokens]
     * @param {number}  [config.timeout]
     */
    constructor(config) {
        super({
            name:             config.name ?? 'custom',
            model:            config.model,
            supportsStreaming: true,
            maxTokens:        config.maxTokens        ?? 4096,
            costPer1kTokens:  config.costPer1kTokens  ?? 0,
            averageLatency:   config.averageLatency   ?? 3000,
            timeout:          config.timeout          ?? 30_000,
        });
        this.baseURL = (config.baseURL ?? '').replace(/\/$/, '');
        this.apiKey  = config.apiKey ?? '';
    }

    async generate(input) {
        const { systemPrompt, userMessage, maxTokens = 1024, temperature = 0.7 } = input;

        const body = {
            model:       this.model,
            messages:    [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userMessage  },
            ],
            max_tokens:  maxTokens,
            temperature,
        };

        const t0  = Date.now();
        const res = await this._post(`${this.baseURL}/chat/completions`, body);

        if (!res.ok) {
            const err = new Error(`${this.name} ${res.status}: ${await res.text()}`);
            err.status = res.status;
            throw err;
        }

        const json             = await res.json();
        const latency          = Date.now() - t0;
        const content          = json.choices?.[0]?.message?.content ?? '';
        const usage            = json.usage ?? {};
        const promptTokens     = usage.prompt_tokens     ?? BaseProvider.estimateTokens(systemPrompt + userMessage);
        const completionTokens = usage.completion_tokens ?? BaseProvider.estimateTokens(content);
        const totalTokens      = usage.total_tokens       ?? promptTokens + completionTokens;
        const cost             = BaseProvider.estimateCost(totalTokens, this.costPer1kTokens);

        return {
            content,
            model:    json.model ?? this.model,
            provider: this.name,
            promptTokens,
            completionTokens,
            totalTokens,
            latency,
            cost,
        };
    }

    async* stream(input) {
        const { systemPrompt, userMessage, maxTokens = 1024, temperature = 0.7 } = input;

        const body = {
            model:       this.model,
            messages:    [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userMessage  },
            ],
            max_tokens:  maxTokens,
            temperature,
            stream:      true,
        };

        const res = await this._post(`${this.baseURL}/chat/completions`, body);

        if (!res.ok) {
            const err = new Error(`${this.name} stream ${res.status}: ${await res.text()}`);
            err.status = res.status;
            throw err;
        }

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') return;
                try {
                    const json  = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta) yield delta;
                } catch { /* skip malformed chunk */ }
            }
        }
    }

    async healthCheck() {
        try {
            const res = await fetch(`${this.baseURL}/models`, {
                headers: this._headers(),
                signal:  AbortSignal.timeout(5000),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    _post(url, body) {
        return fetch(url, {
            method:  'POST',
            headers: this._headers(),
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(this.timeout),
        });
    }

    _headers() {
        const h = { 'Content-Type': 'application/json' };
        if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
        return h;
    }
}
