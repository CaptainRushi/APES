/**
 * Provider Command
 *
 * Handles all /provider subcommands with interactive readline prompts.
 * API keys are collected with hidden input (no echo) and stored encrypted.
 *
 * Subcommands:
 *   /provider [list]              List all configured providers
 *   /provider add                 Interactive wizard to add a provider
 *   /provider remove  <name>      Remove a stored provider
 *   /provider test    <name>      Health-check a provider
 *   /provider use     <name|auto> Set the default provider
 *   /provider enable  <name>      Enable a disabled provider
 *   /provider disable <name>      Disable without removing
 *   /provider config  <name>      Show full config and session stats
 *   /provider route   <cluster> <name>  Pin a task cluster to a provider
 *   /provider help                Show command reference
 */

import { KNOWN_PROVIDERS } from '../../providers/provider-manager.js';
import { OllamaDetector }  from '../../providers/ollama-detector.js';

// ── Inline ANSI helpers (keeps this module self-contained) ──────────────────
const A = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', gray: '\x1b[90m',
    brightGreen: '\x1b[92m', brightCyan: '\x1b[96m',
};
const c    = (col, txt) => `${A[col]}${txt}${A.reset}`;
const hr   = (n = 58)   => c('gray', '─'.repeat(n));
const pr   = (...a)     => console.log(...a);

const CLUSTERS = ['strategic_planning', 'research_intelligence', 'engineering', 'code_quality', 'version_control', 'execution_automation', 'memory_learning', 'control_safety'];

export class ProviderCommand {
    /**
     * @param {import('../../providers/provider-manager.js').ProviderManager} manager
     * @param {import('../../providers/provider-registry.js').ProviderRegistry} registry
     */
    constructor(manager, registry) {
        this.manager  = manager;
        this.registry = registry;
    }

    /**
     * Entry point — called from CLI with the words after "/provider".
     * @param {string[]} args
     * @param {import('readline').Interface} rl
     */
    async execute(args, rl) {
        const sub = (args[0] ?? 'list').toLowerCase();

        switch (sub) {
            case 'add':
                await this._add(rl);
                break;
            case 'list':
                this._list();
                break;
            case 'remove': case 'rm': case 'delete':
                await this._remove(args[1], rl);
                break;
            case 'test': case 'ping': case 'check':
                await this._test(args[1]);
                break;
            case 'use': case 'set-default': case 'default':
                this._setDefault(args[1]);
                break;
            case 'enable':
                this._toggle(args[1], true);
                break;
            case 'disable':
                this._toggle(args[1], false);
                break;
            case 'config': case 'info': case 'show':
                this._config(args[1]);
                break;
            case 'route':
                this._route(args[1], args[2]);
                break;
            case 'help':
                this._help();
                break;
            default:
                // "/provider openai" as shorthand for "/provider config openai"
                if (args[0] && this.manager.get(args[0])) {
                    this._config(args[0]);
                } else {
                    pr(`\n  ${c('red', '✗')} Unknown subcommand: ${c('yellow', sub)}`);
                    pr(`  Run ${c('cyan', '/provider help')} to see all commands.\n`);
                }
        }
    }

    // ─── /provider add ───────────────────────────────────────────────────────

