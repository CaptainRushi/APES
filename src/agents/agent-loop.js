/**
 * Agent Loop — The Master Agentic Loop
 *
 * Each agent runs an iterative loop:
 *
 *   Step 1: Receive input (user objective OR previous tool result)
 *   Step 2: Prompt the LLM with full context
 *   Step 3: If LLM returns a tool call → execute it locally
 *   Step 3b: If LLM returns plain text with code → extract files and write them
 *   Step 4: Feed tool result back into context
 *   Step 5: Check steering queue for interrupts
 *   Step 6: Repeat until LLM provides a final text response
 *
 * Key design:
 *   - Agents can call tools iteratively (read files, run commands, etc.)
 *   - Agents self-correct: they can see errors and fix them
 *   - Small LLM fallback: if the model can't use tool XML, extract code
 *     blocks from its prose and write them as files
 *   - Agents can be steered mid-execution via the SteeringQueue
 *   - Context is managed and compacted automatically
 *
 * This is the CORE of the APES agentic architecture.
 */

import { ContextManager } from './context-manager.js';
import { SteeringQueue } from './steering-queue.js';
import { join, isAbsolute, dirname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';

// ─── Pre-compiled regex patterns for file extraction ────────────────────────
// Compiled once at module load, not on every LLM response.
const RE_CODE_BLOCK_FILENAME = /```(?:\w+)?\s*\n\s*(?:\/\/|#|\/\*|<!--)\s*(?:filename|file|path):\s*(.+?)(?:\s*\*\/|\s*-->)?\s*\n([\s\S]*?)```/gi;
const RE_CREATE_FILE         = /(?:create|write|save|generating|output)\s+(?:a\s+)?(?:file\s+)?[`"']([^`"']+\.\w+)[`"']\s*:?\s*\n+```(?:\w+)?\s*\n([\s\S]*?)```/gi;
const RE_HEADER_FILE         = /(?:#{1,4}\s+|\*\*(?:File|Filename):\s*|File:\s*)([\w./-]+\.\w+)\**\s*\n+```(?:\w+)?\s*\n([\s\S]*?)```/gi;
const RE_PATH_BEFORE_CODE    = /^\s*`?([\w./-]+\.(?:js|jsx|ts|tsx|html|css|json|md|py|sh|yml|yaml|vue|svelte))`?\s*:?\s*\n```(?:\w+)?\s*\n([\s\S]*?)```/gmi;
const RE_WRITE_TOOL_CALL     = /<tool_call\s+name="write_file">([\s\S]+?)<\/tool_call>/g;
const RE_GENERIC_BLOCK       = /```(\w+)\s*\n([\s\S]*?)```/g;
const RE_INLINE_FILENAME      = /^\s*(?:\/\/|#|\/\*|<!--)\s*(?:filename|file)?:?\s*([\w./-]+\.\w+)/;
const RE_TOOL_CALL            = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/;

/**
 * Tool definitions available to agents.
 */
const BUILT_IN_TOOLS = {
    read_file: {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: '{ "path": "string" }',
    },
    write_file: {
        name: 'write_file',
        description: 'Write content to a file (creates if not exists)',
        parameters: '{ "path": "string", "content": "string" }',
    },
    run_command: {
        name: 'run_command',
        description: 'Execute a shell command and return stdout/stderr',
        parameters: '{ "command": "string", "cwd": "string (optional)" }',
    },
    search_files: {
        name: 'search_files',
        description: 'Search for files matching a pattern in the workspace',
        parameters: '{ "pattern": "string", "directory": "string (optional)" }',
    },
    list_directory: {
        name: 'list_directory',
        description: 'List files and directories at a given path',
        parameters: '{ "path": "string" }',
    },
    spawn_sub_agent: {
        name: 'spawn_sub_agent',
        description: 'Spawn a parallel sub-agent with a specialized task',
        parameters: '{ "task": "string", "specialization": "string (optional)" }',
    },
    task_complete: {
        name: 'task_complete',
        description: 'Signal that the current task is complete with the final output',
        parameters: '{ "output": "string", "summary": "string" }',
    },
};

export class AgentLoop {
    /**
     * @param {object} opts
     * @param {string} opts.agentId — Unique agent identifier
     * @param {string} opts.role — Agent role (e.g., 'code_writer', 'tester')
     * @param {object} [opts.provider] — LLM provider instance
     * @param {object} [opts.workspaceEngine] — Workspace engine for file operations
     * @param {object} [opts.subAgentSpawner] — SubAgentSpawner for spawning sub-agents
     * @param {number} [opts.maxIterations=25] — Safety limit on loop iterations
     * @param {number} [opts.maxTokens=8192] — Context window budget
     * @param {SteeringQueue} [opts.steeringQueue] — External steering queue
     */
    constructor(opts = {}) {
        this.agentId = opts.agentId || `agent-${Date.now()}`;
        this.role = opts.role || 'general';
        this.provider = opts.provider || null;
        this.workspaceEngine = opts.workspaceEngine || null;
        this.subAgentSpawner = opts.subAgentSpawner || null;

        this.maxIterations = opts.maxIterations ?? 25;
        this.steeringQueue = opts.steeringQueue || new SteeringQueue();

        // Context manager for this agent's conversation
        this.context = new ContextManager({
            maxTokens: opts.maxTokens ?? 8192,
        });

        // Execution state
        this._running = false;
        this._iteration = 0;
        this._toolCalls = [];
        this._startTime = null;
        this._filesWritten = [];

        // Event listeners
        this._listeners = new Map();
    }

    // ─── Public API ──────────────────────────────────────────────

    /**
     * Run the master agent loop for a given objective.
     *
     * @param {string} objective — The task description
     * @param {object} [opts]
     * @param {string} [opts.systemPrompt] — Custom system prompt
     * @param {object} [opts.initialContext] — Additional context
     * @returns {Promise<{ output: string, iterations: number, toolCalls: object[], duration: number }>}
     */
    async run(objective, opts = {}) {
        this._running = true;
        this._iteration = 0;
        this._toolCalls = [];
        this._startTime = Date.now();
        this._filesWritten = [];

        // Build system prompt
        const systemPrompt = opts.systemPrompt || this._buildSystemPrompt();
        this.context.setSystemPrompt(systemPrompt);
        this.context.setObjective(objective);

        // Add initial user message
        this.context.addMessage('user', objective);

        // Add any initial context from dependencies
        if (opts.initialContext) {
            this.context.addMessage('system', `Context from completed dependencies:\n${JSON.stringify(opts.initialContext, null, 2)}`);
        }

        this._emit('loop:start', { agentId: this.agentId, objective });

        try {
            // ─── THE MASTER LOOP ─────────────────────────────
            while (this._running && this._iteration < this.maxIterations) {
                this._iteration++;

                // Step 5: Check steering queue for interrupts
                await this._processSteeringQueue();
                if (!this._running) break;

                // Step 5b: Check if paused
                while (this.steeringQueue.isPaused() && this._running) {
                    await this._sleep(200);
                    await this._processSteeringQueue();
                }

                // Auto-compact context if needed
                if (this.context.needsCompaction()) {
                    const compactResult = await this.context.compact(this.provider);
                    if (compactResult.compacted) {
                        this._emit('context:compacted', compactResult);
                    }
                }

                // Step 2: Prompt the LLM
                this._emit('loop:iteration', {
                    agentId: this.agentId,
                    iteration: this._iteration,
                    tokens: this.context.getStats().estimatedTokens,
                });

                const llmResponse = await this._callLLM();

                if (!llmResponse) {
                    // No provider — fail fast, not simulation
                    throw new Error(
                        'No LLM provider configured. Agent cannot execute without a real provider.\n' +
                        'Set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or start Ollama.'
                    );
                }

                // ─── CRITICAL FIX: Extract files BEFORE processing tool calls ───
                // LLMs often output both code blocks AND <tool_call name="task_complete">.
                // If we check for tools first, we'll exit without writing the extracted files!
                const extractedFiles = this._extractFilesFromResponse(llmResponse, objective);

                if (extractedFiles.length > 0) {
                    for (const file of extractedFiles) {
                        const writeArgs = { path: file.path, content: file.content };
                        this._emit('tool:call', { agentId: this.agentId, tool: 'write_file', args: writeArgs });
                        const result = await this._toolWriteFile(writeArgs);
                        this._toolCalls.push({ name: 'write_file', args: writeArgs, result });
                        this._filesWritten.push(file.path);
                        this._emit('tool:result', { agentId: this.agentId, tool: 'write_file', args: writeArgs, result: result.slice(0, 200) });
                    }
                }

                // Step 3: Check if LLM returned a tool call
                const toolCall = this._parseToolCall(llmResponse);

                if (toolCall) {
                    // It's a tool call — execute and loop back
                    this._emit('tool:call', { agentId: this.agentId, tool: toolCall.name, args: toolCall.args });

                    this.context.addMessage('assistant', llmResponse);

                    // Check if this is a task_complete signal
                    if (toolCall.name === 'task_complete') {
                        this._running = false;
                        const output = toolCall.args.output || toolCall.args.summary || llmResponse;
                        this._emit('loop:complete', { agentId: this.agentId, iterations: this._iteration });
                        return {
                            output,
                            summary: toolCall.args.summary || '',
                            iterations: this._iteration,
                            toolCalls: this._toolCalls,
                            filesWritten: this._filesWritten,
                            duration: Date.now() - this._startTime,
                            completed: true,
                        };
                    }

                    // Execute the tool
                    const toolResult = await this._executeTool(toolCall);
                    this._toolCalls.push({ ...toolCall, result: toolResult });

                    // Step 4: Feed result back into context
                    this.context.addMessage('tool_result', `[Tool: ${toolCall.name}] Result:\n${toolResult}`, {
                        type: 'tool_result',
                        toolName: toolCall.name,
                    });

                    this._emit('tool:result', { agentId: this.agentId, tool: toolCall.name, args: toolCall.args, result: toolResult.slice(0, 200) });

                    // Continue the loop
                    continue;
                }

                // ─── FALLBACK CONTINUATION ────
                // If there was NO tool call, but we extracted files, ask for more OR complete
                if (extractedFiles.length > 0) {
                    this.context.addMessage('assistant', llmResponse);

                    // Fix 4: continue one more iteration to check if more files needed
                    if (this._iteration < this.maxIterations) {
                        const fileList = extractedFiles.map(f => f.path).join(', ');
                        this.context.addMessage('system',
                            `You wrote ${extractedFiles.length} file(s): ${fileList}.\nAre there more files needed for this task? If yes, output them now with // filename: comments. If the task is complete, call task_complete.`);
                        continue;
                    }

                    // Mark as done after extracting and writing files
                    this._running = false;
                    this._emit('loop:complete', { agentId: this.agentId, iterations: this._iteration });

                    const fileList = extractedFiles.map(f => f.path).join(', ');
                    return {
                        output: `Created ${extractedFiles.length} file(s): ${fileList}\n\n${llmResponse.slice(0, 500)}`,
                        summary: `Wrote ${extractedFiles.length} files: ${fileList}`,
                        iterations: this._iteration,
                        toolCalls: this._toolCalls,
                        filesWritten: this._filesWritten,
                        duration: Date.now() - this._startTime,
                        completed: true,
                    };
                }

                // ─── Force continuation on prose-only response ──────────────
                // If the LLM gave prose without code, demand code output.
                // Allow up to 5 retries before giving up (not just 2).
                if (this._iteration <= 5 && this._filesWritten.length === 0) {
                    this.context.addMessage('assistant', llmResponse);
                    // Log what the LLM returned so we can diagnose extraction failures
                    const responsePreview = llmResponse.slice(0, 300).replace(/\n/g, '\\n');
                    this._emit('loop:no-files', {
                        agentId: this.agentId,
                        iteration: this._iteration,
                        responsePreview,
                        hasCodeBlocks: /```/.test(llmResponse),
                        hasToolCall: /<tool_call/.test(llmResponse),
                    });

                    this.context.addMessage('system',
                        `STOP. Your response contained NO extractable code files and NO valid tool calls. ` +
                        `You MUST write actual code files to complete this task.\n\n` +
                        `PREFERRED: Use <tool_call name="write_file">{"path": "file.ext", "content": "..."}</tool_call>\n\n` +
                        `ALTERNATIVE: Output fenced code blocks with "// filename: path/to/file" as the FIRST line inside the block.\n\n` +
                        `Do NOT describe what to do — actually write the code NOW. Start with the first file immediately.`);
                    this._emit('loop:forced-continuation', { agentId: this.agentId, iteration: this._iteration });
                    continue;
                }

                // Step 6: LLM gave a final text response with no code — we're done
                this._running = false;
                this.context.addMessage('assistant', llmResponse);
                this._emit('loop:complete', { agentId: this.agentId, iterations: this._iteration });

                return {
                    output: llmResponse,
                    iterations: this._iteration,
                    toolCalls: this._toolCalls,
                    filesWritten: this._filesWritten,
                    duration: Date.now() - this._startTime,
                    completed: true,
                };
            }

            // Max iterations reached
            this._running = false;
            this._emit('loop:maxed', { agentId: this.agentId, iterations: this._iteration });

            return {
                output: `[${this.agentId}] Reached max iterations (${this.maxIterations}). Last context:\n${this._getLastAssistantMessage()}`,
                iterations: this._iteration,
                toolCalls: this._toolCalls,
                filesWritten: this._filesWritten,
                duration: Date.now() - this._startTime,
                completed: false,
                reason: 'max_iterations',
            };
        } catch (error) {
            this._running = false;
            this._emit('loop:error', { agentId: this.agentId, error: error.message });
            throw error;
        }
    }

    /**
     * Stop the agent loop (can be called externally).
     */
    stop() {
        this._running = false;
        this.steeringQueue.cancel();
    }

    isRunning() {
        return this._running;
    }

    getStats() {
        return {
            agentId: this.agentId,
            role: this.role,
            running: this._running,
            iteration: this._iteration,
            maxIterations: this.maxIterations,
            toolCalls: this._toolCalls.length,
            filesWritten: this._filesWritten,
            duration: this._startTime ? Date.now() - this._startTime : 0,
            context: this.context.getStats(),
        };
    }

    // ─── Events ──────────────────────────────────────────────────

    on(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(fn);
    }

    /** @private */
    _emit(event, data) {
        const fns = this._listeners.get(event) || [];
        for (const fn of fns) {
            try { fn(data); } catch { /* swallow */ }
        }
    }

    // ─── Internal: LLM Communication ─────────────────────────────

    /** @private */
    async _callLLM() {
        if (!this.provider) return null;

        const toolDescriptions = Object.values(BUILT_IN_TOOLS)
            .map(t => `- ${t.name}: ${t.description}\n  Parameters: ${t.parameters}`)
            .join('\n');

        const contextData = this.context.getContext();
        const flatPrompt = this.context.buildFlatPrompt();

        const toolInstructions = `

Available Tools:
${toolDescriptions}

To call a tool, respond with EXACTLY this format:
<tool_call name="tool_name">{"param": "value"}</tool_call>

To signal completion, use:
<tool_call name="task_complete">{"output": "your final output", "summary": "brief summary"}</tool_call>

CRITICAL FILE CREATION RULES:
- You MUST write actual code. Do NOT describe what to write.
- Use write_file tool OR include code blocks with filename comments.
- Every code block MUST have "// filename: path/to/file" on the first line.
- Write COMPLETE file contents — no placeholders, no abbreviations.
- If the task is about creating a website/app, you MUST create the actual files.

Example using tool:
<tool_call name="write_file">{"path": "index.html", "content": "<!DOCTYPE html>\n<html>...</html>"}</tool_call>

Example using code block:
\`\`\`html
// filename: index.html
<!DOCTYPE html>\n<html>...</html>
\`\`\``;

        const response = await this.provider.generate({
            systemPrompt: contextData.systemPrompt + toolInstructions,
            userMessage: flatPrompt,
            maxTokens: 8192,
            temperature: 0.7,
        });

        return response.content;
    }

    /** @private */
    _parseToolCall(response) {
        // Parse tool calls from LLM response — uses pre-compiled regex
        const toolMatch = response.match(RE_TOOL_CALL);
        if (!toolMatch) return null;

        const name = toolMatch[1];
        let args = {};

        const rawJson = toolMatch[2].trim();

        try {
            args = JSON.parse(rawJson);
        } catch {
            // Broken JSON fallback (very common with small LLMs putting unescaped newlines in content)
            if (name === 'write_file') {
                const pathMatch = rawJson.match(/"path"\s*:\s*"([^"]+)"\s*,/);
                // content might be multiple lines, ending before the final }
                const contentMatch = rawJson.match(/"content"\s*:\s*"([\s\S]+?)"\s*\}/);

                if (pathMatch && contentMatch) {
                    args = {
                        path: pathMatch[1],
                        content: contentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
                    };
                } else if (pathMatch) {
                    // super fallback — take everything after content: " ...
                    const splitted = rawJson.split(/"content"\s*:\s*"/);
                    if (splitted[1]) {
                        args = {
                            path: pathMatch[1],
                            content: splitted[1].replace(/"\s*\}$/, '').replace(/\\n/g, '\n')
                        };
                    } else {
                        args = { raw: rawJson };
                    }
                } else {
                    args = { raw: rawJson };
                }
            } else {
                args = { raw: rawJson };
            }
        }

        return { name, args };
    }

    // ─── File Extraction from LLM Prose ──────────────────────────
    // When small LLMs can't use tool call format, they often output
    // code blocks with filenames. We detect and extract these.

    /** @private */
    _extractFilesFromResponse(response, objective) {
        const files = [];
        const cwd = process.cwd();
        const seenPaths = new Set();

        const _addFile = (filePath, content) => {
            if (!filePath || content.length < 10) return;
            const cleanPath = filePath.replace(/^[`'"]+|[`'"]+$/g, '').trim();
            if (!cleanPath) return;
            const fullPath = isAbsolute(cleanPath) ? cleanPath : join(cwd, cleanPath);
            if (seenPaths.has(fullPath)) return;
            seenPaths.add(fullPath);
            files.push({ path: fullPath, content });
        };

        // All patterns use pre-compiled module-level regexes.
        // Reset lastIndex before each exec loop (required for /g regexes reused across calls).
        let match;

        // Pattern 1: ```language\n// filename: path/to/file.ext\n...code...\n```
        RE_CODE_BLOCK_FILENAME.lastIndex = 0;
        while ((match = RE_CODE_BLOCK_FILENAME.exec(response)) !== null) {
            _addFile(match[1].trim(), match[2].trim());
        }

        // Pattern 2: "Create file `path/to/file.ext`:" followed by ```code```
        RE_CREATE_FILE.lastIndex = 0;
        while ((match = RE_CREATE_FILE.exec(response)) !== null) {
            _addFile(match[1].trim(), match[2].trim());
        }

        // Pattern 3: ### path/to/file.ext  or  **File: path/to/file.ext** followed by ```
        RE_HEADER_FILE.lastIndex = 0;
        while ((match = RE_HEADER_FILE.exec(response)) !== null) {
            _addFile(match[1].trim(), match[2].trim());
        }

        // Pattern 4: path/to/file.ext: on its own line, directly followed by ```
        RE_PATH_BEFORE_CODE.lastIndex = 0;
        while ((match = RE_PATH_BEFORE_CODE.exec(response)) !== null) {
            _addFile(match[1].trim(), match[2].trim());
        }

        // Pattern 5: Detect common web file patterns from content (always runs as supplement)
        {
            RE_GENERIC_BLOCK.lastIndex = 0;
            while ((match = RE_GENERIC_BLOCK.exec(response)) !== null) {
                const lang    = match[1].toLowerCase();
                const content = match[2].trim();
                if (content.length < 20) continue;

                // Check if content itself starts with a filename comment
                const inlineFilename = content.match(RE_INLINE_FILENAME);
                if (inlineFilename) {
                    const cleanContent = content.replace(/^.*\n/, '').trim();
                    _addFile(inlineFilename[1], cleanContent.length > 10 ? cleanContent : content);
                    continue;
                }

                // Try to extract an explicit file path from the objective/task context
                // e.g., "Create watch1/css/style.css (minimal styling...)" → "watch1/css/style.css"
                const extMap = { html: '.html', css: '.css', javascript: '.js', js: '.js', typescript: '.ts', ts: '.ts', json: '.json', python: '.py', py: '.py', jsx: '.jsx', tsx: '.tsx', vue: '.vue', svelte: '.svelte' };
                const targetExt = extMap[lang] || null;
                let filename = null;

                if (targetExt && objective) {
                    const pathFromObjective = objective.match(new RegExp(`([\\w./-]+${targetExt.replace('.', '\\.')})`, 'i'));
                    if (pathFromObjective) {
                        filename = pathFromObjective[1];
                    }
                }

                if (!filename) {
                    if ((lang === 'html' && content.includes('<!DOCTYPE')) || content.includes('<html')) {
                        filename = 'index.html';
                    } else if (lang === 'css') {
                        filename = content.includes(':root') || content.includes('*') ? 'styles.css' : 'style.css';
                    } else if ((lang === 'javascript' || lang === 'js') && !content.includes('import React')) {
                        if (content.includes('addEventListener') || content.includes('document.')) {
                            filename = 'script.js';
                        } else if (content.includes('express') || content.includes('require(')) {
                            filename = 'server.js';
                        } else {
                            filename = 'app.js';
                        }
                    } else if ((lang === 'jsx' || lang === 'tsx') || (lang === 'javascript' && content.includes('import React'))) {
                    const compMatch = content.match(/(?:function|const|class)\s+(\w+)/);
                    filename = compMatch ? `src/${compMatch[1]}.jsx` : 'src/App.jsx';
                } else if (lang === 'json' && content.includes('"name"')) {
                    filename = 'package.json';
                } else if (lang === 'typescript' || lang === 'ts') {
                    filename = 'src/index.ts';
                } else if (lang === 'python' || lang === 'py') {
                    filename = 'main.py';
                } else if (lang === 'vue') {
                    const compMatch = content.match(/name:\s*['"]?(\w+)/);
                    filename = compMatch ? `src/${compMatch[1]}.vue` : 'src/App.vue';
                } else if (lang === 'svelte') {
                    filename = 'src/App.svelte';
                }
                } // end if (!filename)

                if (filename) _addFile(filename, content);
            }
        }

        // Pattern 6: Direct extraction of <tool_call name="write_file"> bypassing JSON parsing
        RE_WRITE_TOOL_CALL.lastIndex = 0;
        while ((match = RE_WRITE_TOOL_CALL.exec(response)) !== null) {
            const rawJson = match[1];
            const pathMatch = rawJson.match(/"path"\s*:\s*"?([\w./-]+\.\w+)"?/);
            let contentStr = '';

            const splitted = rawJson.split(/"content"\s*:\s*"/);
            if (splitted[1]) {
                contentStr = splitted[1].replace(/"\s*\}$/, '');
                if (contentStr.endsWith('"')) contentStr = contentStr.slice(0, -1);
            } else {
                const contentMatch = rawJson.match(/"content"\s*:\s*"([\s\S]+?)"\s*\}/);
                if (contentMatch) contentStr = contentMatch[1];
            }

            if (pathMatch && contentStr.length > 5) {
                const cleanContent = contentStr.replace(/\\n/g, '\n').replace(/\\"/g, '"');
                _addFile(pathMatch[1], cleanContent);
            }
        }

        return files;
    }

    /** @private */
    async _executeTool(toolCall) {
        const { name, args } = toolCall;

        try {
            switch (name) {
                case 'read_file':
                    return await this._toolReadFile(args);
                case 'write_file':
                    return await this._toolWriteFile(args);
                case 'run_command':
                    return await this._toolRunCommand(args);
                case 'search_files':
                    return await this._toolSearchFiles(args);
                case 'list_directory':
                    return await this._toolListDirectory(args);
                case 'spawn_sub_agent':
                    return await this._toolSpawnSubAgent(args);
                default:
                    return `Unknown tool: ${name}`;
            }
        } catch (error) {
            return `Tool error (${name}): ${error.message}`;
        }
    }

    // ─── Tool Implementations ────────────────────────────────────

    /** @private */
    async _toolReadFile(args) {
        if (this.workspaceEngine) {
            try {
                const result = await this.workspaceEngine.readFile(args.path);
                return result.content || `File read: ${args.path}`;
            } catch (e) {
                return `Error reading file: ${e.message}`;
            }
        }
        // Uses statically imported readFileSync — no dynamic import overhead
        try {
            return readFileSync(args.path, 'utf-8');
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    /** @private */
    async _toolWriteFile(args) {
        if (this.workspaceEngine) {
            try {
                const result = await this.workspaceEngine.writeFile(args.path, args.content, {
                    agentId: this.agentId,
                    reason: 'Agent loop tool call',
                });
                if (!result.success) return `Error writing file: ${result.error}`;
                this._filesWritten.push(args.path);
                return `✓ File written: ${args.path} (${args.content.length} chars)`;
            } catch (e) {
                return `Error writing file: ${e.message}`;
            }
        }
        // Uses statically imported writeFileSync/mkdirSync/dirname
        try {
            mkdirSync(dirname(args.path), { recursive: true });
            writeFileSync(args.path, args.content, 'utf-8');
            this._filesWritten.push(args.path);
            return `✓ File written: ${args.path} (${args.content.length} chars)`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    /** @private */
    async _toolRunCommand(args) {
        // Uses statically imported execSync
        try {
            const output = execSync(args.command, {
                cwd: args.cwd || process.cwd(),
                timeout: 30000,
                maxBuffer: 1024 * 1024,
                encoding: 'utf-8',
            });
            return output.slice(0, 5000); // Cap output
        } catch (e) {
            return `Command failed: ${e.message}\nstdout: ${e.stdout || ''}\nstderr: ${e.stderr || ''}`.slice(0, 5000);
        }
    }

    /** @private */
    async _toolSearchFiles(args) {
        // Uses statically imported execSync
        try {
            const dir = args.directory || process.cwd();
            const cmd = process.platform === 'win32'
                ? `dir /s /b "${dir}\\*${args.pattern}*" 2>nul`
                : `find "${dir}" -name "*${args.pattern}*" -type f 2>/dev/null | head -20`;
            const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
            return output || 'No files found.';
        } catch {
            return 'Search failed or no results found.';
        }
    }

    /** @private */
    async _toolListDirectory(args) {
        // Uses statically imported readdirSync/statSync/join
        try {
            const entries = readdirSync(args.path);
            return entries.map(e => {
                try {
                    const stat = statSync(join(args.path, e));
                    return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${e}`;
                } catch { return `[???] ${e}`; }
            }).join('\n');
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    /** @private */
    async _toolSpawnSubAgent(args) {
        if (!this.subAgentSpawner) {
            return 'Sub-agent spawning not available in this context.';
        }

        try {
            const result = await this.subAgentSpawner.spawn({
                task: args.task,
                systemPrompt: args.systemPrompt,
                specialization: args.specialization,
                parentAgentId: this.agentId,
            });
            return `Sub-agent completed:\n${result.output}`;
        } catch (e) {
            return `Sub-agent error: ${e.message}`;
        }
    }

    // ─── Internal: Steering ──────────────────────────────────────

    /** @private */
    async _processSteeringQueue() {
        if (!this.steeringQueue.hasPending()) return;

        const messages = this.steeringQueue.drain();

        for (const msg of messages) {
            switch (msg.type) {
                case 'interrupt':
                    this.context.addMessage('system', `[INTERRUPT] User redirect: ${msg.payload.message}`);
                    this._emit('steering:interrupt', msg.payload);
                    break;
                case 'append':
                    this.context.addMessage('system', `[CONTEXT UPDATE] ${msg.payload.context}`);
                    break;
                case 'steer':
                    this.context.addMessage('system', `[STEER] Focus on: ${msg.payload.direction}`);
                    this._emit('steering:steer', msg.payload);
                    break;
                case 'cancel':
                    this._running = false;
                    this._emit('steering:cancel', {});
                    break;
                case 'pause':
                case 'resume':
                    break;
            }
        }
    }

    // ─── Internal: Helpers ───────────────────────────────────────

    /** @private */
    _buildSystemPrompt() {
        return `You are an APES (Autonomous Parallel Execution System) agent.
Role: ${this.role}
Agent ID: ${this.agentId}

You are part of a team of parallel agents working together to complete a larger task.
You have access to tools for reading/writing files, running commands, and spawning sub-agents.

CRITICAL RULES — YOU MUST FOLLOW THESE EXACTLY:
1. You MUST produce ACTUAL CODE in fenced code blocks. Do NOT just describe what to do.
2. Every code block MUST start with a filename comment on the FIRST line:
   // filename: src/components/Header.jsx
   or
   /* filename: styles/main.css */
   or
   # filename: scripts/setup.sh
3. Include the COMPLETE file contents — no placeholders, no "...rest of code here".
4. After writing files, VERIFY your work by reading the file back or running a command.
5. If something fails, READ the error, REASON about it, and FIX it.
6. When finished, call task_complete with a summary of what you created.

PREFERRED METHOD — Use tool calls:
<tool_call name="write_file">{"path": "path/to/file.js", "content": "file contents here"}</tool_call>

FALLBACK METHOD — If you cannot use tool_call XML format, output code blocks with filename comments.
Example:
\`\`\`html
// filename: index.html
<!DOCTYPE html>
<html>...</html>
\`\`\`

NEVER respond with only text descriptions. You MUST output code.`;
    }

    /** @private */
    _getLastAssistantMessage() {
        const assistantMsgs = this.context.messages.filter(m => m.role === 'assistant');
        return assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].content : '(no output)';
    }

    /** @private */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
