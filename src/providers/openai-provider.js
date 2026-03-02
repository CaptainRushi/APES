/**
 * OpenAI Provider
 *
 * Adapter for the OpenAI Chat Completions API.
 * Env: OPENAI_API_KEY
 * Models: gpt-4o-mini (default), gpt-4o, gpt-4-turbo, etc.
 */

import { BaseProvider } from './base-provider.js';

const BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider extends BaseProvider {
    constructor(config = {}) {
        super({
            name:             'openai',
            model:            config.model            ?? 'gpt-4o-mini',
            supportsStreaming: true,
            maxTokens:        config.maxTokens        ?? 16384,
            costPer1kTokens:  config.costPer1kTokens  ?? 0.00015,
            averageLatency:   config.averageLatency   ?? 1800,
            timeout:          config.timeout          ?? 120000,
        });
        this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
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
            const err = new Error(`OpenAI ${res.status}: ${await res.text()}`);
            err.status = res.status;
            throw err;
        }

        const json            = await res.json();
        const latency         = Date.now() - t0;
        const choice          = json.choices?.[0];
        const content         = choice?.message?.content ?? '';
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
            const err = new Error(`OpenAI stream ${res.status}: ${await res.text()}`);
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
                } catch { /* malformed chunk, skip */ }
            }
        }
    }

    async healthCheck() {
        try {
            const res = await this._fetch(`${BASE_URL}/models`, null, 'GET');
            return res.ok;
        } catch {
            return false;
        }
    }

    _fetch(url, body, method = 'POST') {
        const init = {
            method,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type':  'application/json',
            },
            signal: AbortSignal.timeout(this.timeout),
        };
        if (body !== null) init.body = JSON.stringify(body);
        return fetch(url, init);
    }
}