    async _add(rl) {
        pr(`\n  ${c('bold', c('brightCyan', '✦ Add AI Provider'))}`);
        pr(`  ${hr(50)}`);
        pr(`  ${c('dim', 'Supported types:')} ${c('cyan', Object.keys(KNOWN_PROVIDERS).join('  '))}  ${c('cyan', 'custom')}`);
        pr('');

        // 1. Provider type
        const rawType = await this._q(rl, `  ${c('yellow', '?')} Provider type ${c('dim', '[openai]')}: `);
        const type    = rawType.toLowerCase() || 'openai';
        const known   = KNOWN_PROVIDERS[type];
        const isLocal = type === 'local' || type === 'ollama';

        // 2. Name — custom types need an explicit name; known types use the type itself
        let name = type === 'ollama' ? 'local' : type;
        if (type === 'custom') {
            name = await this._q(rl, `  ${c('yellow', '?')} Provider name: `);
            if (!name) { pr(`  ${c('red', '✗')} Name is required.\n`); return; }
        }

        // 3. Base URL — required for custom; shown for local (editable)
        const knownLocal = KNOWN_PROVIDERS['local'];
        let baseURL = isLocal ? (knownLocal?.baseURL ?? 'http://localhost:11434') : (known?.baseURL ?? null);
        if (type === 'custom' || isLocal) {
            const def    = baseURL ?? '';
            const rawURL = await this._q(rl, `  ${c('yellow', '?')} Base URL${def ? ` ${c('dim', '[' + def + ']')}` : ''}: `);
            baseURL      = rawURL || def;
            if (!baseURL) { pr(`  ${c('red', '✗')} Base URL is required.\n`); return; }
        }

        // 4. API key (hidden input — no echo)
        let apiKey = '';
        if (!isLocal) {
            pr(`  ${c('yellow', '?')} API Key ${c('dim', '(input hidden):')}`);
            process.stdout.write('  ');
            apiKey = await this._secret(rl);
            if (!apiKey) { pr(`  ${c('red', '✗')} API Key is required.\n`); return; }
        } else {
            pr(`  ${c('dim', 'ℹ  Ollama does not require an API key.')}`);
        }

        // 5. Model selection
        let model = '';
        if (isLocal) {
            model = await this._pickOllamaModel(rl, baseURL);
            if (!model) { pr(`  ${c('red', '✗')} Model selection cancelled.\n`); return; }
        } else {
            const defModel = known?.defaultModel ?? '';
            const rawModel = await this._q(rl, `  ${c('yellow', '?')} Model${defModel ? ` ${c('dim', '[' + defModel + ']')}` : ''}: `);
            model = rawModel || defModel;
            if (!model) { pr(`  ${c('red', '✗')} Model is required.\n`); return; }
        }

        // 6. Test connection
        pr(`\n  ${c('dim', '⟳  Testing connection...')}`);
        const actualType  = isLocal ? 'local' : type;
        const cfg         = { name, type: actualType, baseURL, model, apiKey };
        const testProv    = this.manager.instantiateProvider(cfg, apiKey);
        let   healthy     = false;
        let   latencyMs   = 0;
        try {
            const t0  = Date.now();
            healthy   = await testProv.healthCheck();
            latencyMs = Date.now() - t0;
        } catch { /* ignored — save anyway */ }

        if (healthy) {
            pr(`  ${c('brightGreen', '✓')} Connection successful ${c('dim', '(' + latencyMs + 'ms)')}`);
        } else {
            pr(`  ${c('yellow', '⚠')} Connection test inconclusive ${c('dim', '— saving anyway')}`);
        }

        // 7. Persist + live-register
        this.manager.add(cfg);
        const live = this.manager.instantiateProvider(cfg, apiKey);
        this.registry.registerProvider(name, live);

        if (isLocal) {
            pr(`\n  ${c('brightGreen', '✓')} Ollama provider ${c('bold', name)} (${model}) saved and active.`);
            pr(`  ${c('dim', 'Cost: $0 — runs entirely on your device.')}\n`);
        } else {
            pr(`\n  ${c('brightGreen', '✓')} Provider ${c('bold', name)} saved and active.\n`);
        }
    }

