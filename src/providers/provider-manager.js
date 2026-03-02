/**
 * Provider Manager
 *
 * Manages user-configured AI providers stored in ~/.apes/providers.json.
 * Handles CRUD operations, routing configuration, and provider instantiation.
 *
 * Provider types:
 *   openai | anthropic | mistral | gemini | local | custom
 *
 * Custom providers are treated as OpenAI-compatible endpoints.
 */

import { SecureStorage }    from './secure-storage.js';
import { OpenAIProvider }    from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { MistralProvider }   from './mistral-provider.js';
import { GeminiProvider }    from './gemini-provider.js';
import { LocalProvider }     from './local-provider.js';
import { CustomProvider }    from './custom-provider.js';

/** Metadata for well-known provider types. */
export const KNOWN_PROVIDERS = {
    openai:    { baseURL: 'https://api.openai.com/v1',  defaultModel: 'gpt-4o-mini',              label: 'OpenAI'         },
    anthropic: { baseURL: null,                         defaultModel: 'claude-haiku-4-5-20251001', label: 'Anthropic'      },
    mistral:   { baseURL: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest',      label: 'Mistral AI'     },
    gemini:    { baseURL: null,                         defaultModel: 'gemini-1.5-flash',          label: 'Google Gemini'  },
    local:     { baseURL: 'http://localhost:11434',     defaultModel: 'llama3.2',                  label: 'Ollama (Local)' },
};

export class ProviderManager {
    constructor() {
        this._store = SecureStorage.load();
    }

    // ─── CRUD ────────────────────────────────────────────────────────────────

    /**
     * Add (or replace) a provider.
     * @param {{ name: string, type: string, baseURL?: string|null, model: string, apiKey: string }} config
     */
    add(config) {
        // Replace any existing entry with the same name
        this._store.providers = this._store.providers.filter(p => p.name !== config.name);

        const encrypted = config.type === 'local'
            ? { encryptedData: '', iv: '', authTag: '', salt: '' }
            : SecureStorage.encrypt(config.apiKey);

        this._store.providers.push({
            name:         config.name,
            type:         config.type,
            baseURL:      config.baseURL ?? KNOWN_PROVIDERS[config.type]?.baseURL ?? null,
            model:        config.model,
            enabled:      true,
            priority:     config.priority ?? this._store.providers.length + 1,
            addedAt:      Date.now(),
            encryptedKey: encrypted.encryptedData,
            keyIV:        encrypted.iv,
            keyAuthTag:   encrypted.authTag,
            keySalt:      encrypted.salt,
        });

        this._save();
    }

    /**
     * Remove a provider by name.
     * @param {string} name
     * @returns {boolean} true if found and removed
     */
    remove(name) {
        const before = this._store.providers.length;
        this._store.providers = this._store.providers.filter(p => p.name !== name);

        // Clear any routing pointing to the removed provider
        for (const [cluster, pName] of Object.entries(this._store.routing)) {
            if (pName === name) delete this._store.routing[cluster];
        }

        if (this._store.defaultProvider === name) {
            this._store.defaultProvider = 'auto';
        }

        this._save();
        return this._store.providers.length < before;
    }

    /**
     * Return all stored providers with API keys masked.
     * @returns {Array<object>}
     */
    list() {
        return this._store.providers.map(p => ({
            name:    p.name,
            type:    p.type,
            baseURL: p.baseURL,
            model:   p.model,
            enabled: p.enabled,
            priority: p.priority,
            addedAt: p.addedAt,
            hasKey:  !!p.encryptedKey,
        }));
    }

    /**
     * Get a single provider record (key masked). Returns null if not found.
     * @param {string} name
     * @returns {object|null}
     */
    get(name) {
        const p = this._store.providers.find(p => p.name === name);
        if (!p) return null;
        return {
            name:    p.name,
            type:    p.type,
            baseURL: p.baseURL,
            model:   p.model,
            enabled: p.enabled,
            addedAt: p.addedAt,
            hasKey:  !!p.encryptedKey,
        };
    }

    // ─── Enable / Disable ────────────────────────────────────────────────────

    enable(name)  { this._setEnabled(name, true);  }
    disable(name) { this._setEnabled(name, false); }

    // ─── Default & Routing ───────────────────────────────────────────────────

    setDefault(name) {
        this._store.defaultProvider = name;
        this._save();
    }

    getDefault() {
        return this._store.defaultProvider ?? 'auto';
    }

    setRouting(cluster, providerName) {
        this._store.routing[cluster] = providerName;
        this._save();
    }

    getRouting() {
        return { ...this._store.routing };
    }

    // ─── Instantiation ───────────────────────────────────────────────────────

    /**
     * Instantiate all enabled stored providers (decrypting keys).
     * Returns Map<name, BaseProvider instance>.
     */
    instantiateProviders() {
        const result = new Map();

        for (const config of this._store.providers) {
            if (!config.enabled) continue;

            try {
                const apiKey   = this._decryptKey(config);
                const provider = this.instantiateProvider(config, apiKey);
                if (provider) result.set(config.name, provider);
            } catch (err) {
                if (process.env.DEBUG) {
                    console.error(`[ProviderManager] Cannot load ${config.name}:`, err.message);
                }
            }
        }

        return result;
    }

    /**
     * Instantiate a single provider from a config object + plaintext key.
     * Used after /provider add for immediate live registration.
     *
     * @param {{ name: string, type: string, baseURL?: string, model: string }} config
     * @param {string} apiKey  plaintext (may be empty for local)
     * @returns {import('./base-provider.js').BaseProvider}
     */
    instantiateProvider(config, apiKey) {
        const shared = { model: config.model, apiKey, timeout: 30_000 };

        switch (config.type) {
            case 'openai':    return new OpenAIProvider(shared);
            case 'anthropic': return new AnthropicProvider(shared);
            case 'mistral':   return new MistralProvider(shared);
            case 'gemini':    return new GeminiProvider(shared);
            case 'local':     return new LocalProvider({ baseUrl: config.baseURL, model: config.model });
            default:          return new CustomProvider({
                name:    config.name,
                baseURL: config.baseURL,
                apiKey,
                model:   config.model,
            });
        }
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    _decryptKey(config) {
        if (config.type === 'local' || !config.encryptedKey) return '';
        return SecureStorage.decrypt(
            config.encryptedKey,
            config.keyIV,
            config.keyAuthTag,
            config.keySalt,
        );
    }

    _setEnabled(name, enabled) {
        const p = this._store.providers.find(p => p.name === name);
        if (!p) return false;
        p.enabled = enabled;
        this._save();
        return true;
    }

    _save() {
        SecureStorage.save(this._store);
    }
}
