/**
 * Agent Input — User-Experience Layer
 *
 * Structured I/O for internal micro-agents.
 * Validates, normalizes, and enriches task input before agent processing.
 *
 * AgentInput Schema:
 *   taskId:       string    — unique task identifier
 *   objective:    string    — what the agent must accomplish
 *   constraints:  string[]  — boundaries and limitations
 *   dependencies: string[]  — IDs of tasks this depends on
 *   context:      object    — snapshot of relevant state
 *   memory:       object    — injected memory from past executions
 *   priority:     number    — 1 (critical) to 10 (low)
 *   deadline:     number    — max ms allowed for execution
 */

export class AgentInput {
    /**
     * Create and validate an AgentInput from raw task data.
     * @param {{ task: object, agentDef: object, context?: object }} raw
     * @returns {{ valid: boolean, input?: object, errors?: string[] }}
     */
    static create(raw) {
        const errors = [];
        const { task, agentDef, context } = raw;

        if (!task) errors.push('task is required');
        if (!task?.id) errors.push('task.id is required');
        if (!task?.description) errors.push('task.description is required');

        if (errors.length > 0) {
            return { valid: false, errors };
        }

        const input = {
            taskId: task.id,
            objective: task.description,
            constraints: AgentInput._extractConstraints(task, context),
            dependencies: task.dependsOn || [],
            context: AgentInput._buildContextSnapshot(task, agentDef, context),
            memory: AgentInput._injectMemory(agentDef, context),
            priority: task.priority ?? 5,
            deadline: task.deadline ?? 30000,
            agentRole: agentDef?.role || 'general',
            agentCluster: agentDef?.cluster || 'unknown',
            complexityLevel: context?.complexity?.level || 'medium',
        };

        return { valid: true, input };
    }

    /**
     * Extract constraints from task and context.
     */
    static _extractConstraints(task, context) {
        const constraints = [];

        // Task-level constraints
        if (task.cluster) constraints.push(`domain:${task.cluster}`);
        if (task.maxTokens) constraints.push(`maxTokens:${task.maxTokens}`);

        // Context-level constraints
        if (context?.complexity?.level === 'simple') {
            constraints.push('brevity:high');
            constraints.push('depth:shallow');
        } else if (context?.complexity?.level === 'complex') {
            constraints.push('depth:thorough');
            constraints.push('validation:required');
        }

        return constraints;
    }

    /**
     * Build a minimal context snapshot for the agent.
     */
    static _buildContextSnapshot(task, agentDef, context) {
        return {
            taskCluster: task.cluster || null,
            agentSkills: agentDef?.skills || [],
            agentConfidence: agentDef?.confidenceScore || 0.5,
            complexity: context?.complexity?.level || 'medium',
            waveIndex: task.wave ?? null,
            hasProviders: !!context?.providerRegistry?.isReady?.(),
        };
    }

    /**
     * Inject relevant memory for this agent's domain.
     */
    static _injectMemory(agentDef, context) {
        // Memory system integration — pull domain-relevant entries
        const memory = context?.memorySystem;
        if (!memory) return { entries: [], patterns: [] };

        const cluster = agentDef?.cluster || '';
        const skills = agentDef?.skills || [];

        return {
            entries: [],      // Populated by KnowledgeLayer at runtime
            patterns: [],     // Populated by KnowledgeLayer at runtime
            domain: cluster,
            skills,
        };
    }

    /**
     * Validate an existing AgentInput object.
     * @param {object} input
     * @returns {{ valid: boolean, errors: string[] }}
     */
    static validate(input) {
        const errors = [];
        if (!input.taskId) errors.push('taskId is required');
        if (!input.objective) errors.push('objective is required');
        if (!Array.isArray(input.constraints)) errors.push('constraints must be array');
        if (!Array.isArray(input.dependencies)) errors.push('dependencies must be array');
        if (typeof input.context !== 'object') errors.push('context must be object');
        return { valid: errors.length === 0, errors };
    }
}
