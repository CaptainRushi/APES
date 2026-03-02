/**
 * Anthropic Provider
 *
 * Adapter for the Anthropic Messages API.
 * Env: ANTHROPIC_API_KEY
 * Models: claude-haiku-4-5-20251001 (default), claude-sonnet-4-6, claude-opus-4-6
 */

import { BaseProvider } from './base-provider.js';

const BASE_URL          = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicProvider extends BaseProvider {
    constructor(config = {}) {
        super({
            name:             'anthropic',
            model:            config.model            ?? 'claude-haiku-4-5-20251001',
            supportsStreaming: true,
            maxTokens:        config.maxTokens        ?? 8192,
            costPer1kTokens:  config.costPer1kTokens  ?? 0.00025,
            averageLatency:   config.averageLatency   ?? 1500,
            timeout:          config.timeout          ?? 120000,
        });
        this.apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    }

    async generate(input) {
        const { systemPrompt, userMessage, maxTokens = 1024, temperature = 0.7 } = input;

        const body = {
            model:      this.model,
            max_tokens: maxTokens,
            system:     systemPrompt,
            messages:   [{ role: 'user', content: userMessage }],
            // temperature field not supported in all versions, include carefully
        };

        // Anthropic only accepts temperature 0–1
        if (temperature !== undefined) {
            body.temperature = Math.max(0, Math.min(1, temperature));
        }

        const t0  = Date.now();
        const res = await this._fetch(`${BASE_URL}/messages`, body);

        if (!res.ok) {
            const text = await res.text();
            const err  = new Error(`Anthropic ${res.status}: ${text}`);
            err.status = res.status;
            throw err;
        }

        const json            = await res.json();
        const latency         = Date.now() - t0;
        const content         = json.content?.[0]?.text ?? '';
        const usage           = json.usage ?? {};
        const promptTokens    = usage.input_tokens  ?? 0;
        const completionTokens = usage.output_tokens ?? 0;
        const totalTokens     = promptTokens + completionTokens;
        const cost            = BaseProvider.estimateCost(totalTokens, this.costPer1kTokens);

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
        const { systemPrompt, userMessage, maxTokens = 1024 } = input;

        const body = {
            model:      this.model,
            max_tokens: maxTokens,
            system:     systemPrompt,
            messages:   [{ role: 'user', content: userMessage }],
            stream:     true,
        };

        const res = await this._fetch(`${BASE_URL}/messages`, body);

        if (!res.ok) {
            const err = new Error(`Anthropic stream ${res.status}: ${await res.text()}`);
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

                try {
                    const json = JSON.parse(data);
                    if (json.type === 'content_block_delta' && json.delta?.text) {
                        yield json.delta.text;
                    }
                } catch { /* skip */ }
            }
        }
    }

    async healthCheck() {
        try {
            // Minimal 1-token request to verify connectivity and key
            const res = await this._fetch(`${BASE_URL}/messages`, {
                model:      this.model,
                max_tokens: 1,
                messages:   [{ role: 'user', content: 'ping' }],
            });
            return res.ok || res.status === 400; // 400 = bad request but key is valid
        } catch {
            return false;
        }
    }

    _fetch(url, body) {
        return fetch(url, {
            method:  'POST',
            headers: {
                'x-api-key':         this.apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
                'Content-Type':      'application/json',
            },
            body:   JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeout),
        });
    }
}