    /**
     * Interactive Ollama model picker.
     * Connects to Ollama, lists installed models, lets user select by number or name.
     * Falls back to manual text entry if Ollama is unreachable.
     *
     * @param {import('readline').Interface} rl
     * @param {string} baseURL
     * @returns {Promise<string>} selected model name, or '' to cancel
     */
    async _pickOllamaModel(rl, baseURL) {
        pr(`\n  ${c('dim', '⟳  Connecting to Ollama at')} ${c('cyan', baseURL)}...`);

        const detector = new OllamaDetector(baseURL);
        const { running, models } = await detector.detectFull(4000);

        if (!running) {
            pr(`  ${c('yellow', '⚠')} Ollama not reachable at ${baseURL}`);
            pr(`  ${c('dim', 'Start Ollama first:')} ${c('cyan', 'ollama serve')}`);
            pr(`  ${c('dim', 'Pull a model first:')} ${c('cyan', 'ollama pull llama3.2')}\n`);
            const manual = await this._q(rl, `  ${c('yellow', '?')} Enter model name manually ${c('dim', '[llama3.2]')}: `);
            return manual || 'llama3.2';
        }

        if (models.length === 0) {
            pr(`  ${c('yellow', '⚠')} Ollama is running but no models are installed.`);
            pr(`  ${c('dim', 'Pull a model:')} ${c('cyan', 'ollama pull llama3.2')}\n`);
            const manual = await this._q(rl, `  ${c('yellow', '?')} Enter model name to use (will pull on first run) ${c('dim', '[llama3.2]')}: `);
            return manual || 'llama3.2';
        }

        pr(`  ${c('brightGreen', '✓')} Connected — ${c('cyan', models.length)} model(s) installed\n`);
        pr(`  ${c('bold', 'Available models:')}`);

        models.forEach((m, i) => {
            const idx    = c('dim', `${i + 1}.`);
            const size   = OllamaDetector.formatSize(m.size);
            const family = m.family ? c('dim', `[${m.family}]`) : '';
            const params = m.params ? c('dim', m.params) : '';
            pr(`    ${idx} ${c('cyan', m.name.padEnd(28))} ${params.padEnd(6)} ${size.padEnd(8)} ${family}`);
        });
        pr('');

        const ans = await this._q(rl, `  ${c('yellow', '?')} Select model ${c('dim', '[1]')}: `);

        // Accept a number or a name
        const num = parseInt(ans, 10);
        if (ans === '') return models[0].name;                           // default = first
        if (!isNaN(num) && num >= 1 && num <= models.length) {
            return models[num - 1].name;
        }
        // Accept a model name directly (even if not in list — user may know the tag)
        if (ans.trim()) return ans.trim();

        return models[0].name;
    }

    // ─── /provider list ──────────────────────────────────────────────────────

    _list() {
        const stored    = this.manager.list();
        const activeSet = new Set(this.registry.getProviderNames());
        const statsMap  = Object.fromEntries(this.registry.getSummary().map(s => [s.name, s]));
        const routing   = this.manager.getRouting();
        const defProv   = this.manager.getDefault();

        pr(`\n  ${c('bold', c('brightCyan', '✦ AI Providers'))}`);
        pr(`  ${hr(58)}`);

        if (stored.length === 0 && activeSet.size === 0) {
            pr(`\n  ${c('dim', 'No providers configured.')}`);
            pr(`  Run ${c('cyan', '/provider add')} to register your first provider.`);
        } else {
            // Show stored providers
            for (const p of stored) {
                const isActive = activeSet.has(p.name);
                const s        = statsMap[p.name];

                const dot    = !p.enabled   ? c('gray', '●')
                             : isActive     ? c('brightGreen', '●')
                                            : c('yellow', '●');
                const tag    = !p.enabled   ? c('gray', '[disabled]')
                             : isActive     ? c('brightGreen', '[active]')
                                            : c('yellow', '[inactive]');
                const defTag = p.name === defProv ? `  ${c('cyan', '← default')}` : '';

                pr('');
                pr(`  ${dot} ${c('bold', p.name)}  ${tag}${defTag}`);
                pr(`    ${c('dim', 'type:')}  ${p.type.padEnd(12)}  ${c('dim', 'model:')} ${p.model}`);
                if (p.baseURL) pr(`    ${c('dim', 'url:')}   ${c('dim', p.baseURL)}`);
                if (s && s.totalRequests > 0) {
                    pr(`    ${c('dim', 'calls:')} ${c('cyan', s.totalRequests)}  ${c('dim', 'success:')} ${c('yellow', s.successRate)}  ${c('dim', 'latency:')} ${c('dim', s.avgLatencyMs + 'ms avg')}  ${c('dim', 'cost:')} ${c('cyan', '$' + s.totalCostUSD)}`);
                }
            }

            // Show env-var-only providers (active but not stored)
            for (const name of activeSet) {
                if (stored.some(p => p.name === name)) continue;
                const s = statsMap[name];
                pr('');
                pr(`  ${c('brightGreen', '●')} ${c('bold', name)}  ${c('brightGreen', '[active]')}  ${c('dim', '(env var)')}`);
                if (s && s.totalRequests > 0) {
                    pr(`    ${c('dim', 'calls:')} ${c('cyan', s.totalRequests)}  ${c('dim', 'success:')} ${c('yellow', s.successRate)}  ${c('dim', 'latency:')} ${c('dim', s.avgLatencyMs + 'ms avg')}`);
                }
            }
        }

        // Routing table
        if (Object.keys(routing).length > 0) {
            pr('');
            pr(`  ${c('bold', 'Cluster routing:')}`);
            for (const [cluster, pName] of Object.entries(routing)) {
                pr(`    ${c('cyan', cluster.padEnd(14))} ${c('dim', '→')} ${c('yellow', pName)}`);
            }
        }

        pr('');
        pr(`  ${c('dim', 'Default:')} ${c('bold', defProv)}`);
        pr(`  ${hr(58)}`);
        pr(`  ${c('dim', '/provider add')} · ${c('dim', '/provider test <name>')} · ${c('dim', '/provider help')}\n`);
    }

