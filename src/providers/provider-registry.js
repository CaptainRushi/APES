/**
 * Provider Registry
 *
 * Top-level entry point for the external AI provider system.
 *
 * Responsibilities:
 *   - Read providers.config.json + ollama.config.json
 *   - Detect which providers have API keys configured
 *   - Auto-detect Ollama at startup (initialize())
 *   - Instantiate and register available providers
 *   - Register specialized Ollama models per task cluster
 *   - Expose execute() for the worker pool
 *   - Expose getSummary() for /status display
 *
 * Usage:
 *   const registry = new ProviderRegistry(providerManager);
 *   await registry.initialize();   // async auto-detect
 *   if (registry.isReady()) {
 *     const result = await registry.execute(task, agent, context);
 *   }
 *
 * Environment variables:
 *   OPENAI_API_KEY      — enables OpenAI
 *   ANTHROPIC_API_KEY   — enables Anthropic
 *   MISTRAL_API_KEY     — enables Mistral
 *   GEMINI_API_KEY      — enables Gemini
 *   OLLAMA_URL          — enables Ollama at custom URL
 *   APES_ENABLE_LOCAL   — force-enable Ollama auto-detect
 *   APES_DEFAULT_MODEL_*  — override default model per provider
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { MistralProvider } from './mistral-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { LocalProvider } from './local-provider.js';
import { OllamaDetector } from './ollama-detector.js';
import { ProviderStats } from './provider-stats.js';
import { ProviderRouter } from './provider-router.js';
import { BaseProvider } from './base-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ProviderRegistry {
    /**
     * @param {import('./provider-manager.js').ProviderManager|null} providerManager
     *   Optional manager — loads stored/encrypted providers from ~/.apes/providers.json.
     */
    constructor(providerManager = null) {
        this.config = this._loadConfig();
        this.ollamaConfig = this._loadOllamaConfig();
        this.providers = new Map();
        this.stats = new ProviderStats();
        this.router = null;

        // Load stored providers first (lower priority)
        if (providerManager) this._loadFromManager(providerManager);

        // Env-var providers override stored ones with the same name
        this._registerAvailable();
        this._initRouter();
    }

    // ─── Async Initialization ────────────────────────────────────────────────

    /**
     * Async post-constructor init.
     * Runs Ollama auto-detection and registers specialized local models.
     * Must be called after construction for full Ollama support.
     */
    async initialize() {
        if (this.ollamaConfig.autoDetect !== false) {
            await this._autoDetectOllama();
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /** True when at least one real provider is configured. */
    isReady() {
        return this.providers.size > 0;
    }

    /**
     * Get a specific provider by name, or the first available one if no name is given.
     * Useful for direct generation calls bypassing the router.
     * @param {string} [name]
     * @returns {import('./base-provider.js').BaseProvider|null}
     */
    getProvider(name) {
        if (name && this.providers.has(name)) {
            return this.providers.get(name);
        }
        const available = [...this.providers.values()].filter(p => p.enabled);
        return available.length > 0 ? available[0] : null;
    }

    /**
     * Execute a task using the best available provider.
     *
     * @param {{ id: string, description: string, cluster?: string }} task
     * @param {{ role?: string, skills?: string[] }|null} agent
     * @param {{ complexity?: { level: string } }} context
     * @returns {Promise<{ output: string, metadata: object }>}
     */
    async execute(task, agent, context = {}) {
        const complexityLevel = context.complexity?.level ?? 'medium';
        const agentRole = agent?.role;

        // Inject apes.md project context and agent-specific instructions
        const systemPrompt = BaseProvider.buildSystemPrompt(agentRole, {
            projectContext: context.projectContext || '',
            agentInstructions: context.agentInstructions?.[agentRole] || '',
        });

        // Inject project rules, conventions, and matched skills from apes.md/skill.md
        const userMessage = BaseProvider.buildUserMessage(task, agent, complexityLevel, {
            rules: context.apesMdRules || [],
            conventions: context.apesMdConventions || [],
            matchedSkills: context.matchedSkills || [],
        });

        const input = {
            systemPrompt,
            userMessage,
            maxTokens: 1024,
            temperature: 0.7,
        };

        const result = await this.router.route(input, task, complexityLevel);

        // Parse out content — models may return raw text or JSON-wrapped
        const output = BaseProvider.extractOutput(result.content);

        return {
            output,
            metadata: {
                provider: result.provider,
                model: result.model,
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                totalTokens: result.totalTokens,
                latencyMs: result.latency,
                costUSD: result.cost,
                tokensPerSec: result.tokensPerSec ?? null,
                agentId: agent?.id ?? 'unknown',
                taskId: task.id,
                mode: 'provider',
            },
        };
    }

    /**
     * Returns provider stats for the /status command.
     * @returns {Array<object>}
     */
    getSummary() {
        return this.stats.getSummary();
    }

    /**
     * Returns list of registered provider names.
     * @returns {string[]}
     */
    getProviderNames() {
        return [...this.providers.keys()];
    }

    /**
     * Register (or replace) a live provider instance at runtime.
     * Called after /provider add or /provider enable.
     * @param {string} name
     * @param {import('./base-provider.js').BaseProvider} provider
     */
    registerProvider(name, provider) {
        this.providers.set(name, provider);
        this._initRouter();
    }

    /**
     * Remove a provider from the active registry.
     * Called after /provider remove or /provider disable.
     * @param {string} name
     */
    unregisterProvider(name) {
        this.providers.delete(name);
        this._initRouter();
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    _loadConfig() {
        try {
            const configPath = join(__dirname, 'providers.config.json');
            return JSON.parse(readFileSync(configPath, 'utf8'));
        } catch {
            return {};
        }
    }

    _loadOllamaConfig() {
        try {
            const configPath = join(__dirname, 'ollama.config.json');
            return JSON.parse(readFileSync(configPath, 'utf8'));
        } catch {
            return { autoDetect: true, lowResourceMode: true, maxParallelLocalAgents: 2 };
        }
    }

    _registerAvailable() {
        const models = this.config.defaultModels ?? {};
        const costs = this.config.costs ?? {};
        const maxTokens = this.config.maxTokens ?? {};
        const timeouts = this.config.timeouts ?? {};
        const timeout = timeouts.default ?? 120000;

        // ── OpenAI ────────────────────────────────────────────────────────────
        if (process.env.OPENAI_API_KEY) {
            this.providers.set('openai', new OpenAIProvider({
                apiKey: process.env.OPENAI_API_KEY,
                model: process.env.APES_DEFAULT_MODEL_OPENAI ?? models.openai,
                maxTokens: maxTokens.openai,
                costPer1kTokens: costs.openai,
                timeout,
            }));
        }

        // ── Anthropic ─────────────────────────────────────────────────────────
        if (process.env.ANTHROPIC_API_KEY) {
            this.providers.set('anthropic', new AnthropicProvider({
                apiKey: process.env.ANTHROPIC_API_KEY,
                model: process.env.APES_DEFAULT_MODEL_ANTHROPIC ?? models.anthropic,
                maxTokens: maxTokens.anthropic,
                costPer1kTokens: costs.anthropic,
                timeout,
            }));
        }

        // ── Mistral ───────────────────────────────────────────────────────────
        if (process.env.MISTRAL_API_KEY) {
            this.providers.set('mistral', new MistralProvider({
                apiKey: process.env.MISTRAL_API_KEY,
                model: process.env.APES_DEFAULT_MODEL_MISTRAL ?? models.mistral,
                maxTokens: maxTokens.mistral,
                costPer1kTokens: costs.mistral,
                timeout,
            }));
        }

        // ── Gemini ────────────────────────────────────────────────────────────
        if (process.env.GEMINI_API_KEY) {
            this.providers.set('gemini', new GeminiProvider({
                apiKey: process.env.GEMINI_API_KEY,
                model: process.env.APES_DEFAULT_MODEL_GEMINI ?? models.gemini,
                maxTokens: maxTokens.gemini,
                costPer1kTokens: costs.gemini,
                timeout,
            }));
        }

        // ── Ollama / Local (explicit env var) ─────────────────────────────────
        if (process.env.OLLAMA_URL || process.env.APES_ENABLE_LOCAL) {
            this.providers.set('local', new LocalProvider({
                baseUrl: process.env.OLLAMA_URL,
                model: process.env.APES_DEFAULT_MODEL_LOCAL ?? models.local,
                maxTokens: maxTokens.local,
                timeout: timeouts.local ?? 300000,
                lowResourceMode: this.ollamaConfig.lowResourceMode,
            }));
        }
    }

    // ─── Ollama Auto-Detection ────────────────────────────────────────────────

    /**
     * Try to detect a locally-running Ollama instance.
     * If found: register primary `local` provider + specialized models per cluster.
     * Non-throwing — detection failures are silently ignored.
     */
    async _autoDetectOllama() {
        // Skip if already registered via env var
        if (this.providers.has('local')) return;

        const baseUrl = this.ollamaConfig.baseURL ?? 'http://localhost:11434';
        const detector = new OllamaDetector(baseUrl);

        let running, models;
        try {
            ({ running, models } = await detector.detectFull(3000));
        } catch {
            return;
        }

        if (!running || models.length === 0) return;

        const installed = new Set(models.map(m => m.name.split(':')[0]));
        const defaultModel = this._pickDefaultModel(models);
        const lowRes = this.ollamaConfig.lowResourceMode ?? true;
        const maxTok = lowRes
            ? (this.ollamaConfig.maxTokensLowResource ?? 2048)
            : (this.config.maxTokens?.local ?? 4096);

        // ── Primary local provider ────────────────────────────────────────────
        this.providers.set('local', new LocalProvider({
            baseUrl: baseUrl,
            model: defaultModel,
            maxTokens: maxTok,
            timeout: this.ollamaConfig.degradation?.timeoutMs ?? 300000,
            lowResourceMode: lowRes,
        }));

        if (process.env.DEBUG) {
            console.log(`[ProviderRegistry] Auto-detected Ollama: ${defaultModel} (${models.length} models installed)`);
        }

        // ── Specialized models per cluster ────────────────────────────────────
        const spec = this.ollamaConfig.modelSpecialization ?? {};

        // Collect unique specialized models (excluding default)
        const registered = new Set(['local']);
        const defaultBase = defaultModel.split(':')[0];

        for (const [cluster, specModel] of Object.entries(spec)) {
            const modelBase = specModel.split(':')[0];
            if (!installed.has(modelBase)) continue;           // not installed
            if (modelBase === defaultBase) continue;            // same as default
            const provName = `ollama-${modelBase}`;
            if (registered.has(provName)) {
                // Already registered, just update cluster specialization
                this._addToCluster(cluster, provName);
                continue;
            }

            registered.add(provName);
            this.providers.set(provName, new LocalProvider({
                name: provName,
                baseUrl: baseUrl,
                model: specModel,
                maxTokens: maxTok,
                timeout: this.ollamaConfig.degradation?.timeoutMs ?? 300000,
                lowResourceMode: lowRes,
            }));

            // Update in-memory cluster specialization for the router
            this._addToCluster(cluster, provName);

            if (process.env.DEBUG) {
                console.log(`[ProviderRegistry] Registered specialized: ${provName} for cluster "${cluster}"`);
            }
        }

        this._initRouter();
    }

    /** Add providerName to cluster specialization list if not already present. */
    _addToCluster(cluster, providerName) {
        if (!this.config.clusterSpecialization) this.config.clusterSpecialization = {};
        const list = this.config.clusterSpecialization[cluster] ?? [];
        if (!list.includes(providerName)) {
            this.config.clusterSpecialization[cluster] = [...list, providerName];
        }
    }

    /**
     * Pick the best default model from installed list.
     * Prefers models matching ollama.config.json defaultModel, else first installed.
     */
    _pickDefaultModel(models) {
        const prefer = (this.ollamaConfig.defaultModel ?? 'llama3.2').split(':')[0];
        const match = models.find(m => m.name.split(':')[0] === prefer);
        return match ? match.name : models[0].name;
    }

    _loadFromManager(manager) {
        const map = manager.instantiateProviders();
        for (const [name, provider] of map) {
            this.providers.set(name, provider);
        }
    }

    _initRouter() {
        this.router = new ProviderRouter(this.providers, this.stats, this.config);
    }
}
