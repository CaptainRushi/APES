/**
 * Swarm Manager — Dynamic Multi-Agent Topology Orchestration
 *
 * Manages swarm formation, topology switching, and agent coordination.
 *
 * Supported topologies:
 *   HIERARCHICAL — Tree: Lead → Sub-Leads → Agents (default, strict control)
 *   MESH         — Fully connected: all agents can communicate directly (collaborative debate)
 *   STAR         — Hub-spoke: Lead communicates with all, agents don't talk to each other
 *   RING         — Pipeline: sequential handoff (CI/CD style)
 *
 * Features:
 *   - Dynamic topology switching at runtime
 *   - Sub-swarm spawning for scaled workloads
 *   - Fault-tolerant agent failover
 *   - Health monitoring via heartbeats
 *   - Consensus-backed leader election
 */

import { EventEmitter } from 'node:events';

// ─── Topology Types ──────────────────────────────────────────────
export const TOPOLOGY = Object.freeze({
    HIERARCHICAL: 'hierarchical',
    MESH: 'mesh',
    STAR: 'star',
    RING: 'ring',
});

// ─── Agent States ────────────────────────────────────────────────
export const AGENT_STATE = Object.freeze({
    IDLE: 'idle',
    SPAWNING: 'spawning',
    RUNNING: 'running',
    WAITING: 'waiting',
    COMPLETED: 'completed',
    FAILED: 'failed',
    DEGRADED: 'degraded',
});

/**
 * @typedef {object} SwarmNode
 * @property {string}   agentId
 * @property {string}   role
 * @property {string}   state
 * @property {string[]} peers     - IDs of directly connected agents
 * @property {string|null} leaderId - Parent/leader agent (null if root)
 * @property {number}   heartbeat - Last heartbeat timestamp
 * @property {object}   metrics   - Live performance counters
 */

export class SwarmManager extends EventEmitter {
    /**
     * @param {object} opts
     * @param {import('../communication/message-bus.js').MessageBus} opts.messageBus
     * @param {import('../agents/registry.js').AgentRegistry} opts.registry
     * @param {string} [opts.topology='hierarchical']
     */
    constructor({ messageBus, registry, topology = TOPOLOGY.HIERARCHICAL } = {}) {
        super();
        this.messageBus = messageBus;
        this.registry = registry;
        this.topology = topology;

        /** @type {Map<string, SwarmNode>} */
        this.nodes = new Map();

        /** @type {Map<string, SwarmManager>} sub-swarm instances */
        this.subSwarms = new Map();

        /** Leader of the current swarm (null until elected) */
        this.leaderId = null;

        /** Heartbeat interval handle */
        this._heartbeatInterval = null;

        /** Configurable heartbeat period (ms) */
        this.heartbeatPeriodMs = 5000;

        /** Threshold before marking an agent degraded (ms) */
        this.degradedThresholdMs = 15000;
    }

    // ─── Lifecycle ────────────────────────────────────────────────

    /**
     * Initialize the swarm with a set of agent IDs.
     * @param {string[]} agentIds
     * @param {object}   [opts]
     * @param {string}   [opts.leaderId] - Explicit leader; auto-elected if omitted
     */
    initialize(agentIds, opts = {}) {
        this.nodes.clear();

        for (const id of agentIds) {
            this.nodes.set(id, {
                agentId: id,
                role: 'worker',
                state: AGENT_STATE.IDLE,
                peers: [],
                leaderId: null,
                heartbeat: Date.now(),
                metrics: { tasksCompleted: 0, tasksFailed: 0, avgLatencyMs: 0 },
            });
        }

        // Elect or assign leader
        this.leaderId = opts.leaderId || this._electLeader();
        const leaderNode = this.nodes.get(this.leaderId);
        if (leaderNode) leaderNode.role = 'leader';

        // Build topology edges
        this._buildTopology();

        // Start heartbeat monitor
        this._startHeartbeat();

        this.emit('swarm:initialized', {
            topology: this.topology,
            nodeCount: this.nodes.size,
            leaderId: this.leaderId,
        });
    }

