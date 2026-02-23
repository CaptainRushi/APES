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
 *   8. Aggregation
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
        this.workerPool = new WorkerPool(config.maxWorkers ?? 8);

        // Memory & Learning
        this.memory = new MemorySystem();
        this.learning = new LearningSystem(this.memory);
    }

    /**
     * Execute the full cognitive pipeline
     * @param {string} input - Raw user input
     * @param {object} context - Session context, permissions, renderer
     * @returns {Promise<object>} - Execution result
     */
    async execute(input, context = {}) {
        const startTime = Date.now();
        const pipeline = {};

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

            // ─────────────────────────────────────────────
            // Stage 3: Task Decomposition
            // ─────────────────────────────────────────────
            const tasks = this.decomposer.decompose(parsed, intent);
            pipeline.decomposition = tasks;
            this.log(context, 'decomposition', tasks);

            // ─────────────────────────────────────────────
            // Stage 4: Complexity Scoring
            // ─────────────────────────────────────────────
            const complexity = this.scorer.score(tasks);
            pipeline.complexity = complexity;
            this.log(context, 'complexity', complexity);

            // ─────────────────────────────────────────────
            // Stage 5: Agent Allocation
            // ─────────────────────────────────────────────
            const allocation = this.spawner.allocate(tasks, complexity, intent);
            pipeline.agents = allocation;
            this.log(context, 'agents', allocation);

            // ─────────────────────────────────────────────
            // Stage 6: DAG Execution (Parallel)
            // ─────────────────────────────────────────────
            const dag = this.scheduler.buildDAG(tasks);
            const executionResult = await this.scheduler.execute(dag, allocation, this.workerPool, context);
            pipeline.execution = executionResult;
            this.log(context, 'execution', executionResult);

            // ─────────────────────────────────────────────
            // Stage 7: Result Evaluation
            // ─────────────────────────────────────────────
            const evaluation = this.evaluator.evaluate(executionResult, tasks);
            pipeline.evaluation = evaluation;

            // ─────────────────────────────────────────────
            // Stage 8: Aggregation
            // ─────────────────────────────────────────────
            const aggregated = this.aggregator.aggregate(executionResult, evaluation);

            // ─────────────────────────────────────────────
            // Stage 9: Learning Update
            // ─────────────────────────────────────────────
            const duration = Date.now() - startTime;
            this.learning.update({
                input,
                intent,
                tasks,
                complexity,
                allocation,
                execution: executionResult,
                evaluation,
                duration,
            });

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
     * Parse raw input into structured form
     */
    parseInput(input) {
        return {
            raw: input,
            tokens: input.split(/\s+/),
            length: input.length,
            wordCount: input.split(/\s+/).length,
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
