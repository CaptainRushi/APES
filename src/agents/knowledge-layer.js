/**
 * Knowledge Layer — Per-Agent Domain-Scoped Knowledge
 *
 * Knowledge Retrieval Pipeline:
 *   Query → Semantic Search → Filter by domain → Inject minimal context → Send to model
 *
 * Sources:
 *   1. Agent domain rules (skill-specific knowledge)
 *   2. Cluster knowledge base
 *   3. APES global rules
 *   4. Past task memory (execution history)
 *   5. Project context (injected at runtime)
 *
 * Reduces token waste by only injecting domain-relevant knowledge.
 */

/**
 * Domain knowledge bases per cluster.
 * In production these would be populated from vector stores / RAG.
 * Currently provides structured rule sets per domain.
 */
const DOMAIN_KNOWLEDGE = {
    strategic_planning: {
        principles: [
            'Break complex requirements into atomic, independently testable components',
            'Identify critical path and parallelize non-dependent work',
            'Always document trade-offs and decision rationale',
            'Estimate with confidence intervals, not point estimates',
            'Consider failure modes and design contingencies',
        ],
        patterns: ['decomposition-first', 'risk-driven-prioritization', 'dependency-mapping'],
    },
    research_intelligence: {
        principles: [
            'Synthesize from multiple sources, never rely on single reference',
            'Distinguish facts from opinions and hypotheses',
            'Cite sources and provide evidence trails',
            'Identify knowledge gaps explicitly',
            'Prioritize primary sources over secondary',
        ],
        patterns: ['multi-source-synthesis', 'evidence-grading', 'gap-analysis'],
    },
    engineering: {
        principles: [
            'Write clean, production-ready code with error handling',
            'Follow SOLID principles and language idioms',
            'Implement security best practices (OWASP Top 10)',
            'Design for testability and maintainability',
            'Minimize external dependencies',
        ],
        patterns: ['clean-architecture', 'tdd', 'api-first-design', 'modular-composition'],
    },
    code_quality: {
        principles: [
            'Every code change must be reviewable and justified',
            'Catch bugs at the earliest possible stage',
            'Tests must cover happy path, edge cases, and error paths',
            'Code style consistency across the project',
            'Security vulnerabilities are always critical priority',
        ],
        patterns: ['static-analysis-first', 'coverage-driven', 'security-gate'],
    },
    version_control: {
        principles: [
            'Commits must be atomic and well-described',
            'Branch strategy must match team size and release cadence',
            'Never force-push to shared branches without coordination',
            'Keep dependency updates incremental and tested',
            'CI pipeline must be fast, reliable, and informative',
        ],
        patterns: ['trunk-based', 'gitflow', 'semantic-versioning', 'conventional-commits'],
    },
    execution_automation: {
        principles: [
            'Infrastructure must be reproducible (IaC)',
            'Monitoring and alerting before scaling',
            'Least-privilege access for all services',
            'Automate everything that runs more than twice',
            'Design for graceful degradation under load',
        ],
        patterns: ['immutable-infrastructure', 'blue-green-deployment', 'chaos-engineering'],
    },
    memory_learning: {
        principles: [
            'Measure before optimizing',
            'Statistical significance before conclusions',
            'Track regressions against established baselines',
            'Distill knowledge into actionable patterns',
            'Continuously update policy based on outcomes',
        ],
        patterns: ['data-driven-optimization', 'a-b-testing', 'feedback-loops'],
    },
    control_safety: {
        principles: [
            'Validate all inputs at system boundaries',
            'Never trust agent outputs without verification',
            'Audit trail for every state-changing action',
            'Fail closed, not open, on security decisions',
            'Compliance requirements are non-negotiable constraints',
        ],
        patterns: ['defense-in-depth', 'zero-trust', 'constraint-propagation'],
    },
};

/** Global APES rules that apply to all agents */
const GLOBAL_RULES = [
    'Never fabricate information — if uncertain, state uncertainty explicitly',
    'Respect task boundaries — do not exceed assigned scope',
    'Report confidence honestly — overconfidence is a failure mode',
    'Escalate when stuck — two failed attempts triggers escalation',
    'Communicate through structured channels — use message bus for inter-agent queries',
];

