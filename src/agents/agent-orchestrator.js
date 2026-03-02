/**
 * Agent Orchestrator — Per-Agent Mini-Orchestrator
 *
 * Each agent has a mini-orchestrator that controls its internal execution.
 * This prevents hallucination and uncontrolled reasoning by structuring
 * every agent's execution into a deterministic pipeline.
 *
 * Pipeline:
 *   1. plan()            — Decide skill invocation order
 *   2. queryKnowledge()  — Retrieve domain-relevant knowledge
 *   3. executeSkills()   — Run deterministic skill modules
 *   4. callModel()       — If skills insufficient, call foundation model
 *   5. validate()        — Run guardrails on output
 *   6. escalateIfNeeded() — Escalate if stuck or low confidence
 *
 * The orchestrator also handles the autonomy retry loop.
 */

import { AgentInput } from './agent-input.js';
import { AgentOutput } from './agent-output.js';
import { KnowledgeLayer } from './knowledge-layer.js';
import { SkillsLayer } from './skills-layer.js';
import { AutonomyLayer } from './autonomy-layer.js';
import { AgentGuardrails } from './agent-guardrails.js';

export class AgentOrchestrator {
    /**
     * @param {object} agentDef - Agent definition from registry
     * @param {object} [options]
     * @param {object} [options.messageBus] - Message bus for inter-agent communication
     * @param {object} [options.memorySystem] - Memory system for past task retrieval
     */
    constructor(agentDef, options = {}) {
        this.agentDef = agentDef;
        this.agentId = agentDef.id;
        this.cluster = agentDef.cluster;
        this.role = agentDef.role;

        // Initialize all internal layers
        this.knowledge = new KnowledgeLayer(agentDef.cluster, agentDef.skills);
        this.skills = new SkillsLayer(agentDef.cluster, agentDef.skills);
        this.autonomy = new AutonomyLayer({
            agentId: agentDef.id,
            cluster: agentDef.cluster,
            autonomyLevel: agentDef.autonomyLevel || 'medium',
            maxRetries: agentDef.maxRetries ?? 2,
            confidenceThreshold: agentDef.confidenceThreshold ?? 0.75,
        });
        this.guardrails = new AgentGuardrails({
            agentId: agentDef.id,
            cluster: agentDef.cluster,
            skills: agentDef.skills,
        });

        this.messageBus = options.messageBus || null;
        this.memorySystem = options.memorySystem || null;
    }

    /**
     * Execute the full agent pipeline for a task.
     * This is the main entry point — called by MicroAgent.
     *
     * @param {object} task - Raw task object { id, description, ... }
     * @param {object} context - Execution context (providers, complexity, etc.)
     * @returns {Promise<object>} AgentOutput
     */
    async execute(task, context = {}) {
        const startTime = Date.now();
        const skillsUsed = [];

        // ── 1. Build & validate AgentInput ──────────────────────────────────
        const inputResult = AgentInput.create({
            task,
            agentDef: this.agentDef,
            context,
        });

        if (!inputResult.valid) {
            return AgentOutput.error(
                `Invalid input: ${inputResult.errors.join(', ')}`,
                { agentId: this.agentId, agentRole: this.role, taskId: task.id }
            );
        }

        const agentInput = inputResult.input;

        // ── 2. Plan execution strategy ──────────────────────────────────────
        const plan = this.autonomy.plan(agentInput);

        // ── 3. Query Knowledge Layer ────────────────────────────────────────
        const knowledge = this.knowledge.retrieve(agentInput, this.memorySystem);

        // ── 4. Execute with retry loop ──────────────────────────────────────
        let lastOutput = null;
        let attempts = 0;

        while (attempts < (this.autonomy.maxRetries + 1)) {
            attempts++;

            // ── 4a. Run skills ──────────────────────────────────────────────
            const selectedSkills = this.skills.selectSkills(agentInput.objective);
            const skillResults = [];

            for (const skill of selectedSkills) {
                const skillInput = {
                    ...agentInput,
                    workspaceEngine: context?.workspaceEngine || null,
                    agentId: this.agentId,
                };
                const result = await this.skills.executeSkill(skill.name, skillInput);
                skillResults.push(result);
                if (result.success) skillsUsed.push(skill.name);
            }

            // ── 4b. Call foundation model (via provider) ────────────────────
            let modelResult = null;
            const providerRegistry = context?.providerRegistry;

            if (providerRegistry?.isReady?.()) {
                try {
                    modelResult = await this._callModel(agentInput, knowledge, skillResults, context);
                } catch (err) {
                    modelResult = { output: null, error: err.message };
                }
            }

            // ── 4c. Build agent output ──────────────────────────────────────
            const resultContent = this._buildResult(skillResults, modelResult, agentInput);

            const candidateOutput = AgentOutput.create({
                result: resultContent.output,
                confidence: resultContent.confidence,
                risks: resultContent.risks,
                requiresEscalation: false,
                agentId: this.agentId,
                agentRole: this.role,
                taskId: task.id,
                skillsUsed,
                executionTimeMs: Date.now() - startTime,
                attempts,
                mode: modelResult ? 'provider' : 'skills_only',
                autonomyState: this.autonomy.getState(),
            });

            // ── 5. Run guardrails ───────────────────────────────────────────
            const guardrailResult = this.guardrails.check(candidateOutput, agentInput);

            candidateOutput.confidence = guardrailResult.adjustedConfidence;
            candidateOutput.metadata.guardrailsPassed = guardrailResult.passed;
            candidateOutput.metadata.constraintViolations = guardrailResult.violations;

            if (!guardrailResult.passed) {
                candidateOutput.risks.push(
                    ...guardrailResult.violations
                        .filter(v => v.severity === 'error')
                        .map(v => v.message)
                );
            }

            lastOutput = candidateOutput;

            // ── 6. Autonomy decision ────────────────────────────────────────
            const decision = this.autonomy.recordAttempt({
                success: guardrailResult.passed && resultContent.confidence >= 0.5,
                confidence: guardrailResult.adjustedConfidence,
            });

            if (decision.action === 'accept') {
                break; // Success — exit retry loop
            }

            if (decision.shouldEscalate) {
                lastOutput.requiresEscalation = true;
                lastOutput.risks.push(decision.reason);
                break;
            }

            if (!decision.shouldRetry) {
                break;
            }

            // If retrying with research assist, notify via message bus
            if (decision.action === 'research_assist' && this.messageBus) {
                this.messageBus.publish({
                    type: 'query',
                    fromAgentId: this.agentId,
                    channel: 'cluster:research_intelligence',
                    output: `Need research assistance for: ${agentInput.objective}`,
                    taskId: task.id,
                    confidence: guardrailResult.adjustedConfidence,
                });
            }
        }

        // Reset autonomy state for next task
        this.autonomy.reset();

        return lastOutput;
    }