    /**
     * Gracefully shut down the swarm.
     */
    shutdown() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }

        // Shutdown sub-swarms
        for (const [id, sub] of this.subSwarms) {
            sub.shutdown();
        }
        this.subSwarms.clear();

        this.emit('swarm:shutdown', { topology: this.topology });
        this.nodes.clear();
    }

    // ─── Topology Management ──────────────────────────────────────

    /**
     * Switch topology at runtime (re-wires peer connections).
     * @param {string} newTopology - One of TOPOLOGY values
     */
    switchTopology(newTopology) {
        if (!Object.values(TOPOLOGY).includes(newTopology)) {
            throw new Error(`Unknown topology: ${newTopology}`);
        }
        const prev = this.topology;
        this.topology = newTopology;
        this._buildTopology();

        this.emit('swarm:topology-changed', { from: prev, to: newTopology });
    }

    /**
     * Build peer connections based on the current topology.
     * @private
     */
    _buildTopology() {
        const ids = [...this.nodes.keys()];

        switch (this.topology) {
            case TOPOLOGY.HIERARCHICAL:
                this._buildHierarchical(ids);
                break;
            case TOPOLOGY.MESH:
                this._buildMesh(ids);
                break;
            case TOPOLOGY.STAR:
                this._buildStar(ids);
                break;
            case TOPOLOGY.RING:
                this._buildRing(ids);
                break;
        }
    }

    /** Hierarchical: Leader → workers; workers can only talk to leader */
    _buildHierarchical(ids) {
        for (const id of ids) {
            const node = this.nodes.get(id);
            if (id === this.leaderId) {
                node.peers = ids.filter(i => i !== id);
                node.leaderId = null;
            } else {
                node.peers = [this.leaderId];
                node.leaderId = this.leaderId;
            }
        }
    }

    /** Mesh: every agent can reach every other agent */
    _buildMesh(ids) {
        for (const id of ids) {
            const node = this.nodes.get(id);
            node.peers = ids.filter(i => i !== id);
            node.leaderId = this.leaderId; // still aware of leader
        }
    }

    /** Star: only leader talks to agents, agents talk only to leader */
    _buildStar(ids) {
        for (const id of ids) {
            const node = this.nodes.get(id);
            if (id === this.leaderId) {
                node.peers = ids.filter(i => i !== id);
                node.leaderId = null;
            } else {
                node.peers = [this.leaderId];
                node.leaderId = this.leaderId;
            }
        }
    }

    /** Ring: each agent talks to its successor (circular pipeline) */
    _buildRing(ids) {
        for (let i = 0; i < ids.length; i++) {
            const node = this.nodes.get(ids[i]);
            const nextIdx = (i + 1) % ids.length;
            node.peers = [ids[nextIdx]];
            node.leaderId = this.leaderId;
        }
    }

    // ─── Agent Management ─────────────────────────────────────────

    /**
     * Register a new agent into the running swarm.
     * @param {string} agentId
     */
    addAgent(agentId) {
        if (this.nodes.has(agentId)) return;

        this.nodes.set(agentId, {
            agentId,
            role: 'worker',
            state: AGENT_STATE.IDLE,
            peers: [],
            leaderId: this.leaderId,
            heartbeat: Date.now(),
            metrics: { tasksCompleted: 0, tasksFailed: 0, avgLatencyMs: 0 },
        });

        // Re-wire topology
        this._buildTopology();
        this.emit('swarm:agent-added', { agentId });
    }

    /**
     * Remove an agent from the swarm (graceful exit or failure).
     * @param {string} agentId
     */
    removeAgent(agentId) {
        this.nodes.delete(agentId);

        // Re-elect leader if the leader left
        if (agentId === this.leaderId && this.nodes.size > 0) {
            this.leaderId = this._electLeader();
            const newLeader = this.nodes.get(this.leaderId);
            if (newLeader) newLeader.role = 'leader';
            this.emit('swarm:leader-changed', { newLeaderId: this.leaderId });
        }

        this._buildTopology();
        this.emit('swarm:agent-removed', { agentId });
    }

    /**
     * Update an agent's state.
     * @param {string} agentId
     * @param {string} newState
     */
    setAgentState(agentId, newState) {
        const node = this.nodes.get(agentId);
        if (!node) return;
        const prev = node.state;
        node.state = newState;
        node.heartbeat = Date.now();

        this.emit('swarm:agent-state', { agentId, from: prev, to: newState });
    }

    /**
     * Record a heartbeat from an agent.
     * @param {string} agentId
     * @param {object} [metrics]
     */
    heartbeat(agentId, metrics = {}) {
        const node = this.nodes.get(agentId);
        if (!node) return;
        node.heartbeat = Date.now();
        if (node.state === AGENT_STATE.DEGRADED) {
            node.state = AGENT_STATE.RUNNING;
        }
        Object.assign(node.metrics, metrics);
    }

    // ─── Sub-Swarm Spawning ───────────────────────────────────────

    /**
     * Spawn a child swarm for a subset of agents (scale-out).
     * @param {string}   subSwarmId
     * @param {string[]} agentIds
     * @param {string}   [topology]
     * @returns {SwarmManager}
     */
    spawnSubSwarm(subSwarmId, agentIds, topology = TOPOLOGY.HIERARCHICAL) {
        const sub = new SwarmManager({
            messageBus: this.messageBus,
            registry: this.registry,
            topology,
        });
        sub.initialize(agentIds);
        this.subSwarms.set(subSwarmId, sub);

        this.emit('swarm:sub-spawned', { subSwarmId, agentIds, topology });
        return sub;
    }

    // ─── Leader Election ──────────────────────────────────────────

    /**
     * Simple leader election: pick the agent with the highest confidence
     * score from the registry, falling back to the first agent.
     * @returns {string}
     */
    _electLeader() {
        let bestId = null;
        let bestScore = -1;

        for (const [id] of this.nodes) {
            const agentDef = this.registry?.getAgent(id);
            const score = agentDef?.confidenceScore ?? 0.5;
            if (score > bestScore) {
                bestScore = score;
                bestId = id;
            }
        }

        return bestId || [...this.nodes.keys()][0];
    }

    // ─── Heartbeat Monitor ────────────────────────────────────────

    /** @private */
    _startHeartbeat() {
        if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);

        this._heartbeatInterval = setInterval(() => {
            const now = Date.now();
            for (const [id, node] of this.nodes) {
                if (node.state === AGENT_STATE.COMPLETED || node.state === AGENT_STATE.FAILED) continue;
                if (now - node.heartbeat > this.degradedThresholdMs) {
                    if (node.state !== AGENT_STATE.DEGRADED) {
                        node.state = AGENT_STATE.DEGRADED;
                        this.emit('swarm:agent-degraded', { agentId: id, lastHeartbeat: node.heartbeat });
                    }
                }
            }
        }, this.heartbeatPeriodMs);

        // Don't let heartbeat keep Node alive
        if (this._heartbeatInterval.unref) {
            this._heartbeatInterval.unref();
        }
    }

    // ─── Queries ──────────────────────────────────────────────────

    /**
     * Get all agents in a given state.
     * @param {string} state
     * @returns {SwarmNode[]}
     */
    getAgentsByState(state) {
        return [...this.nodes.values()].filter(n => n.state === state);
    }

    /**
     * Get peers for an agent.
     * @param {string} agentId
     * @returns {string[]}
     */
    getPeers(agentId) {
        return this.nodes.get(agentId)?.peers || [];
    }

    /**
     * Get a snapshot of the full swarm state.
     * @returns {object}
     */
    getStatus() {
        const stateCounts = {};
        for (const node of this.nodes.values()) {
            stateCounts[node.state] = (stateCounts[node.state] || 0) + 1;
        }

        return {
            topology: this.topology,
            leaderId: this.leaderId,
            nodeCount: this.nodes.size,
            subSwarms: this.subSwarms.size,
            stateCounts,
            nodes: [...this.nodes.values()].map(n => ({
                agentId: n.agentId,
                role: n.role,
                state: n.state,
                peers: n.peers.length,
            })),
        };
    }
}
