/**
 * APES Orchestrator — Central Control Plane
 *
 * The brain of APES. Executes the 10-stage Cognitive Pipeline:
 *
 *   1. Parse Input
 *   2. Intent Classification
 *   3. Task Decomposition
 *   4. Complexity Scoring
 *   5. Agent Allocation
 *   6. Parallel Execution (DAG-based)
 *   7. Result Evaluation
 *   7.5 Anti-Hallucination Check
 *   8. Aggregation (with conflict resolution)
 *   9. Learning Update
 *   10. Return Output
 */

import { IntentClassifier } from './intent-classifier.js';
import { TaskDecomposer } from './task-decomposer.js';
import { ComplexityScorer } from './complexity-scorer.js';
import { ResultEvaluator } from './result-evaluator.js';
import { ResultAggregator } from './result-aggregator.js';
import { AgentRegistry } from '../agents/registry.js';
import { AgentSpawner } from '../agents/spawner.js';
import { DAGScheduler } from '../execution/dag-scheduler.js';
import { WorkerPool } from '../execution/worker-pool.js';
import { MemorySystem } from '../memory/memory-system.js';
import { LearningSystem } from '../learning/learning-system.js';
import { ProviderRegistry } from '../providers/provider-registry.js';
import { ProviderManager } from '../providers/provider-manager.js';
import { MessageBus } from '../communication/message-bus.js';
import { TeamManager } from '../teams/team-manager.js';
import { HallucinationDetector } from '../safety/hallucination-detector.js';
import { WorkspaceEngine } from '../workspace/workspace-engine.js';
import { ApesMdLoader } from '../config/apes-md-loader.js';
import { SkillLoader } from '../config/skill-loader.js';

export class Orchestrator {
    constructor(config = {}) {
        // Cognitive Pipeline Components
        this.classifier = new IntentClassifier();
        this.decomposer = new TaskDecomposer();
        this.scorer = new ComplexityScorer();
        this.evaluator = new ResultEvaluator();
        this.aggregator = new ResultAggregator();

        // Agent System
        this.registry = new AgentRegistry();
        this.spawner = new AgentSpawner(this.registry);

        // Execution Engine
        this.scheduler = new DAGScheduler();
        this.workerPool = new WorkerPool(config.maxWorkers ?? 16);

        // Memory & Learning
        this.memory = new MemorySystem();
        this.learning = new LearningSystem(this.memory);

        // External AI Providers
        this.providerManager = new ProviderManager();
        this.providers = new ProviderRegistry(this.providerManager);

        // Communication
        this.messageBus = new MessageBus();

        // Team Management
        this.teamManager = new TeamManager(this.messageBus);

        // Safety
        this.hallucinationDetector = new HallucinationDetector();

        // Workspace Engine
        this.workspaceEngine = null; // Lazily initialized when projectRoot is available

        // Project Config — apes.md + skills
        this.apesMd = new ApesMdLoader();
        this.skillLoader = new SkillLoader();
        this._projectConfigLoaded = false;
    }

    /**
     * Load project-level apes.md and skills.
     * Called once at startup from CLI or externally.
     * @param {string} [projectDir=process.cwd()]
     */
    loadProjectConfig(projectDir = process.cwd()) {
        if (this._projectConfigLoaded) return;

        this.apesMd.load(projectDir);
        this.skillLoader.load(projectDir);
        this._projectConfigLoaded = true;
    }

    /**
     * Get the project context string from apes.md for injection into prompts.
     * @returns {string}
     */
    getProjectContext() {
        return this.apesMd.getContextString();
    }

    /**
     * Match user input against loaded skills.
     * @param {string} input
     * @returns {import('../config/skill-loader.js').Skill[]}
     */
    matchSkills(input) {
        return this.skillLoader.match(input);
    }

    /**
     * Initialize the workspace engine with a project root.
     * Can be called at startup or when the user sets a project directory.
     * @param {string} projectRoot — Absolute path to the project directory
     * @param {string} [sessionId] — Session ID for lock/audit isolation
     */
    initWorkspace(projectRoot, sessionId) {
        this.workspaceEngine = new WorkspaceEngine(projectRoot, {
            sessionId: sessionId || 'default',
            messageBus: this.messageBus,
        });
    }

