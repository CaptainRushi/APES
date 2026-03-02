/**
 * Google Gemini Provider
 *
 * Adapter for the Google Generative Language API (Gemini).
 * Env: GEMINI_API_KEY
 * Models: gemini-1.5-flash (default), gemini-1.5-pro, gemini-2.0-flash-exp
 */

import { BaseProvider } from './base-provider.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiProvider extends BaseProvider {
    constructor(config = {}) {
        super({
            name:             'gemini',
            model:            config.model            ?? 'gemini-1.5-flash',
            supportsStreaming: false,
            maxTokens:        config.maxTokens        ?? 8192,
            costPer1kTokens:  config.costPer1kTokens  ?? 0.000075,
            averageLatency:   config.averageLatency   ?? 2500,
            timeout:          config.timeout          ?? 120000,
        });
        this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY;
    }

    async generate(input) {
        const { systemPrompt, userMessage, maxTokens = 1024, temperature = 0.7 } = input;

        const body = {
            contents: [
                {
                    parts: [{ text: userMessage }],
                },
            ],
            systemInstruction: {
                parts: [{ text: systemPrompt }],
            },
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature,
            },
        };

        const url = `${BASE_URL}/${this.model}:generateContent?key=${this.apiKey}`;

        const t0  = Date.now();
        const res = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(this.timeout),
        });

        if (!res.ok) {
            const err = new Error(`Gemini ${res.status}: ${await res.text()}`);
            err.status = res.status;
            throw err;
        }

        const json    = await res.json();
        const latency = Date.now() - t0;

        const candidate = json.candidates?.[0];
        const content   = candidate?.content?.parts?.[0]?.text ?? '';
        const usage     = json.usageMetadata ?? {};

        const promptTokens     = usage.promptTokenCount     ?? BaseProvider.estimateTokens(systemPrompt + userMessage);
        const completionTokens = usage.candidatesTokenCount ?? BaseProvider.estimateTokens(content);
        const totalTokens      = usage.totalTokenCount       ?? promptTokens + completionTokens;
        const cost             = BaseProvider.estimateCost(totalTokens, this.costPer1kTokens);

        return {
            content,
            model:    this.model,
            provider: this.name,
            promptTokens,
            completionTokens,
            totalTokens,
            latency,
            cost,
        };
    }

    async healthCheck() {
        try {
            const url = `${BASE_URL}?key=${this.apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            return res.ok;
        } catch {
            return false;
        }
    }
}
