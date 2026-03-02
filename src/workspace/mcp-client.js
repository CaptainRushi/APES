/**
 * MCP Client — Tool Integration Layer
 *
 * Schema-driven tool invocation for agents with permission checks and audit logging.
 */

import { EventEmitter } from 'node:events';

export class MCPClient extends EventEmitter {
    constructor() {
        super();
        this.tools = new Map();
        this.categoryIndex = new Map();
        this.auditLog = [];
        this.maxAuditEntries = 1000;
        this.agentPermissions = new Map();
        this._registerBuiltins();
    }

    registerTool(descriptor) {
        const { name, category = 'custom' } = descriptor;
        if (!name) throw new Error('Tool descriptor requires a name');
        this.tools.set(name, { ...descriptor, category });
        if (!this.categoryIndex.has(category)) this.categoryIndex.set(category, new Set());
        this.categoryIndex.get(category).add(name);
        this.emit('mcp:tool-registered', { name, category });
    }

    unregisterTool(name) {
        const tool = this.tools.get(name);
        if (!tool) return;
        this.categoryIndex.get(tool.category)?.delete(name);
        this.tools.delete(name);
    }

    grantPermissions(agentId, permissions) {
        if (!this.agentPermissions.has(agentId)) this.agentPermissions.set(agentId, new Set());
        for (const p of permissions) this.agentPermissions.get(agentId).add(p);
    }

    checkPermissions(agentId, toolName) {
        const tool = this.tools.get(toolName);
        if (!tool) return { allowed: false, missing: ['tool_not_found'] };
        const agentPerms = this.agentPermissions.get(agentId) || new Set();
        const missing = (tool.permissions || []).filter(p => !agentPerms.has(p));
        return { allowed: missing.length === 0, missing };
    }

    async invoke(toolName, params = {}, context = {}) {
        const startTime = Date.now();
        const tool = this.tools.get(toolName);
        if (!tool) return this._log(toolName, context, startTime, { success: false, error: `Tool not found: ${toolName}` });

        if (context.agentId) {
            const { allowed, missing } = this.checkPermissions(context.agentId, toolName);
            if (!allowed) return this._log(toolName, context, startTime, { success: false, error: `Permission denied. Missing: ${missing.join(', ')}` });
        }

        const validation = this._validateInput(tool.inputSchema, params);
        if (!validation.valid) return this._log(toolName, context, startTime, { success: false, error: `Validation: ${validation.errors.join('; ')}` });

        try {
            const result = await tool.handler(params, context);
            return this._log(toolName, context, startTime, { success: true, result });
        } catch (err) {
            return this._log(toolName, context, startTime, { success: false, error: err.message });
        }
    }

    listTools(category) {
        let names = category ? [...(this.categoryIndex.get(category) || [])] : [...this.tools.keys()];
        return names.map(n => { const t = this.tools.get(n); return { name: t.name, description: t.description, category: t.category, permissions: t.permissions }; });
    }

    _registerBuiltins() {
        this.registerTool({
            name: 'file_read', description: 'Read file', category: 'filesystem', inputSchema: { required: ['path'] }, permissions: ['read'],
            handler: async (p) => { const { readFile } = await import('node:fs/promises'); return { content: await readFile(p.path, 'utf-8') }; }
        });
        this.registerTool({
            name: 'file_write', description: 'Write file', category: 'filesystem', inputSchema: { required: ['path', 'content'] }, permissions: ['write'],
            handler: async (p) => { const { writeFile, mkdir } = await import('node:fs/promises'); const { dirname } = await import('node:path'); await mkdir(dirname(p.path), { recursive: true }); await writeFile(p.path, p.content, 'utf-8'); return { success: true }; }
        });
        this.registerTool({
            name: 'shell_exec', description: 'Run shell command', category: 'shell', inputSchema: { required: ['command'] }, permissions: ['execute'],
            handler: async (p) => { const { execSync } = await import('node:child_process'); try { return { stdout: execSync(p.command, { cwd: p.cwd || process.cwd(), timeout: p.timeout || 30000, encoding: 'utf-8' }), exitCode: 0 }; } catch (e) { return { stdout: e.stdout || '', stderr: e.stderr || e.message, exitCode: e.status || 1 }; } }
        });
        this.registerTool({
            name: 'dir_list', description: 'List directory', category: 'filesystem', inputSchema: { required: ['path'] }, permissions: ['read'],
            handler: async (p) => { const { readdir, stat } = await import('node:fs/promises'); const { join } = await import('node:path'); const items = await readdir(p.path); const entries = []; for (const i of items.slice(0, 100)) { try { const s = await stat(join(p.path, i)); entries.push({ name: i, isDir: s.isDirectory(), size: s.size }); } catch { entries.push({ name: i }); } } return { entries }; }
        });
    }

    _validateInput(schema, params) {
        if (!schema) return { valid: true, errors: [] };
        const errors = [];
        if (schema.required) for (const k of schema.required) if (params[k] == null) errors.push(`Missing: ${k}`);
        return { valid: errors.length === 0, errors };
    }

    _log(toolName, context, startTime, result) {
        const entry = { toolName, agentId: context.agentId || 'unknown', timestamp: startTime, durationMs: Date.now() - startTime, success: result.success, error: result.error || null };
        this.auditLog.push(entry);
        if (this.auditLog.length > this.maxAuditEntries) this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
        this.emit('mcp:invocation', entry);
        return { ...result, durationMs: entry.durationMs };
    }

    getStatus() {
        return { registeredTools: this.tools.size, categories: [...this.categoryIndex.keys()], totalInvocations: this.auditLog.length };
    }
}
