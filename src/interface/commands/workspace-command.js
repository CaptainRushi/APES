/**
 * WorkspaceCommand — CLI handler for workspace operations
 *
 * Commands:
 *   /workspace status       — Project root, lock count, operation stats
 *   /workspace analyze      — Full repo analysis display
 *   /workspace read <path>  — Display file content
 *   /workspace find <pat>   — Glob search results
 *   /workspace audit [--limit N] — Recent audit entries
 *   /workspace locks        — Active file locks
 *   /workspace help         — Command reference
 */

export class WorkspaceCommand {
    /**
     * @param {import('../../workspace/workspace-engine.js').WorkspaceEngine} workspaceEngine
     * @param {import('../renderer.js').Renderer} renderer
     */
    constructor(workspaceEngine, renderer) {
        this.engine = workspaceEngine;
        this.renderer = renderer;
    }

    /**
     * Execute a workspace subcommand.
     * @param {string[]} parts — subcommand + args
     * @param {object} [rl] — readline interface
     */
    async execute(parts, rl = null) {
        const sub = (parts[0] || 'status').toLowerCase();
        const c = this.renderer.c.bind(this.renderer);

        if (!this.engine) {
            console.log(`\n  ${c('red', '✗')} Workspace engine is not initialized. Set a project root first.`);
            return;
        }

        switch (sub) {
            case 'status':
                return this._showStatus(c);

            case 'analyze':
                return await this._analyzeRepo(c);

            case 'read':
                return await this._readFile(parts.slice(1), c);

            case 'find':
            case 'search':
                return await this._findFiles(parts.slice(1), c);

            case 'audit':
            case 'log':
                return this._showAudit(parts.slice(1), c);

            case 'locks':
                return this._showLocks(c);

            case 'help':
                return this._showHelp(c);

            default:
                console.log(`\n  ${c('yellow', '⚠')} Unknown workspace command: ${sub}`);
                this._showHelp(c);
        }
    }

    // ─── Subcommands ────────────────────────────────────────────

    _showStatus(c) {
        const status = this.engine.getStatus();
        const box = '─'.repeat(52);

        console.log(`\n${c('cyan', `  ╔${'═'.repeat(52)}╗`)}`);
        console.log(`${c('cyan', '  ║')}  ${c('bold', '📂 Workspace Engine Status')}                      ${c('cyan', '║')}`);
        console.log(`${c('cyan', `  ╚${'═'.repeat(52)}╝`)}`);
        console.log(`  ${c('dim', box)}`);
        console.log(`  ${c('bold', 'Project Root:')}   ${c('cyan', status.projectRoot)}`);
        console.log(`  ${c('bold', 'Active Locks:')}   ${c('yellow', String(status.activeLocks))}`);
        console.log(`  ${c('bold', 'Transactions:')}   ${c('yellow', String(status.activeTransactions))}`);
        console.log(`  ${c('bold', 'Operations:')}     ${c('green', String(status.totalOperations))}`);
        console.log(`  ${c('bold', 'Read-Only:')}      ${status.permissions.readOnlyMode ? c('red', 'Yes') : c('green', 'No')}`);
        console.log(`  ${c('bold', 'Agents Reg:')}     ${c('cyan', String(status.permissions.registeredAgents))}`);

        // Audit summary
        const audit = status.audit;
        console.log(`  ${c('dim', box)}`);
        console.log(`  ${c('bold', '[AUDIT SUMMARY]')}`);
        console.log(`  Total Entries:   ${c('cyan', String(audit.totalEntries))}`);

        if (audit.byAction && Object.keys(audit.byAction).length > 0) {
            const actions = Object.entries(audit.byAction)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => `${action}:${count}`)
                .join(' · ');
            console.log(`  By Action:       ${c('dim', actions)}`);
        }

        if (audit.recentErrors && audit.recentErrors.length > 0) {
            console.log(`  Recent Errors:   ${c('red', String(audit.recentErrors.length))}`);
        }

