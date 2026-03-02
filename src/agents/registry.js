/**
 * Agent Registry
 *
 * Structured registry of all available agents organized by cluster.
 * Each agent has: id, role, skills, complexity support, performance metrics.
 *
 * Cluster Types (8 clusters, 64 agents):
 *   1. Strategic Planning       — architecture, roadmaps, decomposition, risk
 *   2. Research Intelligence    — analysis, data gathering, domain expertise
 *   3. Engineering              — backend, frontend, fullstack, systems
 *   4. Code Quality             — review, debugging, refactoring, standards
 *   5. Version Control          — git, CI/CD, release management
 *   6. Execution Automation     — devops, infrastructure, deployment, monitoring
 *   7. Memory Learning          — pattern recognition, optimization, evaluation
 *   8. Control Safety           — validation, security, compliance, auditing
 */

import { getDefaultAgents, getDefaultClusters, LEGACY_CLUSTER_MAP } from './agent-definitions.js';

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
        // Register all 8 clusters
        for (const cluster of getDefaultClusters()) {
            this.registerCluster(cluster.id, {
                name: cluster.name,
                description: cluster.description,
            });
        }

        // Register all 64 agents
        for (const agent of getDefaultAgents()) {
            this.registerAgent(agent);
        }
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
     * Resolve a cluster ID, supporting legacy 6-cluster IDs.
     * @param {string} clusterId
     * @returns {string}
     */
    resolveCluster(clusterId) {
        if (this.clusters.has(clusterId)) return clusterId;
        return LEGACY_CLUSTER_MAP[clusterId] ?? clusterId;
    }

    /**
     * Find agents matching criteria.
     *
     * When a cluster filter is present we look up only the agents in that
     * cluster via the cluster → agent-id index stored in `this.clusters`,
     * reducing the scan from O(64) to O(cluster_size) (~8 agents on average).
     *
     * @param {{ cluster?: string, skills?: string[], complexity?: string }} criteria
     * @returns {Agent[]}
     */
    findAgents(criteria = {}) {
        let candidates;

        if (criteria.cluster) {
            const resolved = this.resolveCluster(criteria.cluster);
            const clusterRecord = this.clusters.get(resolved);
            if (clusterRecord) {
                // O(cluster_size) — typically 8 agents rather than 64
                candidates = clusterRecord.agents
                    .map(id => this.agents.get(id))
                    .filter(Boolean);
            } else {
                candidates = [];
            }
        } else {
            candidates = [...this.agents.values()];
        }

        if (criteria.skills && criteria.skills.length > 0) {
            const skillSet = new Set(criteria.skills); // O(1) lookup per agent skill
            candidates = candidates.filter(a =>
                a.skills.some(skill => skillSet.has(skill))
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