export class KnowledgeLayer {
    /**
     * @param {string} cluster - The agent's cluster ID
     * @param {string[]} skills - The agent's skill set
     */
    constructor(cluster, skills = []) {
        this.cluster = cluster;
        this.skills = skills;
        this.domainKnowledge = DOMAIN_KNOWLEDGE[cluster] || { principles: [], patterns: [] };
        this.globalRules = GLOBAL_RULES;
        this._cache = new Map();
    }

    /**
     * Retrieve relevant knowledge for a task.
     * Implements the pipeline: Query → Search → Filter → Inject minimal context
     *
     * @param {object} agentInput - The structured agent input
     * @param {object} [memorySystem] - Optional memory system for past task retrieval
     * @returns {{ principles: string[], patterns: string[], rules: string[], context: string }}
     */
    retrieve(agentInput, memorySystem = null) {
        const objective = agentInput.objective || '';
        const cacheKey = `${this.cluster}:${objective.slice(0, 50)}`;

        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        // 1. Domain principles (always included for this cluster)
        const principles = this.domainKnowledge.principles;

        // 2. Relevant patterns (filtered by task keywords)
        const patterns = this._filterPatterns(objective);

        // 3. Applicable global rules
        const rules = this._selectRules(agentInput);

        // 4. Build minimal context injection
        const context = this._buildContext(agentInput, memorySystem);

        const result = { principles, patterns, rules, context };
        this._cache.set(cacheKey, result);

        // Cap cache at 100 entries
        if (this._cache.size > 100) {
            const firstKey = this._cache.keys().next().value;
            this._cache.delete(firstKey);
        }

        return result;
    }

    /**
     * Build a system prompt supplement from retrieved knowledge.
     * @param {object} knowledge - Output of retrieve()
     * @returns {string}
     */
    toPromptSupplement(knowledge) {
        const parts = [];

        if (knowledge.principles.length > 0) {
            parts.push('Domain Principles:\n' +
                knowledge.principles.map(p => `• ${p}`).join('\n'));
        }

        if (knowledge.patterns.length > 0) {
            parts.push('Applicable Patterns: ' + knowledge.patterns.join(', '));
        }

        if (knowledge.rules.length > 0) {
            parts.push('Rules:\n' +
                knowledge.rules.map(r => `• ${r}`).join('\n'));
        }

        if (knowledge.context) {
            parts.push('Context:\n' + knowledge.context);
        }

        return parts.join('\n\n');
    }

    /**
     * Filter domain patterns relevant to the objective.
     */
    _filterPatterns(objective) {
        const lowerObj = objective.toLowerCase();
        return this.domainKnowledge.patterns.filter(p => {
            const keywords = p.split('-');
            return keywords.some(kw => lowerObj.includes(kw));
        });
    }

    /**
     * Select applicable global rules based on agent input.
     */
    _selectRules(agentInput) {
        const rules = [...this.globalRules];

        // Add constraint-based rules
        if (agentInput.constraints?.includes('validation:required')) {
            rules.push('All outputs must pass validation before returning');
        }
        if (agentInput.constraints?.includes('brevity:high')) {
            rules.push('Keep responses concise — prioritize actionable content');
        }

        return rules;
    }

    /**
     * Build minimal context string for token efficiency.
     */
    _buildContext(agentInput, memorySystem) {
        const parts = [];

        parts.push(`Task: ${agentInput.objective}`);
        parts.push(`Cluster: ${this.cluster}`);
        parts.push(`Skills: ${this.skills.join(', ')}`);
        parts.push(`Complexity: ${agentInput.complexityLevel || 'medium'}`);

        if (agentInput.dependencies?.length > 0) {
            parts.push(`Dependencies: ${agentInput.dependencies.join(', ')}`);
        }

        // Pull relevant memory entries if available
        if (memorySystem) {
            const patterns = memorySystem.getLearnedPatterns?.() || [];
            const relevant = patterns
                .filter(p => p.cluster === this.cluster || !p.cluster)
                .slice(0, 3);
            if (relevant.length > 0) {
                parts.push('Learned patterns: ' +
                    relevant.map(p => p.pattern).join('; '));
            }
        }

        return parts.join('\n');
    }

    /**
     * Get a summary of available knowledge for debugging.
     */
    getSummary() {
        return {
            cluster: this.cluster,
            principleCount: this.domainKnowledge.principles.length,
            patternCount: this.domainKnowledge.patterns.length,
            globalRuleCount: this.globalRules.length,
            cacheSize: this._cache.size,
        };
    }
}