    /**
     * Call the foundation model via provider router.
     * Agents do not directly call the model — they go through the Provider Router.
     */
    async _callModel(agentInput, knowledge, skillResults, context) {
        const providerRegistry = context.providerRegistry;
        const agentRegistry = context.agentRegistry;
        const agent = agentRegistry?.getAgent(this.agentId);

        // Build enriched task with knowledge supplement
        const knowledgeSupplement = this.knowledge.toPromptSupplement(knowledge);

        const enrichedTask = {
            description: agentInput.objective,
            cluster: this.cluster,
            knowledgeContext: knowledgeSupplement,
            skillResults: skillResults
                .filter(r => r.success)
                .map(r => `[${r.skillName}]: ${JSON.stringify(r.result).slice(0, 200)}`),
        };

        // Inject agent-specific instructions from apes.md into context
        const agentInstructions = context.agentInstructions || {};
        const enrichedContext = {
            ...context,
            agentInstructions: {
                ...agentInstructions,
                // Also check for role-specific instructions
                [this.role]: agentInstructions[this.role] || '',
            },
        };

        return await providerRegistry.execute(enrichedTask, agent, enrichedContext);
    }

    /**
     * Build the final result from skill outputs and model response.
     */
    _buildResult(skillResults, modelResult, agentInput) {
        const parts = [];
        const risks = [];
        let confidence = 0.7;

        // Include successful skill results
        const successfulSkills = skillResults.filter(r => r.success);
        for (const sr of successfulSkills) {
            const resultStr = typeof sr.result === 'string'
                ? sr.result
                : JSON.stringify(sr.result);
            parts.push(`[${sr.skillName}] ${resultStr}`);
        }

        // Include model result if available
        if (modelResult?.output) {
            parts.push(modelResult.output);
            confidence = 0.85;
        } else if (modelResult?.error) {
            risks.push(`Model error: ${modelResult.error}`);
            confidence = Math.max(0.3, confidence - 0.2);
        }

        // No simulation fallback — if nothing produced output, report failure
        if (parts.length === 0) {
            return {
                output: '',
                confidence: 0,
                risks: [`Agent ${this.agentId} produced no output: no skills matched and no LLM provider available`],
            };
        }

        return {
            output: parts.join('\n'),
            confidence,
            risks,
        };
    }

    /**
     * Get orchestrator summary for debugging.
     */
    getSummary() {
        return {
            agentId: this.agentId,
            cluster: this.cluster,
            role: this.role,
            knowledge: this.knowledge.getSummary(),
            skills: this.skills.getSummary(),
            autonomy: this.autonomy.getSummary(),
            guardrails: this.guardrails.getSummary(),
        };
    }
}
