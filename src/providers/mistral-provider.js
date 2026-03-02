/**
 * Mistral Provider
 *
 * Adapter for the Mistral AI Chat API (OpenAI-compatible format).
 * Env: MISTRAL_API_KEY
 * Models: mistral-small-latest (default), mistral-medium-latest, mistral-large-latest
 */

import { BaseProvider } from './base-provider.js';

const BASE_URL = 'https://api.mistral.ai/v1';

export class MistralProvider extends BaseProvider {
    constructor(config = {}) {
        super({
            name:             'mistral',
            model:            config.model            ?? 'mistral-small-latest',
            supportsStreaming: true,
            maxTokens:        config.maxTokens        ?? 8192,
            costPer1kTokens:  config.costPer1kTokens  ?? 0.0001,
            averageLatency:   config.averageLatency   ?? 2200,
            timeout:          config.timeout          ?? 120000,
        });
        this.apiKey = config.apiKey ?? process.env.MISTRAL_API_KEY;
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
        const res = await this._fetch(`${BASE_URL}/chat/completions`, body);

        if (!res.ok) {
            const err = new Error(`Mistral ${res.status}: ${await res.text()}`);
            err.status = res.status;
            throw err;
        }

        const json            = await res.json();
        const latency         = Date.now() - t0;
        const content         = json.choices?.[0]?.message?.content ?? '';
        const usage           = json.usage ?? {};
        const promptTokens    = usage.prompt_tokens     ?? 0;
        const completionTokens = usage.completion_tokens ?? 0;
        const totalTokens     = usage.total_tokens       ?? promptTokens + completionTokens;
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

        const res = await this._fetch(`${BASE_URL}/chat/completions`, body);

        if (!res.ok) {
            const err = new Error(`Mistral stream ${res.status}: ${await res.text()}`);
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
                } catch { /* skip */ }
            }
        }
    }

    async healthCheck() {
        try {
            const res = await fetch(`${BASE_URL}/models`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                signal:  AbortSignal.timeout(5000),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    _fetch(url, body) {
        return fetch(url, {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type':  'application/json',
            },
            body:   JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeout),
        });
    }
}