        console.log(`  ${c('dim', box)}\n`);
    }

    async _analyzeRepo(c) {
        console.log(`\n  ${c('bold', c('cyan', '🔍 Repository Analysis'))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);
        console.log(`  ${c('dim', 'Scanning project...')}`);

        const result = await this.engine.analyzeRepo({ agentId: 'cli' });

        if (!result.success) {
            console.log(`  ${c('red', '✗')} Analysis failed: ${result.error}`);
            return;
        }

        // Languages
        console.log(`\n  ${c('bold', '[LANGUAGES]')}`);
        if (result.languages && result.languages.length > 0) {
            for (const lang of result.languages.slice(0, 10)) {
                const bar = '█'.repeat(Math.max(1, Math.round(lang.percentage / 5)));
                console.log(`  ${c('cyan', lang.language.padEnd(15))} ${c('green', bar)} ${c('dim', `${lang.percentage}% (${lang.files} files)`)}`);
            }
        } else {
            console.log(`  ${c('dim', 'No source files detected')}`);
        }

        // Frameworks
        console.log(`\n  ${c('bold', '[FRAMEWORKS]')}`);
        if (result.frameworks && result.frameworks.length > 0) {
            for (const fw of result.frameworks) {
                const typeColor = { runtime: 'green', framework: 'cyan', infra: 'yellow', ci: 'magenta', build: 'blue', quality: 'dim', test: 'dim', language: 'cyan' };
                const col = typeColor[fw.type] || 'dim';
                const version = fw.version ? c('dim', ` v${fw.version}`) : '';
                console.log(`  ${c('green', '●')} ${c(col, fw.name)}${version} ${c('dim', `(${fw.type}) ← ${fw.configFile}`)}`);
            }
        } else {
            console.log(`  ${c('dim', 'No frameworks detected')}`);
        }

        // Stats
        if (result.stats) {
            console.log(`\n  ${c('bold', '[STATISTICS]')}`);
            console.log(`  Files: ${c('cyan', String(result.stats.totalFiles))} · Dirs: ${c('cyan', String(result.stats.totalDirs))} · LOC: ${c('green', String(result.stats.totalLOC))}`);
            if (result.stats.avgFileSize) {
                console.log(`  Avg File Size: ${c('dim', this._formatBytes(result.stats.avgFileSize))}`);
            }

            if (result.stats.largestFiles && result.stats.largestFiles.length > 0) {
                console.log(`\n  ${c('bold', '[LARGEST FILES]')}`);
                for (const f of result.stats.largestFiles) {
                    console.log(`  ${c('dim', '·')} ${c('yellow', this._formatBytes(f.size).padEnd(10))} ${f.path}`);
                }
            }
        }

        // Package info
        if (result.packageInfo) {
            const pkg = result.packageInfo;
            console.log(`\n  ${c('bold', '[PACKAGE INFO]')}`);
            console.log(`  Name: ${c('cyan', pkg.name || 'unnamed')} · Version: ${c('green', pkg.version || '0.0.0')} · Type: ${c('dim', pkg.type)}`);
            console.log(`  Dependencies: ${c('yellow', String(pkg.dependencies))} · DevDeps: ${c('dim', String(pkg.devDependencies))}`);
            if (pkg.scripts && pkg.scripts.length > 0) {
                console.log(`  Scripts: ${c('dim', pkg.scripts.join(', '))}`);
            }
        }

        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    async _readFile(args, c) {
        const filePath = args.join(' ');
        if (!filePath) {
            console.log(`\n  ${c('red', '✗')} Usage: /workspace read <file-path>`);
            return;
        }

        console.log(`\n  ${c('bold', c('cyan', `📄 File: ${filePath}`))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        const result = await this.engine.readFile(filePath, { agentId: 'cli' });

        if (!result.success) {
            console.log(`  ${c('red', '✗')} ${result.error || 'File not found'}`);
            return;
        }

        if (result.encoding === 'binary') {
            console.log(`  ${c('yellow', '⚠')} Binary file (${this._formatBytes(result.size)}) — cannot display as text`);
            return;
        }

        // Show file metadata
        console.log(`  ${c('dim', `Size: ${this._formatBytes(result.size)} · Lines: ${result.lines} · Encoding: ${result.encoding}`)}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        // Display content with line numbers (cap at 60 lines)
        const lines = result.content.split('\n');
        const maxDisplay = 60;
        const displayLines = lines.slice(0, maxDisplay);
        const lineNumWidth = String(Math.min(lines.length, maxDisplay)).length;

        for (let i = 0; i < displayLines.length; i++) {
            const num = String(i + 1).padStart(lineNumWidth);
            console.log(`  ${c('dim', num + ' │')} ${displayLines[i]}`);
        }

        if (lines.length > maxDisplay) {
            console.log(`  ${c('dim', `... ${lines.length - maxDisplay} more lines`)}`);
        }

        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    async _findFiles(args, c) {
        const pattern = args.join(' ') || '*';
        console.log(`\n  ${c('bold', c('cyan', `🔎 Find: ${pattern}`))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        const result = await this.engine.findFiles(pattern, '.', { agentId: 'cli' });

        if (!result.success) {
            console.log(`  ${c('red', '✗')} ${result.error}`);
            return;
        }

        if (result.count === 0) {
            console.log(`  ${c('dim', 'No files matching pattern')}`);
        } else {
            const maxDisplay = 40;
            const display = result.files.slice(0, maxDisplay);
            for (const file of display) {
                console.log(`  ${c('dim', '·')} ${c('cyan', file)}`);
            }
            if (result.count > maxDisplay) {
                console.log(`  ${c('dim', `... and ${result.count - maxDisplay} more`)}`);
            }
            console.log(`\n  ${c('green', String(result.count))} files found`);
        }

        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    _showAudit(args, c) {
        let limit = 20;
        const limitIdx = args.indexOf('--limit');
        if (limitIdx >= 0 && args[limitIdx + 1]) {
            limit = parseInt(args[limitIdx + 1], 10) || 20;
        }

        console.log(`\n  ${c('bold', c('cyan', '📜 Audit Log'))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        const entries = this.engine.auditLogger.getEntries({ limit });

        if (entries.length === 0) {
            console.log(`  ${c('dim', 'No audit entries yet')}`);
        } else {
            for (const entry of entries) {
                const time = new Date(entry.timestamp).toLocaleTimeString();
                const icon = entry.success ? c('green', '✓') : c('red', '✗');
                const action = c('yellow', (entry.action || '?').padEnd(8));
                const agent = c('dim', (entry.agentId || 'system').padEnd(18));
                const path = entry.path ? c('cyan', entry.path) : '';
                const tx = entry.txId ? c('dim', ` [tx:${entry.txId}]`) : '';
                console.log(`  ${icon} ${c('dim', time)} ${action} ${agent} ${path}${tx}`);

                if (entry.details) {
                    console.log(`    ${c('dim', entry.details)}`);
                }
                if (entry.error) {
                    console.log(`    ${c('red', entry.error)}`);
                }
            }
        }

        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    _showLocks(c) {
        const lockStatus = this.engine.fileLock.getStatus();

        console.log(`\n  ${c('bold', c('cyan', '🔒 Active File Locks'))}`);
        console.log(`  ${c('dim', '─'.repeat(52))}`);

        if (lockStatus.activeLocks === 0) {
            console.log(`  ${c('dim', 'No active locks')}`);
        } else {
            for (const lock of lockStatus.locks) {
                const age = Math.round((Date.now() - lock.lockedAt) / 1000);
                console.log(`  ${c('yellow', '🔒')} ${c('cyan', lock.filePath)}`);
                console.log(`    Agent: ${c('dim', lock.agentId)} · PID: ${c('dim', String(lock.pid))} · Age: ${c('dim', age + 's')}`);
            }
        }

        console.log(`  ${c('dim', '─'.repeat(52))}\n`);
    }

    _showHelp(c) {
        console.log(`\n  ${c('bold', 'Workspace Commands:')}`);
        console.log(`    ${c('green', '/workspace status')}           — Project root, lock count, operation stats`);
        console.log(`    ${c('green', '/workspace analyze')}          — Full repo analysis (languages, frameworks, stats)`);
        console.log(`    ${c('green', '/workspace read')} ${c('dim', '<path>')}     — Display file content`);
        console.log(`    ${c('green', '/workspace find')} ${c('dim', '<pattern>')}  — Glob search for files`);
        console.log(`    ${c('green', '/workspace audit')} ${c('dim', '[--limit N]')} — Recent audit log entries`);
        console.log(`    ${c('green', '/workspace locks')}            — Show active file locks`);
        console.log(`    ${c('green', '/workspace help')}             — This help message\n`);
    }

    // ─── Helpers ────────────────────────────────────────────────

    _formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }
}
