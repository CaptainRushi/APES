/**
 * Task Auto-Executor — Distributed Parallel Task Execution (v2)
 *
 * Redesigned with Claude Code-inspired agentic architecture:
 *
 *   1. Each task gets its own AgentLoop (master loop)
 *   2. Agents run iteratively: LLM → tool call → result → repeat
 *   3. Self-correcting: agents verify and fix their own work
 *   4. True parallelism: multiple agent loops run concurrently
 *   5. Sub-agent spawning: agents can spawn child agents for subtasks
 *   6. Steering: running agents can be interrupted or redirected
 *   7. Context compaction: auto-summarize when context window fills
 *
 * Fully parallel-safe: multiple executors across terminals can run
 * simultaneously without conflicts.
 */

import { TaskEngine } from './task-engine.js';
import { TaskLearningBridge } from './task-learning.js';
import { AgentLoop } from '../agents/agent-loop.js';
import { SubAgentSpawner } from '../agents/sub-agent-spawner.js';
import { SteeringQueue } from '../agents/steering-queue.js';
import { ExecutionVerifier } from './execution-verifier.js';

export class TaskAutoExecutor {
    /**
     * @param {string} sessionId
     * @param {object} orchestrator — The APES Orchestrator instance
     * @param {object} [opts]
     * @param {number} [opts.maxConcurrent=4] — Max parallel tasks
     * @param {number} [opts.pollInterval=1000] — Ms between claim attempts
     * @param {number} [opts.minConfidence=0.5] — Quality gate threshold
     * @param {number} [opts.maxIterationsPerAgent=25] — Max loop iterations per agent
     */
    constructor(sessionId, orchestrator, opts = {}) {
        this.sessionId = sessionId;
        this.engine = new TaskEngine(sessionId);
        this.orchestrator = orchestrator;
        this.learning = new TaskLearningBridge(sessionId);

        this.maxConcurrent = opts.maxConcurrent ?? 1; // Simplify to sequential (1 agent at a time) per user request
        this.pollInterval = opts.pollInterval ?? 1000;
        this.minConfidence = opts.minConfidence ?? 0.7;
        this.maxIterationsPerAgent = opts.maxIterationsPerAgent ?? 25;

        this._running = false;
        this._activeCount = 0;
        this._pollTimer = null;
        this._completedCount = 0;
        this._failedCount = 0;

        // ─── Parallel Agent System ────────────────────────────────
        /** @type {Map<string, AgentLoop>} Active agent loops keyed by taskId */
        this._agentLoops = new Map();

        /** Sub-agent spawner shared across all agents */
        this._subAgentSpawner = null;

        /** Master steering queue for global control */
        this.steeringQueue = new SteeringQueue();

        // Event listeners
        this._listeners = {
            'task:claimed': [],
            'task:completed': [],
            'task:failed': [],
            'execution:done': [],
            'execution:start': [],
            'agent:iteration': [],
            'agent:tool_call': [],
            'agent:spawned': [],
            'agent:completed': [],
        };
    }

    // ─── Event System ────────────────────────────────────────────

    /**
     * Register an event listener.
     * @param {string} event
     * @param {function} fn
     */
    on(event, fn) {
        if (this._listeners[event]) {
            this._listeners[event].push(fn);
        }
    }

    /**
     * Emit an event.
     * @param {string} event
     * @param {*} data
     */
    _emit(event, data) {
        for (const fn of (this._listeners[event] || [])) {
            try { fn(data); } catch { /* swallow listener errors */ }
        }
    }

    // ─── Execution Control ───────────────────────────────────────

