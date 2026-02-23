/**
 * Agent Registry
 * 
 * Structured registry of all available agents organized by cluster.
 * Each agent has: id, role, skills, complexity support, performance metrics.
 * 
 * Cluster Types:
 *   1. Research Cluster    — information gathering, analysis
 *   2. Coding Cluster      — code generation, debugging, refactoring
 *   3. DevOps Cluster      — deployment, infrastructure, CI/CD
 *   4. UI/UX Cluster       — design, frontend, styling
 *   5. Analysis Cluster    — performance, testing, auditing
 *   6. Memory & Evaluation — meta-analysis, optimization tracking
 */

export class AgentRegistry {
    constructor() {
        /** @type {Map<string, Agent>} */
        this.agents = new Map();

        /** @type {Map<string, Cluster>} */
        this.clusters = new Map();

        // Initialize default agents
        this.initializeDefaults();
    }

    initializeDefaults() {
        // ─── Research Cluster ─────────────────────────
        this.registerCluster('research', {
            name: 'Research Cluster',
            description: 'Information gathering, documentation, and analysis',
        });

        this.registerAgent({
            id: 'researcher_v1',
            role: 'research_analyst',
            cluster: 'research',
            skills: ['web-search', 'documentation', 'summarization', 'comparison'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.85,
            avgExecutionTime: 2.0,
        });

        this.registerAgent({
            id: 'planner_v1',
            role: 'architect',
            cluster: 'research',
            skills: ['architecture', 'planning', 'decomposition', 'roadmap'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.80,
            avgExecutionTime: 3.0,
        });

        // ─── Coding Cluster ──────────────────────────
        this.registerCluster('coding', {
            name: 'Coding Cluster',
            description: 'Code generation, debugging, refactoring, testing',
        });

        this.registerAgent({
            id: 'code_agent_v2',
            role: 'backend_engineer',
            cluster: 'coding',
            skills: ['nodejs', 'api', 'database', 'typescript', 'python'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.87,
            avgExecutionTime: 3.4,
        });

        this.registerAgent({
            id: 'code_reviewer_v1',
            role: 'code_reviewer',
            cluster: 'coding',
            skills: ['review', 'security-audit', 'best-practices', 'optimization'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.82,
            avgExecutionTime: 2.1,
        });

        this.registerAgent({
            id: 'debugger_v1',
            role: 'debugger',
            cluster: 'coding',
            skills: ['debugging', 'error-trace', 'fix', 'testing'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.79,
            avgExecutionTime: 2.8,
        });

        // ─── DevOps Cluster ──────────────────────────
        this.registerCluster('devops', {
            name: 'DevOps Cluster',
            description: 'Deployment, infrastructure, CI/CD, monitoring',
        });

        this.registerAgent({
            id: 'devops_agent_v1',
            role: 'devops_engineer',
            cluster: 'devops',
            skills: ['docker', 'kubernetes', 'ci-cd', 'cloud', 'monitoring'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.81,
            avgExecutionTime: 4.2,
        });

        this.registerAgent({
            id: 'infra_agent_v1',
            role: 'infrastructure_engineer',
            cluster: 'devops',
            skills: ['aws', 'terraform', 'networking', 'security', 'scaling'],
            complexitySupported: ['complex'],
            confidenceScore: 0.76,
            avgExecutionTime: 5.0,
        });

        // ─── UI/UX Cluster ───────────────────────────
        this.registerCluster('uiux', {
            name: 'UI/UX Cluster',
            description: 'Design, frontend development, styling, animation',
        });

        this.registerAgent({
            id: 'frontend_agent_v1',
            role: 'frontend_engineer',
            cluster: 'uiux',
            skills: ['react', 'css', 'html', 'javascript', 'responsive-design'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.84,
            avgExecutionTime: 3.0,
        });

        this.registerAgent({
            id: 'designer_agent_v1',
            role: 'ux_designer',
            cluster: 'uiux',
            skills: ['wireframe', 'mockup', 'color-theory', 'accessibility', 'layout'],
            complexitySupported: ['simple', 'medium'],
            confidenceScore: 0.78,
            avgExecutionTime: 2.5,
        });

        // ─── Analysis Cluster ────────────────────────
        this.registerCluster('analysis', {
            name: 'Analysis Cluster',
            description: 'Performance analysis, testing, auditing, benchmarks',
        });

        this.registerAgent({
            id: 'test_agent_v1',
            role: 'test_engineer',
            cluster: 'analysis',
            skills: ['unit-testing', 'integration-testing', 'e2e', 'coverage'],
            complexitySupported: ['simple', 'medium', 'complex'],
            confidenceScore: 0.83,
            avgExecutionTime: 2.5,
        });

        this.registerAgent({
            id: 'performance_agent_v1',
            role: 'performance_analyst',
            cluster: 'analysis',
            skills: ['profiling', 'benchmark', 'optimization', 'bottleneck-analysis'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.80,
            avgExecutionTime: 4.0,
        });

        // ─── Memory & Evaluation Cluster ─────────────
        this.registerCluster('evaluation', {
            name: 'Memory & Evaluation Cluster',
            description: 'Meta-analysis, optimization tracking, pattern recognition',
        });

        this.registerAgent({
            id: 'evaluator_agent_v1',
            role: 'meta_evaluator',
            cluster: 'evaluation',
            skills: ['quality-check', 'cross-validation', 'consistency-check'],
            complexitySupported: ['medium', 'complex'],
            confidenceScore: 0.85,
            avgExecutionTime: 1.5,
        });
    }

    /**
     * Register a new cluster
     */
    registerCluster(id, config) {
        this.clusters.set(id, {
            id,
            ...config,
            agents: [],
        });
    }

    /**
     * Register a new agent
     */
    registerAgent(agent) {
        const agentRecord = {
            ...agent,
            totalExecutions: 0,
            failureRate: 0,
            createdAt: Date.now(),
        };

        this.agents.set(agent.id, agentRecord);

        // Add to cluster
        const cluster = this.clusters.get(agent.cluster);
        if (cluster) {
            cluster.agents.push(agent.id);
        }
    }

    /**
     * Find agents matching criteria
     * @param {{ cluster?: string, skills?: string[], complexity?: string }} criteria
     * @returns {Agent[]}
     */
    findAgents(criteria = {}) {
        let candidates = [...this.agents.values()];

        if (criteria.cluster) {
            candidates = candidates.filter(a => a.cluster === criteria.cluster);
        }

        if (criteria.skills && criteria.skills.length > 0) {
            candidates = candidates.filter(a =>
                criteria.skills.some(skill => a.skills.includes(skill))
            );
        }

        if (criteria.complexity) {
            candidates = candidates.filter(a =>
                a.complexitySupported.includes(criteria.complexity)
            );
        }

        // Sort by confidence score (performance-aware routing)
        candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

        return candidates;
    }

    /**
     * Get agent by ID
     */
    getAgent(id) {
        return this.agents.get(id);
    }

    /**
     * Update agent performance metrics
     */
    updateAgentMetrics(agentId, metrics) {
        const agent = this.agents.get(agentId);
        if (!agent) return;

        agent.totalExecutions += 1;

        // Update average execution time (exponential moving average)
        const alpha = 0.3;
        agent.avgExecutionTime = agent.avgExecutionTime * (1 - alpha) + metrics.duration * alpha;

        // Update failure rate
        if (metrics.failed) {
            agent.failureRate = agent.failureRate * (1 - alpha) + alpha;
        } else {
            agent.failureRate = agent.failureRate * (1 - alpha);
        }

        // Update confidence score based on performance
        if (!metrics.failed && metrics.duration < agent.avgExecutionTime) {
            agent.confidenceScore = Math.min(1.0, agent.confidenceScore + 0.02);
        } else if (metrics.failed) {
            agent.confidenceScore = Math.max(0.1, agent.confidenceScore - 0.05);
        }
    }

    /**
     * Get registry status
     */
    getStatus() {
        return {
            totalAgents: this.agents.size,
            totalClusters: this.clusters.size,
            clusters: [...this.clusters.values()].map(c => ({
                name: c.name,
                agentCount: c.agents.length,
            })),
        };
    }
}
