/**
 * Context Manager — Agent Context Window Tracking & Compaction
 *
 * Inspired by Claude Code's context compaction system.
 * Each agent loop tracks its accumulated context (messages, tool results, etc.)
 * and automatically compacts when nearing the token limit.
 *
 * Compaction Strategy:
 *   1. Keep the original system prompt and user objective (always)
 *   2. Keep the last N tool call/result pairs
 *   3. Summarize everything in between into a compact "story so far"
 *   4. If a provider is available, use the LLM to generate the summary
 *   5. Otherwise, use a heuristic truncation approach
 */

export class ContextManager {
    /**
     * @param {object} [opts]
     * @param {number} [opts.maxTokens=8192] — Approximate token budget
     * @param {number} [opts.compactionThreshold=0.85] — Trigger compaction at this % of budget
     * @param {number} [opts.keepRecentMessages=6] — Always keep the last N messages
     */
    constructor(opts = {}) {
        this.maxTokens = opts.maxTokens ?? 8192;
        this.compactionThreshold = opts.compactionThreshold ?? 0.85;
        this.keepRecentMessages = opts.keepRecentMessages ?? 6;

        /** @type {Array<{ role: string, content: string, type?: string, timestamp: number }>} */
        this.messages = [];

        /** @type {string} The original objective — never compacted */
        this.originalObjective = '';

        /** @type {string} The system prompt — never compacted */
        this.systemPrompt = '';

        /** @type {number} Running token estimate */
        this._estimatedTokens = 0;

        /** @type {number} Compaction count */
        this._compactionCount = 0;
    }

    // ─── Message Management ──────────────────────────────────────

    /**
     * Set the initial system prompt (preserved through compaction).
     * @param {string} prompt
     */
    setSystemPrompt(prompt) {
        this.systemPrompt = prompt;
        this._recalculateTokens();
    }

    /**
     * Set the original user objective (preserved through compaction).
     * @param {string} objective
     */
    setObjective(objective) {
        this.originalObjective = objective;
        this._recalculateTokens();
    }

    /**
     * Add a message to the context.
     * @param {'user'|'assistant'|'tool_call'|'tool_result'|'system'|'summary'} role
     * @param {string} content
     * @param {object} [meta] — Optional metadata (tool name, etc.)
     */
    addMessage(role, content, meta = {}) {
        this.messages.push({
            role,
            content,
            type: meta.type || role,
            toolName: meta.toolName || null,
            timestamp: Date.now(),
        });

        this._estimatedTokens += this._estimateTokens(content);
    }

    /**
     * Get the full conversation context for the next LLM call.
     * @returns {{ systemPrompt: string, messages: Array<{ role: string, content: string }> }}
     */
    getContext() {
        return {
            systemPrompt: this.systemPrompt,
            messages: this.messages.map(m => ({
                role: m.role === 'tool_call' || m.role === 'tool_result' ? 'assistant' : m.role,
                content: m.content,
            })),
            estimatedTokens: this._estimatedTokens,
        };
    }

    /**
     * Build a single userMessage string for providers that use flat prompts.
     * @returns {string}
     */
    buildFlatPrompt() {
        const parts = [];

        if (this.originalObjective) {
            parts.push(`OBJECTIVE: ${this.originalObjective}`);
        }

        for (const msg of this.messages) {
            const prefix = msg.role === 'user' ? 'USER'
                : msg.role === 'assistant' ? 'ASSISTANT'
                    : msg.role === 'tool_call' ? 'TOOL_CALL'
                        : msg.role === 'tool_result' ? 'TOOL_RESULT'
                            : msg.role === 'summary' ? 'CONTEXT_SUMMARY'
                                : 'SYSTEM';
            parts.push(`[${prefix}]: ${msg.content}`);
        }

        return parts.join('\n\n');
    }

    // ─── Compaction ──────────────────────────────────────────────

    /**
     * Check if compaction is needed.
     * @returns {boolean}
     */
    needsCompaction() {
        return this._estimatedTokens >= this.maxTokens * this.compactionThreshold;
    }

    /**
     * Perform context compaction.
     * Uses LLM if a provider is available, otherwise uses heuristic truncation.
     * @param {object} [provider] — Optional LLM provider for intelligent summarization
     * @returns {Promise<{ compacted: boolean, tokensBefore: number, tokensAfter: number }>}
     */
    async compact(provider = null) {
        if (!this.needsCompaction()) {
            return { compacted: false, tokensBefore: this._estimatedTokens, tokensAfter: this._estimatedTokens };
        }

        const tokensBefore = this._estimatedTokens;

        // Split messages: keep recent, summarize the rest
        const keepCount = Math.min(this.keepRecentMessages, this.messages.length);
        const toSummarize = this.messages.slice(0, this.messages.length - keepCount);
        const toKeep = this.messages.slice(-keepCount);

        if (toSummarize.length === 0) {
            return { compacted: false, tokensBefore, tokensAfter: tokensBefore };
        }

        let summary;

        if (provider) {
            // LLM-powered summarization
            try {
                summary = await this._llmSummarize(provider, toSummarize);
            } catch {
                summary = this._heuristicSummarize(toSummarize);
            }
        } else {
            summary = this._heuristicSummarize(toSummarize);
        }

        // Replace messages with summary + recent
        this.messages = [
            {
                role: 'summary',
                content: `[Context Compaction #${++this._compactionCount}]\n${summary}`,
                type: 'summary',
                timestamp: Date.now(),
            },
            ...toKeep,
        ];

        this._recalculateTokens();

        return {
            compacted: true,
            tokensBefore,
            tokensAfter: this._estimatedTokens,
            compactionNumber: this._compactionCount,
        };
    }

    // ─── Stats ───────────────────────────────────────────────────

    /**
     * Get context statistics.
     */
    getStats() {
        return {
            messageCount: this.messages.length,
            estimatedTokens: this._estimatedTokens,
            maxTokens: this.maxTokens,
            utilization: (this._estimatedTokens / this.maxTokens * 100).toFixed(1) + '%',
            compactionCount: this._compactionCount,
            hasObjective: !!this.originalObjective,
        };
    }

    // ─── Internal ────────────────────────────────────────────────

    /** @private */
    async _llmSummarize(provider, messages) {
        const conversation = messages.map(m => `[${m.role}]: ${m.content}`).join('\n');

        const response = await provider.generate({
            systemPrompt: 'You are a context compression assistant. Summarize the following conversation while preserving all key facts, decisions, tool results, and progress. Be concise but complete. Output only the summary.',
            userMessage: `Original objective: ${this.originalObjective}\n\nConversation to summarize:\n${conversation}`,
            maxTokens: 500,
            temperature: 0.3,
        });

        return response.content;
    }

    /** @private */
    _heuristicSummarize(messages) {
        const parts = [];
        parts.push(`Summarized ${messages.length} messages:`);

        // Keep only the first line of each message
        for (const msg of messages) {
            const firstLine = msg.content.split('\n')[0].slice(0, 120);
            parts.push(`- [${msg.role}] ${firstLine}`);
        }

        return parts.join('\n');
    }

    /** @private */
    _estimateTokens(text) {
        // Rough estimate: ~4 chars per token
        return Math.ceil((text || '').length / 4);
    }

    /** @private */
    _recalculateTokens() {
        let total = this._estimateTokens(this.systemPrompt);
        total += this._estimateTokens(this.originalObjective);
        for (const msg of this.messages) {
            total += this._estimateTokens(msg.content);
        }
        this._estimatedTokens = total;
    }
}