    /**
     * Start auto-execution mode with parallel agent loops.
     * Continuously polls for available tasks and spawns agent loops for each.
     * @returns {Promise<object>} Resolves when all tasks are done
     */
    async start() {
        if (this._running) return;
        this._running = true;
        this._completedCount = 0;
        this._failedCount = 0;

        // Initialize the sub-agent spawner
        this._subAgentSpawner = new SubAgentSpawner({
            providerRegistry: this.orchestrator.providers,
            workspaceEngine: this.orchestrator.workspaceEngine,
            maxParallel: this.maxConcurrent,
            maxIterationsPerAgent: this.maxIterationsPerAgent,
        });

        // Initialize execution verifier
        this.executionVerifier = new ExecutionVerifier({
            workspaceEngine: this.orchestrator.workspaceEngine,
            minExecutionTime: 100,
            requireSnapshotMatch: true
        });

        // Forward sub-agent events
        this._subAgentSpawner.on('agent:spawned', (data) => this._emit('agent:spawned', data));
        this._subAgentSpawner.on('agent:completed', (data) => this._emit('agent:completed', data));
        this._subAgentSpawner.on('agent:iteration', (data) => this._emit('agent:iteration', data));
        this._subAgentSpawner.on('agent:tool_call', (data) => this._emit('agent:tool_call', data));

        this._emit('execution:start', { sessionId: this.sessionId });

        return new Promise((resolve) => {
            this._pollTimer = setInterval(async () => {
                if (!this._running) return;

                // Check global steering queue
                if (this.steeringQueue.isCancelled()) {
                    this.stop();
                    resolve({
                        completed: this._completedCount,
                        failed: this._failedCount,
                        total: this.engine.getStatus().total,
                        cancelled: true,
                    });
                    return;
                }

                // Check if all tasks are done
                const status = this.engine.getStatus();
                const remaining = status.pending + status.inProgress + status.blocked;

                if (remaining === 0 && this._activeCount === 0) {
                    this.stop();
                    const result = {
                        completed: this._completedCount,
                        failed: this._failedCount,
                        total: status.total,
                    };
                    this._emit('execution:done', result);
                    resolve(result);
                    return;
                }

                // Try to claim and execute tasks up to maxConcurrent
                while (this._activeCount < this.maxConcurrent && this._running) {
                    const agentId = `apes-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                    const claim = this.engine.claimNextAvailable(agentId);

                    if (!claim.success) break; // No more available tasks

                    this._activeCount++;
                    this._emit('task:claimed', claim.task);

                    // Register agent cluster to grant file system write permissions
                    if (this.orchestrator?.workspaceEngine?.permissionGuard) {
                        const validClusters = ['engineering', 'code_quality', 'research_intelligence', 'strategic_planning', 'version_control', 'execution_automation', 'memory_learning', 'control_safety'];
                        const cluster = claim.task.cluster && validClusters.includes(claim.task.cluster) ? claim.task.cluster : 'engineering';
                        this.orchestrator.workspaceEngine.permissionGuard.registerAgentCluster(agentId, cluster);
                    }

                    // Spawn an agent loop for this task (don't await — parallel!)
                    this._executeTaskWithAgentLoop(claim.task, agentId).then(() => {
                        this._activeCount--;
                    }).catch(() => {
                        this._activeCount--;
                    });
                }
            }, this.pollInterval);
        });
    }

    /**
     * Stop auto-execution mode.
     */
    stop() {
        this._running = false;
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }

        // Stop all active agent loops
        for (const [taskId, loop] of this._agentLoops) {
            loop.stop();
        }
        this._agentLoops.clear();

        // Stop sub-agent spawner
        if (this._subAgentSpawner) {
            this._subAgentSpawner.stopAll();
        }
    }

    /**
     * Steer a specific task's agent.
     * @param {string} taskId
     * @param {string} direction
     */
    steerTask(taskId, direction) {
        const loop = this._agentLoops.get(taskId);
        if (loop) {
            loop.steeringQueue.steer(direction);
        }
    }

    /**
     * Interrupt a specific task's agent.
     * @param {string} taskId
     * @param {string} message
     */
    interruptTask(taskId, message) {
        const loop = this._agentLoops.get(taskId);
        if (loop) {
            loop.steeringQueue.interrupt(message);
        }
    }

    /**
     * Check if execution is running.
     * @returns {boolean}
     */
    isRunning() {
        return this._running;
    }

    /**
     * Get execution progress.
     * @returns {object}
     */
    getProgress() {
        const status = this.engine.getStatus();
        return {
            ...status,
            activeExecutors: this._activeCount,
            completedThisRun: this._completedCount,
            failedThisRun: this._failedCount,
            running: this._running,
            activeAgentLoops: this._agentLoops.size,
            subAgentStats: this._subAgentSpawner?.getStats() || null,
        };
    }

    // ─── Internal: Agent Loop Execution ──────────────────────────

    /**
     * Execute a single task using an AgentLoop (master loop pattern).
     * The agent iteratively calls LLM + tools until the task is complete,
     * then self-verifies the output.
     *
     * @param {object} task
     * @param {string} agentId
     */
    async _executeTaskWithAgentLoop(task, agentId) {
        const startTime = Date.now();

        // Get the LLM provider
        const provider = this.orchestrator.providers?.isReady()
            ? this.orchestrator.providers.getProvider()
            : null;

        // Create an AgentLoop for this task
        const loop = new AgentLoop({
            agentId,
            role: task.cluster || task.type || 'executor',
            provider,
            workspaceEngine: this.orchestrator.workspaceEngine,
            subAgentSpawner: this._subAgentSpawner,
            maxIterations: this.maxIterationsPerAgent,
        });

        // Track the agent loop
        this._agentLoops.set(task.id, loop);

        // Forward iteration events for live display
        loop.on('loop:iteration', (data) => {
            this._emit('agent:iteration', { ...data, taskId: task.id, taskTitle: task.title });
        });
        loop.on('tool:call', (data) => {
            this._emit('agent:tool_call', { ...data, taskId: task.id });
        });

        try {
            // Gather context from completed dependencies
            const depContext = this._gatherDependencyContext(task);

            // Build task-specific system prompt
            const systemPrompt = this._buildTaskSystemPrompt(task);

            // Snapshot before execution for integrity check
            let preSnapshot = null;
            if (this.executionVerifier) {
                const workspaceRoot = this.orchestrator.workspaceEngine?.projectRoot ?? process.cwd();
                preSnapshot = this.executionVerifier.takeSnapshot([workspaceRoot]);
            }

            // ─── RUN THE AGENT LOOP ──────────────────────────
            const result = await loop.run(task.description || task.title, {
                systemPrompt,
                initialContext: depContext,
            });

            this._agentLoops.delete(task.id);
            const duration = Date.now() - startTime;

            // ─── Quality Gate ────────────────────────────────
            const confidence = this._assessConfidence(result, task);

            let integrityVerdict = { pass: true, reasons: [], flags: [] };
            if (this.executionVerifier) {
                integrityVerdict = this.executionVerifier.verify({ result, task, duration, preSnapshot });
            }

            if (confidence >= this.minConfidence && integrityVerdict.pass) {
                // Pass: mark completed
                this.engine.completeTask(task.id, agentId, {
                    output: result.output,
                    confidence,
                    duration,
                    iterations: result.iterations,
                    toolCalls: result.toolCalls?.length || 0,
                    integrity: integrityVerdict
                });

                // Record learning data
                this.learning.recordCompletion({
                    taskId: task.id,
                    duration,
                    agent: agentId,
                    confidence,
                    iterations: result.iterations,
                    toolCalls: result.toolCalls?.length || 0,
                    cluster: task.cluster,
                    type: task.type,
                });

                this._completedCount++;
                this._emit('task:completed', { task, result, duration, confidence, integrity: integrityVerdict });
            } else {
                // Fail quality gate → retry or escalate
                let failMessage = `Quality gate failed: confidence ${confidence.toFixed(2)} < ${this.minConfidence}`;
                if (!integrityVerdict.pass) {
                    failMessage = `Integrity check failed: ${integrityVerdict.reasons.join('; ')}`;
                }

                const failResult = this.engine.failTask(task.id, agentId, {
                    message: failMessage,
                });

                if (failResult.retrying) {
                    this._emit('task:failed', { task, reason: 'quality_gate', retrying: true, integrity: integrityVerdict });
                } else {
                    this._failedCount++;
                    this._emit('task:failed', { task, reason: 'quality_gate_escalated', retrying: false, integrity: integrityVerdict });
                }
            }
        } catch (error) {
            this._agentLoops.delete(task.id);

            const failResult = this.engine.failTask(task.id, agentId, {
                message: error.message,
            });

            if (failResult.retrying) {
                this._emit('task:failed', { task, reason: error.message, retrying: true });
            } else {
                this._failedCount++;
                this._emit('task:failed', { task, reason: error.message, retrying: false });
            }
        }
    }

    // ─── Internal: Helpers ───────────────────────────────────────

    /**
     * Build a task-specific system prompt for the agent loop.
     * @param {object} task
     * @returns {string}
     */
    _buildTaskSystemPrompt(task) {
        return `# 🧠 APES CORE ENGINEERING AGENT

You are an actual executor node in APES (Autonomous Parallel Execution System).
You are NOT a chatbot. You are a fully autonomous file-writing engine.
Your sole purpose is to implement the given task by using the provided tools to construct, modify, and verify files on the file system.

# YOUR TASK:
Title: ${task.title}
Type: ${task.type || 'development'}
Cluster: ${task.cluster || 'general'}
Description: ${task.description || ''}

# CRITICAL RULES (FAILURE IF BROKEN):
1. **TOOL USAGE IS REQUIRED:** You must use tools (write_file, read_file, run_command, edit_file) to accomplish your goal. Generating code in conversational responses DOES NOTHING. The code must be sent through the tool arguments!
2. **NO CHATTER:** Never say "Here is the code" or "I will implement this." Just execute the tool calls silently.
3. **COMPLETE IMPLEMENTATION:** When writing code, provide the full, production-ready, working code. Never output "// ... existing code" or placeholders.
4. **FILE SYSTEM AWARENESS:** Ensure you are writing files to the correct requested paths (often starting with ./).
5. **SILENT COMPLETION:** When the task is physically complete via your tool calls, simply return "<completed>". Do not summarize what you did.

APES is a 64-Agent Swarm. As agent ${task.assignedAgent || 'current'}, you are responsible for exactly the above task.
Execute immediately.`;
    }

    /**
     * Gather output context from completed dependency tasks.
     * @param {object} task
     * @returns {object|null}
     */
    _gatherDependencyContext(task) {
        if (!task.dependencies || task.dependencies.length === 0) return null;

        const depOutputs = {};
        for (const depId of task.dependencies) {
            const depTask = this.engine.getTask(depId);
            if (depTask && depTask.status === 'completed' && depTask.result) {
                depOutputs[depId] = {
                    title: depTask.title,
                    output: typeof depTask.result === 'object'
                        ? depTask.result.output || JSON.stringify(depTask.result).slice(0, 500)
                        : String(depTask.result).slice(0, 500),
                };
            }
        }

        return Object.keys(depOutputs).length > 0 ? depOutputs : null;
    }

    /**
     * Assess the confidence score of a task execution result.
     * @param {object} result
     * @returns {number} 0-1 confidence score
     */
    _assessConfidence(result, task) {
        if (!result || result.error) return 0;

        let confidence = 0.5; // base

        // Boost for completed status
        if (result.completed) confidence += 0.2;

        // Boost for tool usage (agent actually did work)
        const realToolCalls = result.toolCalls ? result.toolCalls.filter(t => t.name !== 'task_complete' && t.name !== 'spawn_sub_agent') : [];
        if (realToolCalls.length > 0) confidence += 0.1;

        // Boost for multiple iterations (agent self-corrected)
        if (result.iterations > 1) confidence += 0.05;

        // Boost for having output
        if (result.output && result.output.length > 50) confidence += 0.1;

        // ── Fix 5: File creation awareness ──────────────────
        // Big boost when agent actually wrote files to disk
        if (result.filesWritten && result.filesWritten.length > 0) {
            confidence += 0.15;
        }

        // Penalize code-generation tasks that produced no files
        // (the agent just described what to do without actually doing it)
        if (result.filesWritten && result.filesWritten.length === 0) {
            const output = (result.output || '').toLowerCase();
            const title = (task && task.title ? task.title : '').toLowerCase();
            const looksLikeCodeTask = output.includes('create') || output.includes('implement') ||
                output.includes('build') || output.includes('write') || output.includes('file') ||
                title.includes('create') || title.includes('build') || title.includes('write');

            if (looksLikeCodeTask && realToolCalls.length === 0) {
                confidence -= 0.3; // Heavy penalty to ensure it fails minConfidence (0.7)
            }
        }

        // Penalize if hit max iterations (might not have finished)
        if (result.reason === 'max_iterations') confidence -= 0.2;

        return Math.min(1, Math.max(0, confidence));
    }
}