    /**
     * Execute the full cognitive pipeline
     * @param {string} input - Raw user input
     * @param {object} context - Session context, permissions, renderer, animationEngine
     * @returns {Promise<object>} - Execution result
     */
    async execute(input, context = {}) {
        const startTime = Date.now();
        const pipeline = {};
        const anim = context.animationEngine ?? null;
        
        // If directExecution is set, skip task decomposition and run as single task
        const isDirectExecution = context.directExecution === true;

        try {
            // ─────────────────────────────────────────────
            // Stage 1: Parse Input
            // ─────────────────────────────────────────────
            const parsed = this.parseInput(input);

            // ─────────────────────────────────────────────
            // Stage 2: Intent Classification
            // ─────────────────────────────────────────────
            const intent = this.classifier.classify(parsed);
            pipeline.intent = intent;
            this.log(context, 'intent', intent);
            anim?.setStatus('CLASSIFYING');

            // ─────────────────────────────────────────────
            // Stage 3: Task Decomposition
            // ─────────────────────────────────────────────
            // If directExecution, skip decomposition - we're executing an existing task
            let tasks;
            if (isDirectExecution) {
                // For direct execution, treat the input as a single task
                tasks = {
                    tasks: [{
                        id: context.taskId || 'direct-task',
                        description: input,
                        type: intent.type,
                        cluster: intent.cluster,
                        dependsOn: [],
                        status: 'pending',
                        priority: 1,
                    }],
                    totalTasks: 1,
                    hasParallelizable: false,
                };
                anim?.setStatus('EXECUTING DIRECT TASK');
            } else {
                tasks = this.decomposer.decompose(parsed, intent);
                anim?.setStatus('DECOMPOSING');
            }
            pipeline.decomposition = tasks;
            this.log(context, 'decomposition', tasks);

            // ─────────────────────────────────────────────
            // Stage 4: Complexity Scoring
            // ─────────────────────────────────────────────
            const complexity = this.scorer.score(tasks);
            pipeline.complexity = complexity;
            this.log(context, 'complexity', complexity);

            // ─────────────────────────────────────────────
            // Stage 5: Agent Allocation (deferred — lazy per-wave spawning)
            // ─────────────────────────────────────────────
            // Agents are now spawned lazily per-wave inside the DAG scheduler.
            // We inject the spawner, complexity, and intent into context so the
            // scheduler can call allocateForWave() before each wave executes.
            pipeline.agents = null; // Reconstructed from execution result
            this.log(context, 'agents', 'deferred to per-wave lazy spawning');

            // ─────────────────────────────────────────────
            // Stage 6: DAG Execution (Parallel)
            // ─────────────────────────────────────────────

            // GATE: Fail fast if no LLM provider is configured
            if (!this.providers.isReady()) {
                throw new Error(
                    'No LLM provider configured. Cannot execute tasks.\n' +
                    'Set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, or start Ollama.'
                );
            }

            anim?.setStatus('EXECUTING');

            // Inject subsystems into context for workers
            context.providerRegistry = this.providers;
            context.agentRegistry = this.registry;
            context.complexity = complexity;
            context.messageBus = this.messageBus;
            context.workspaceEngine = this.workspaceEngine;

            // Inject spawner + intent for lazy per-wave allocation
            context.spawner = this.spawner;
            context.intent = intent;

            // Inject apes.md project context, matched skills, and agent instructions
            context.projectContext = this.getProjectContext();
            context.matchedSkills = this.matchSkills(input);
            context.apesMdRules = this.apesMd.merged?.rules || [];
            context.apesMdConventions = this.apesMd.merged?.conventions || [];
            context.agentInstructions = this.apesMd.merged?.agentInstructions || {};

            const dag = this.scheduler.buildDAG(tasks);
            const executionResult = await this.scheduler.execute(dag, null, this.workerPool, context);

            // Reconstruct allocation from accumulated per-wave results
            const allocation = executionResult.accumulatedAllocation || { agents: [], assignments: {} };
            pipeline.agents = allocation;
            pipeline.execution = executionResult;
            this.log(context, 'execution', executionResult);

            // ─────────────────────────────────────────────
            // Stage 7: Result Evaluation
            // ─────────────────────────────────────────────
            anim?.setStatus('EVALUATING');
            const evaluation = this.evaluator.evaluate(executionResult, tasks);
            pipeline.evaluation = evaluation;

            // ─────────────────────────────────────────────
            // Stage 7.5: Anti-Hallucination Check
            // ─────────────────────────────────────────────
            anim?.setStatus('VALIDATING');
            const hallucinationCheck = this.hallucinationDetector.detect(executionResult, tasks);
            pipeline.hallucination = hallucinationCheck.stats;

            // Use hallucination-checked results for aggregation
            const checkedExecution = {
                ...executionResult,
                results: hallucinationCheck.results,
            };

            // ─────────────────────────────────────────────
            // Stage 8: Aggregation (with conflict resolution)
            // ─────────────────────────────────────────────
            const aggregated = this.aggregator.aggregate(checkedExecution, evaluation);
            pipeline.conflicts = aggregated.conflicts;

            // ─────────────────────────────────────────────
            // Stage 9: Learning Update
            // ─────────────────────────────────────────────
            const duration = Date.now() - startTime;
            this.learning.update({
                input, intent, tasks, complexity, allocation,
                execution: executionResult, evaluation, duration,
            });

            if (anim) {
                anim.setCoreState('learning');
                anim.setStatus('LEARNING');
                anim.learningActive = true;
                for (const agent of allocation.agents) {
                    anim.setState(agent.id, 'terminated');
                }
                // Show learning animation for a moment
                await new Promise(r => setTimeout(r, 1200));
                anim.learningActive = false;
                anim.setCoreState('active');
                anim.setStatus('COMPLETED');
            }

            // ─────────────────────────────────────────────
            // Stage 10: Return Output
            // ─────────────────────────────────────────────
            return {
                output: aggregated.summary,
                pipeline,
                metrics: {
                    duration,
                    agentsUsed: allocation.agents.length,
                    tasksCompleted: evaluation.completed,
                    tasksFailed: evaluation.failed,
                    complexityLevel: complexity.level,
                    hallucinationFlags: hallucinationCheck.flagged.length,
                    conflictsResolved: aggregated.conflicts?.resolved || 0,
                },
            };
        } catch (error) {
            return {
                error: error.message,
                pipeline,
                metrics: { duration: Date.now() - startTime },
            };
        }
    }

    /**
     * Convert snake_case role to Title Case display name
     */
    _formatRole(role) {
        return role
            .split('_')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }

    /**
     * Parse raw input into structured form.
     * Split once and derive both tokens and wordCount from the same array.
     */
    parseInput(input) {
        const tokens = input.split(/\s+/);
        return {
            raw: input,
            tokens,
            length: input.length,
            wordCount: tokens.length,
        };
    }

    /**
     * Log pipeline stage to renderer if available
     */
    log(context, stage, data) {
        if (context.renderer && process.env.DEBUG) {
            const summary = typeof data === 'string' ? data : JSON.stringify(data).slice(0, 100);
            console.log(`  ${stage}: ${summary}`);
        }
    }
}