    // ─── /provider remove ────────────────────────────────────────────────────

    async _remove(name, rl) {
        if (!name) { pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/provider remove <name>')}\n`); return; }
        if (!this.manager.get(name)) { pr(`\n  ${c('red', '✗')} Provider ${c('bold', name)} not found in stored providers.\n`); return; }

        const ans = await this._q(rl, `  ${c('yellow', '?')} Remove ${c('bold', name)}? This cannot be undone. ${c('dim', '[y/N]')}: `);
        if (ans.toLowerCase() !== 'y') { pr(`  ${c('dim', 'Cancelled.')}\n`); return; }

        this.manager.remove(name);
        this.registry.unregisterProvider(name);
        pr(`  ${c('brightGreen', '✓')} Provider ${c('bold', name)} removed.\n`);
    }

    // ─── /provider test ──────────────────────────────────────────────────────

    async _test(name) {
        if (!name) { pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/provider test <name>')}\n`); return; }

        const provider = this.registry.providers.get(name);
        if (!provider) {
            const stored = this.manager.get(name);
            if (!stored) {
                pr(`\n  ${c('red', '✗')} Provider ${c('bold', name)} not found.\n`);
            } else {
                pr(`\n  ${c('yellow', '⚠')} Provider ${c('bold', name)} is stored but not active.`);
                pr(`  ${c('dim', 'It may be disabled or failed to load. Try /provider enable ' + name)}\n`);
            }
            return;
        }

        // Local / Ollama providers get a full benchmark; cloud providers get a health ping
        if (provider.isLocal) {
            await this._benchmarkOllama(name, provider);
        } else {
            await this._pingCloud(name, provider);
        }
    }

    /** Health-check a cloud provider. */
    async _pingCloud(name, provider) {
        pr(`\n  ${c('dim', '⟳  Pinging')} ${c('bold', name)}...`);

        const t0      = Date.now();
        let   healthy = false;
        try { healthy = await provider.healthCheck(); } catch { /* fall through */ }
        const ms = Date.now() - t0;

        const s = this.registry.getSummary().find(x => x.name === name);

        pr('');
        pr(`  ${c('bold', 'Provider:')}    ${name}`);
        pr(`  ${c('bold', 'Status:')}      ${healthy ? c('brightGreen', '✓ HEALTHY') : c('red', '✗ UNREACHABLE')}`);
        pr(`  ${c('bold', 'Latency:')}     ${ms}ms`);
        pr(`  ${c('bold', 'Model:')}       ${provider.model}`);
        pr(`  ${c('bold', 'Streaming:')}   ${provider.supportsStreaming ? c('green', 'supported') : c('dim', 'not supported')}`);
        pr(`  ${c('bold', 'Max tokens:')}  ${provider.maxTokens.toLocaleString()}`);
        if (s && s.totalRequests > 0) {
            pr(`  ${c('bold', 'Session:')}     ${s.totalRequests} calls · ${s.successRate} success · ${s.avgLatencyMs}ms avg · $${s.totalCostUSD}`);
        }
        pr('');
    }

    /**
     * Full benchmark for Ollama/local providers.
     * Uses OllamaDetector to get precise tokens/sec from Ollama timing metadata.
     */
    async _benchmarkOllama(name, provider) {
        pr(`\n  ${c('bold', c('brightCyan', `✦ Benchmarking ${name} (Ollama)`))}`);;
        pr(`  ${hr(50)}`);
        pr(`  Model:   ${c('cyan', provider.model)}`);
        pr(`  URL:     ${c('dim', provider.baseUrl)}`);
        pr('');

        // Step 1: list installed models
        pr(`  ${c('dim', '⟳  Fetching installed models...')}`);
        const models = await provider.listModels();
        if (models.length > 0) {
            pr(`  ${c('bold', 'Installed:')} ${models.map(m => c('cyan', m.name)).join('  ')}`);
        }
        pr('');

        // Step 2: run benchmark
        pr(`  ${c('dim', '⟳  Running benchmark (this may take 30–60s for large models)...')}`);
        const detector = new OllamaDetector(provider.baseUrl);
        const bench    = await detector.benchmark(provider.model);

        pr('');
        if (!bench) {
            pr(`  ${c('red', '✗')} Benchmark failed — model may not be loaded or Ollama is unreachable.`);
            pr(`  ${c('dim', 'Try:')} ${c('cyan', `ollama run ${provider.model}`)}\n`);
            return;
        }

        // Parallel safety estimate: keep local agents below 90% CPU
        // Rule of thumb: safe parallel = floor(10 / tokensPerSec * 2), clamped 1–4
        const parallelSafe = bench.tokensPerSec > 0
            ? Math.max(1, Math.min(4, Math.floor(bench.tokensPerSec / 5)))
            : 1;

        const s = this.registry.getSummary().find(x => x.name === name);

        pr(`  ${c('bold', 'Provider:')}           ${name}`);
        pr(`  ${c('bold', 'Model:')}              ${c('cyan', provider.model)}`);
        pr(`  ${c('bold', 'Status:')}             ${c('brightGreen', '✓ HEALTHY')}`);
        pr(`  ${c('bold', 'Latency:')}            ${c('yellow', bench.latencyMs + 'ms')} ${c('dim', '(wall clock)')}`);
        pr(`  ${c('bold', 'Tokens/sec:')}         ${c('yellow', bench.tokensPerSec > 0 ? bench.tokensPerSec : 'n/a')}`);
        pr(`  ${c('bold', 'Tokens generated:')}   ${bench.evalCount}`);
        if (bench.loadDurationMs > 0) {
            pr(`  ${c('bold', 'Model load time:')}    ${c('dim', bench.loadDurationMs + 'ms')}`);
        }
        pr(`  ${c('bold', 'Max tokens:')}         ${provider.maxTokens.toLocaleString()}`);
        pr(`  ${c('bold', 'Streaming:')}          ${c('green', 'supported')}`);
        pr(`  ${c('bold', 'Cost:')}               ${c('green', '$0.00 — free local inference')}`);
        pr(`  ${c('bold', 'Low-resource mode:')}  ${provider.lowResourceMode ? c('yellow', 'enabled') : c('dim', 'disabled')}`);
        pr(`  ${c('bold', 'Parallel safe limit:')} ${c('cyan', parallelSafe + ' agent(s)')}`);
        if (s && s.totalRequests > 0) {
            pr('');
            pr(`  ${c('bold', 'Session:')}  ${s.totalRequests} calls · ${s.successRate} success · ${s.avgLatencyMs}ms avg`);
        }
        pr('');
    }

    // ─── /provider use ───────────────────────────────────────────────────────

    _setDefault(name) {
        if (!name) { pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/provider use <name|auto>')}\n`); return; }

        if (name !== 'auto') {
            const all = [...new Set([
                ...this.registry.getProviderNames(),
                ...this.manager.list().map(p => p.name),
            ])];
            if (!all.includes(name)) {
                pr(`\n  ${c('red', '✗')} Provider ${c('bold', name)} not found. Available: ${all.join(', ')}\n`);
                return;
            }
        }

        this.manager.setDefault(name);
        pr(`\n  ${c('brightGreen', '✓')} Default provider → ${c('bold', name)}\n`);
    }

    // ─── /provider enable / disable ──────────────────────────────────────────

    _toggle(name, enable) {
        const cmd = enable ? 'enable' : 'disable';
        if (!name) { pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', `/provider ${cmd} <name>`)}\n`); return; }
        if (!this.manager.get(name)) { pr(`\n  ${c('red', '✗')} Provider ${c('bold', name)} not found in stored providers.\n`); return; }

        if (enable) {
            this.manager.enable(name);
            const map = this.manager.instantiateProviders();
            const p   = map.get(name);
            if (p) this.registry.registerProvider(name, p);
            pr(`\n  ${c('brightGreen', '✓')} Provider ${c('bold', name)} enabled.\n`);
        } else {
            this.manager.disable(name);
            this.registry.unregisterProvider(name);
            pr(`\n  ${c('yellow', '○')} Provider ${c('bold', name)} disabled.\n`);
        }
    }

    // ─── /provider config ────────────────────────────────────────────────────

    _config(name) {
        if (!name) { pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/provider config <name>')}\n`); return; }

        const stored   = this.manager.get(name);
        const active   = this.registry.providers.get(name);
        if (!stored && !active) { pr(`\n  ${c('red', '✗')} Provider ${c('bold', name)} not found.\n`); return; }

        const s = this.registry.getSummary().find(x => x.name === name);

        pr(`\n  ${c('bold', c('brightCyan', `✦ ${name}`))}`);
        pr(`  ${hr(50)}`);
        pr(`  ${c('dim', 'Source:')}      ${stored ? 'stored (encrypted)' : 'environment variable'}`);
        pr(`  ${c('dim', 'Type:')}        ${stored?.type    ?? c('dim', 'unknown')}`);
        pr(`  ${c('dim', 'Model:')}       ${stored?.model   ?? active?.model ?? c('dim', 'unknown')}`);
        pr(`  ${c('dim', 'Base URL:')}    ${stored?.baseURL ?? c('dim', 'provider default')}`);
        pr(`  ${c('dim', 'Enabled:')}     ${stored?.enabled !== false ? c('green', 'yes') : c('red', 'no')}`);
        pr(`  ${c('dim', 'API Key:')}     ${stored?.hasKey ? c('green', '✓ stored & encrypted') : c('dim', 'from env var')}`);
        if (stored?.addedAt) pr(`  ${c('dim', 'Added:')}       ${new Date(stored.addedAt).toLocaleString()}`);

        if (active) {
            pr(`  ${c('dim', 'Max tokens:')}  ${active.maxTokens?.toLocaleString()}`);
            pr(`  ${c('dim', 'Streaming:')}   ${active.supportsStreaming ? 'yes' : 'no'}`);
        }

        if (s && s.totalRequests > 0) {
            pr('');
            pr(`  ${c('bold', 'Session performance:')}`);
            pr(`    Calls:        ${c('cyan', s.totalRequests)}`);
            pr(`    Success rate: ${c('yellow', s.successRate)}`);
            pr(`    Avg latency:  ${c('dim', s.avgLatencyMs + 'ms')}`);
            pr(`    Total cost:   ${c('cyan', '$' + s.totalCostUSD)}`);
            pr(`    Degraded:     ${s.degraded ? c('red', 'yes') : c('dim', 'no')}`);
        }
        pr('');
    }

    // ─── /provider route ─────────────────────────────────────────────────────

    _route(cluster, providerName) {
        if (!cluster || !providerName) {
            pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/provider route <cluster> <provider>')}`);
            pr(`  ${c('dim', 'Clusters:')} ${CLUSTERS.join('  ')}\n`);
            return;
        }
        if (!CLUSTERS.includes(cluster)) {
            pr(`\n  ${c('red', '✗')} Unknown cluster: ${c('bold', cluster)}`);
            pr(`  ${c('dim', 'Valid:')} ${CLUSTERS.join(', ')}\n`);
            return;
        }

        this.manager.setRouting(cluster, providerName);
        pr(`\n  ${c('brightGreen', '✓')} ${c('bold', cluster)} tasks → ${c('bold', providerName)}\n`);
    }

    // ─── /provider help ──────────────────────────────────────────────────────

    _help() {
        pr(`
  ${c('bold', c('brightCyan', '✦ /provider — AI Provider Management'))}
  ${hr(58)}
  ${c('bold', 'Commands:')}
    ${c('cyan', '/provider')}                         List all providers
    ${c('cyan', '/provider add')}                     Add a provider (interactive wizard)
    ${c('cyan', '/provider list')}                    Show all providers with live stats
    ${c('cyan', '/provider test')}  ${c('green', '<name>')}            Health-check a provider
    ${c('cyan', '/provider use')}   ${c('green', '<name|auto>')}       Set default provider
    ${c('cyan', '/provider config')} ${c('green', '<name>')}           Show full config + session stats
    ${c('cyan', '/provider enable')} ${c('green', '<name>')}           Re-enable a disabled provider
    ${c('cyan', '/provider disable')} ${c('green', '<name>')}          Disable without removing
    ${c('cyan', '/provider remove')} ${c('green', '<name>')}           Remove permanently
    ${c('cyan', '/provider route')}  ${c('green', '<cluster> <name>')} Route a task cluster to a provider
    ${c('cyan', '/provider help')}                    Show this reference

  ${c('bold', 'Provider types:')}
    ${c('yellow', 'openai')}      OpenAI GPT-4, GPT-4o …          ${c('dim', 'OPENAI_API_KEY')}
    ${c('yellow', 'anthropic')}   Anthropic Claude …               ${c('dim', 'ANTHROPIC_API_KEY')}
    ${c('yellow', 'mistral')}     Mistral AI …                     ${c('dim', 'MISTRAL_API_KEY')}
    ${c('yellow', 'gemini')}      Google Gemini …                  ${c('dim', 'GEMINI_API_KEY')}
    ${c('yellow', 'local')}       Ollama (local inference)         ${c('dim', 'OLLAMA_URL')}
    ${c('yellow', 'custom')}      Any OpenAI-compatible endpoint   ${c('dim', 'any base URL')}

  ${c('bold', 'Task clusters:')}
    ${CLUSTERS.map(cl => c('cyan', cl)).join('  ')}

  ${c('bold', 'Security:')}
    Keys are encrypted with AES-256-GCM, device-bound via PBKDF2, and stored in
    ${c('dim', '~/.apes/providers.json')} — never logged or echoed.
`);
    }

    // ─── Readline helpers ────────────────────────────────────────────────────

    /** Standard question — returns trimmed answer. */
    _q(rl, prompt) {
        return new Promise(resolve => rl.question(prompt, a => resolve(a.trim())));
    }

    /**
     * Secret input — suppresses all echo while the user types.
     * The caller must print the prompt line before calling this.
     * A newline is printed after the user presses Enter.
     */
    _secret(rl) {
        return new Promise(resolve => {
            const orig = rl._writeToOutput;

            // Suppress all readline output (typed chars won't be echoed)
            if (typeof orig === 'function') {
                rl._writeToOutput = () => {};
            }

            rl.question('', answer => {
                if (typeof orig === 'function') rl._writeToOutput = orig;
                process.stdout.write('\n');
                resolve(answer);
            });
        });
    }
}
