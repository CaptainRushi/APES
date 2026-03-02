/**
 * MicroAgent — Unified Agent Blueprint
 *
 * Every one of the 64 APES agents follows this blueprint.
 * A MicroAgent is a self-contained intelligent entity with:
 *
 *   ┌─────────────────────┐
 *   │   User Interface    │  ← AgentInput / AgentOutput
 *   └──────────┬──────────┘
 *              │
 *      ┌───────▼────────┐
 *      │  Orchestrator   │  ← AgentOrchestrator (plan/execute/validate/escalate)
 *      └───────┬────────┘
 *              │
 *  ┌───────┬───┼───┬───────┬──────────┐
 *  ▼       ▼   ▼   ▼       ▼          ▼
 * Know   Skill Auto  Msg  Guard    Foundation
 * ledge  Layer nomy  Bus  rails    Model
 *
 * All 64 agents share:
 *   - Same internal architecture
 *   - Different domain knowledge
 *   - Different skill sets
 *   - Different escalation policies
 *
 * Agent Configuration:
 *   {
 *     agentId, cluster, modelPreference,
 *     skills, knowledgeScope, autonomyLevel,
 *     maxRetries, confidenceThreshold
 *   }
 */

import { AgentOrchestrator } from './agent-orchestrator.js';
import { AgentOutput } from './agent-output.js';

export class MicroAgent {
    /**
     * @param {object} agentDef - Agent definition from registry
     * @param {object} [options]
     * @param {object} [options.messageBus]   - Message bus instance
     * @param {object} [options.memorySystem] - Memory system instance
     */
    constructor(agentDef, options = {}) {
        this.id = agentDef.id;
        this.role = agentDef.role;
        this.cluster = agentDef.cluster;
        this.skills = agentDef.skills || [];
        this.confidenceScore = agentDef.confidenceScore || 0.5;

        // Configuration template
        this.config = {
            agentId: agentDef.id,
            cluster: agentDef.cluster,
            modelPreference: agentDef.modelPreference || 'auto',
            skills: agentDef.skills || [],
            knowledgeScope: [agentDef.cluster, ...(agentDef.skills || [])],
            autonomyLevel: agentDef.autonomyLevel || 'medium',
            maxRetries: agentDef.maxRetries ?? 2,
            confidenceThreshold: agentDef.confidenceThreshold ?? 0.75,
        };

        // Internal orchestrator (the brain of this micro-agent)
        this.orchestrator = new AgentOrchestrator(agentDef, {
            messageBus: options.messageBus,
            memorySystem: options.memorySystem,
        });

        this._executionCount = 0;
    }

    /**
     * Execute a task through the full micro-agent pipeline.
     *
     * @param {object} task    - { id, description, cluster, dependsOn, ... }
     * @param {object} context - { providerRegistry, agentRegistry, messageBus, complexity, ... }
     * @returns {Promise<{ output: string, metadata: object }>}
     */
    async execute(task, context = {}) {
        this._executionCount++;

        try {
            // Delegate to internal orchestrator (full 6-stage pipeline)
            const agentOutput = await this.orchestrator.execute(task, context);

            // Convert AgentOutput to WorkerPool-compatible format
            return {
                output: AgentOutput.toOutputString(agentOutput),
                metadata: {
                    agentId: this.id,
                    taskId: task.id,
                    mode: agentOutput.metadata?.mode || 'simulation',
                    confidence: agentOutput.confidence,
                    processingTime: agentOutput.metadata?.executionTimeMs || 0,
                    skillsUsed: agentOutput.metadata?.skillsUsed || [],
                    attempts: agentOutput.metadata?.attempts || 1,
                    guardrailsPassed: agentOutput.metadata?.guardrailsPassed ?? true,
                    constraintViolations: agentOutput.metadata?.constraintViolations || [],
                    requiresEscalation: agentOutput.requiresEscalation,
                    risks: agentOutput.risks || [],
                    autonomyState: agentOutput.metadata?.autonomyState || null,
                },
            };
        } catch (error) {
            // Guardrail: never let an agent crash the system
            const errOutput = AgentOutput.error(error.message, {
                agentId: this.id,
                agentRole: this.role,
                taskId: task.id,
            });

            return {
                output: `[${this.id}] Error: ${error.message}`,
                metadata: {
                    agentId: this.id,
                    taskId: task.id,
                    mode: 'error',
                    confidence: 0,
                    processingTime: 0,
                    error: error.message,
                    requiresEscalation: true,
                },
            };
        }
    }

    /**
     * Get micro-agent introspection data.
     */
    getSummary() {
        return {
            ...this.config,
            executionCount: this._executionCount,
            orchestrator: this.orchestrator.getSummary(),
        };
    }
}

/**
 * MicroAgent Factory — creates and caches MicroAgent instances.
 *
 * The factory ensures each agent ID maps to exactly one MicroAgent,
 * preserving learning state across executions within a session.
 */
export class MicroAgentFactory {
    /**
     * @param {object} [options]
     * @param {object} [options.messageBus]
     * @param {object} [options.memorySystem]
     */
    constructor(options = {}) {
        /** @type {Map<string, MicroAgent>} */
        this._cache = new Map();
        this._options = options;
    }

    /**
     * Get or create a MicroAgent for the given agent definition.
     * @param {object} agentDef
     * @returns {MicroAgent}
     */
    getOrCreate(agentDef) {
        if (this._cache.has(agentDef.id)) {
            return this._cache.get(agentDef.id);
        }

        const agent = new MicroAgent(agentDef, this._options);
        this._cache.set(agentDef.id, agent);
        return agent;
    }

    /**
     * Clear the cache (e.g., on session reset).
     */
    clear() {
        this._cache.clear();
    }

    /**
     * Get cache statistics.
     */
    getStats() {
        return {
            cachedAgents: this._cache.size,
            agents: [...this._cache.values()].map(a => ({
                id: a.id,
                role: a.role,
                executions: a._executionCount,
            })),
        };
    }
}
