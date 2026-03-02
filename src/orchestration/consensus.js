/**
 * Consensus Engine — Distributed Coordination Protocols
 *
 * Provides APES with distributed consensus primitives for multi-terminal
 * and multi-agent coordination:
 *
 *   1. Raft-style Leader Election   — Used for task ownership and state changes
 *   2. CRDT State Synchronization   — Conflict-free replicated data for eventually consistent state
 *   3. Gossip Protocol              — Lightweight agent health and status propagation
 *
 * All protocols operate over the MessageBus for transport.
 */

import { EventEmitter } from 'node:events';

// ─── Raft States ──────────────────────────────────────────────────
const RAFT_STATE = Object.freeze({
    FOLLOWER: 'follower',
    CANDIDATE: 'candidate',
    LEADER: 'leader',
});

/**
 * ─── CRDT: G-Counter (Grow-Only Counter) ──────────────────────────
 * Used for tracking task completion counts across terminals.
 */
export class GCounter {
    constructor(nodeId) {
        this.nodeId = nodeId;
        /** @type {Map<string, number>} node → count */
        this.state = new Map();
    }

    increment(amount = 1) {
        const current = this.state.get(this.nodeId) || 0;
        this.state.set(this.nodeId, current + amount);
    }

    value() {
        let total = 0;
        for (const v of this.state.values()) total += v;
        return total;
    }

    merge(other) {
        for (const [node, count] of other.state) {
            const current = this.state.get(node) || 0;
            this.state.set(node, Math.max(current, count));
        }
    }

    toJSON() {
        return Object.fromEntries(this.state);
    }

    static fromJSON(nodeId, json) {
        const c = new GCounter(nodeId);
        c.state = new Map(Object.entries(json));
        return c;
    }
}

/**
 * ─── CRDT: LWW-Register (Last-Writer-Wins) ───────────────────────
 * Used for shared state fields (task status, assignments, etc.)
 */
export class LWWRegister {
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.value = null;
        this.timestamp = 0;
    }

    set(value) {
        this.value = value;
        this.timestamp = Date.now();
    }

    merge(other) {
        if (other.timestamp > this.timestamp) {
            this.value = other.value;
            this.timestamp = other.timestamp;
        }
    }

    toJSON() {
        return { value: this.value, timestamp: this.timestamp, nodeId: this.nodeId };
    }

    static fromJSON(nodeId, json) {
        const r = new LWWRegister(nodeId);
        r.value = json.value;
        r.timestamp = json.timestamp;
        return r;
    }
}

/**
 * ─── CRDT: OR-Set (Observed-Remove Set) ───────────────────────────
 * Used for distributed agent lists and task sets.
 */
export class ORSet {
    constructor(nodeId) {
        this.nodeId = nodeId;
        /** @type {Map<string, Set<string>>} element → set of unique tags */
        this.elements = new Map();
        /** @type {Set<string>} removed tags */
        this.tombstones = new Set();
        this._tagCounter = 0;
    }

    add(element) {
        const tag = `${this.nodeId}:${++this._tagCounter}`;
        if (!this.elements.has(element)) {
            this.elements.set(element, new Set());
        }
        this.elements.get(element).add(tag);
    }

    remove(element) {
        const tags = this.elements.get(element);
        if (tags) {
            for (const tag of tags) this.tombstones.add(tag);
            this.elements.delete(element);
        }
    }

    has(element) {
        return this.elements.has(element);
    }

    values() {
        return [...this.elements.keys()];
    }

    merge(other) {
        // Merge tombstones
        for (const tag of other.tombstones) this.tombstones.add(tag);

        // Merge elements — keep only non-tombstoned tags
        for (const [elem, tags] of other.elements) {
            if (!this.elements.has(elem)) {
                this.elements.set(elem, new Set());
            }
            const localTags = this.elements.get(elem);
            for (const tag of tags) {
                if (!this.tombstones.has(tag)) {
                    localTags.add(tag);
                }
            }
        }

        // Clean our own elements
        for (const [elem, tags] of this.elements) {
            for (const tag of tags) {
                if (this.tombstones.has(tag)) tags.delete(tag);
            }
            if (tags.size === 0) this.elements.delete(elem);
        }
    }
}


/**
 * ─── Consensus Engine (Main Class) ────────────────────────────────
 */
export class ConsensusEngine extends EventEmitter {
    /**
     * @param {object} opts
     * @param {string} opts.nodeId — Unique ID for this terminal/process
     * @param {import('../communication/message-bus.js').MessageBus} opts.messageBus
     */
    constructor({ nodeId, messageBus }) {
        super();
        this.nodeId = nodeId;
        this.messageBus = messageBus;

        // ─── Raft state ──────────────────────────
        this.raftState = RAFT_STATE.FOLLOWER;
        this.currentTerm = 0;
        this.votedFor = null;
        this.leaderId = null;
        this.votes = new Set();
        this.peers = new Set();      // known peer node IDs

        // ─── CRDTs ──────────────────────────────
        /** @type {Map<string, GCounter|LWWRegister|ORSet>} name → CRDT */
        this.crdts = new Map();

        // ─── Gossip ──────────────────────────────
        /** @type {Map<string, object>} nodeId → latest status */
        this.gossipState = new Map();
        this._gossipInterval = null;

        // ─── Timers ──────────────────────────────
        this._electionTimeout = null;
        this._heartbeatInterval = null;

        // Subscribe to consensus messages on the bus
        this._setupSubscriptions();
    }

    // ─── Lifecycle ────────────────────────────────────────────────

    start() {
        this.gossipState.set(this.nodeId, {
            nodeId: this.nodeId,
            state: 'active',
            timestamp: Date.now(),
        });

        this._startElectionTimer();
        this._startGossip();
        this.emit('consensus:started', { nodeId: this.nodeId });
    }

    stop() {
        clearTimeout(this._electionTimeout);
        clearInterval(this._heartbeatInterval);
        clearInterval(this._gossipInterval);
        this.emit('consensus:stopped', { nodeId: this.nodeId });
    }

    // ─── Raft: Leader Election ────────────────────────────────────

    /**
     * Start an election (become candidate).
     */
    startElection() {
        this.currentTerm++;
        this.raftState = RAFT_STATE.CANDIDATE;
        this.votedFor = this.nodeId;
        this.votes = new Set([this.nodeId]);

        this.messageBus.publish({
            channel: 'consensus:raft',
            fromAgentId: this.nodeId,
            type: 'requestVote',
            content: JSON.stringify({ term: this.currentTerm, candidateId: this.nodeId }),
        });

        this._startElectionTimer();
        this.emit('raft:election-started', { term: this.currentTerm });
    }

    /** @private */
    _handleVoteRequest(msg) {
        const { term, candidateId } = JSON.parse(msg.content);
        if (term > this.currentTerm) {
            this.currentTerm = term;
            this.raftState = RAFT_STATE.FOLLOWER;
        }

        if (term >= this.currentTerm && (this.votedFor === null || this.votedFor === candidateId)) {
            this.votedFor = candidateId;
            this.messageBus.publish({
                channel: 'consensus:raft',
                fromAgentId: this.nodeId,
                toAgentId: candidateId,
                type: 'voteGranted',
                content: JSON.stringify({ term: this.currentTerm, voterId: this.nodeId }),
            });
        }
    }

    /** @private */
    _handleVoteGranted(msg) {
        if (this.raftState !== RAFT_STATE.CANDIDATE) return;
        const { voterId } = JSON.parse(msg.content);
        this.votes.add(voterId);

        const majority = Math.floor((this.peers.size + 1) / 2) + 1;
        if (this.votes.size >= majority) {
            this.raftState = RAFT_STATE.LEADER;
            this.leaderId = this.nodeId;
            clearTimeout(this._electionTimeout);
            this._startHeartbeat();
            this.emit('raft:leader-elected', { leaderId: this.nodeId, term: this.currentTerm });
        }
    }

    /** @private */
    _startElectionTimer() {
        clearTimeout(this._electionTimeout);
        // Randomized timeout: 150–300ms (in production; here use 3–6s for long agent cycles)
        const timeout = 3000 + Math.random() * 3000;
        this._electionTimeout = setTimeout(() => {
            if (this.raftState !== RAFT_STATE.LEADER) {
                this.startElection();
            }
        }, timeout);
        if (this._electionTimeout.unref) this._electionTimeout.unref();
    }

    /** @private */
    _startHeartbeat() {
        clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = setInterval(() => {
            this.messageBus.publish({
                channel: 'consensus:raft',
                fromAgentId: this.nodeId,
                type: 'heartbeat',
                content: JSON.stringify({ term: this.currentTerm, leaderId: this.nodeId }),
            });
        }, 2000);
        if (this._heartbeatInterval.unref) this._heartbeatInterval.unref();
    }

    /** @private */
    _handleHeartbeat(msg) {
        const { term, leaderId } = JSON.parse(msg.content);
        if (term >= this.currentTerm) {
            this.currentTerm = term;
            this.raftState = RAFT_STATE.FOLLOWER;
            this.leaderId = leaderId;
            this._startElectionTimer(); // reset election timer
        }
    }

    // ─── CRDT Management ──────────────────────────────────────────

    /**
     * Create a named CRDT.
     * @param {string} name
     * @param {'gcounter'|'lww'|'orset'} type
     * @returns {GCounter|LWWRegister|ORSet}
     */
    createCRDT(name, type) {
        let crdt;
        switch (type) {
            case 'gcounter': crdt = new GCounter(this.nodeId); break;
            case 'lww': crdt = new LWWRegister(this.nodeId); break;
            case 'orset': crdt = new ORSet(this.nodeId); break;
            default: throw new Error(`Unknown CRDT type: ${type}`);
        }
        this.crdts.set(name, crdt);
        return crdt;
    }

    /**
     * Get a named CRDT.
     * @param {string} name
     */
    getCRDT(name) {
        return this.crdts.get(name);
    }

    /**
     * Broadcast a CRDT state for merging on other nodes.
     * @param {string} name
     */
    syncCRDT(name) {
        const crdt = this.crdts.get(name);
        if (!crdt) return;

        this.messageBus.publish({
            channel: 'consensus:crdt',
            fromAgentId: this.nodeId,
            type: 'crdt-sync',
            content: JSON.stringify({
                name,
                crdtType: crdt.constructor.name,
                state: crdt.toJSON ? crdt.toJSON() : null,
            }),
        });
    }

    // ─── Gossip Protocol ──────────────────────────────────────────

    /** @private */
    _startGossip() {
        this._gossipInterval = setInterval(() => {
            // Update own status
            this.gossipState.set(this.nodeId, {
                nodeId: this.nodeId,
                state: 'active',
                raftState: this.raftState,
                leaderId: this.leaderId,
                timestamp: Date.now(),
            });

            // Broadcast
            this.messageBus.publish({
                channel: 'consensus:gossip',
                fromAgentId: this.nodeId,
                type: 'gossip',
                content: JSON.stringify([...this.gossipState.values()]),
            });
        }, 5000);

        if (this._gossipInterval.unref) this._gossipInterval.unref();
    }

    /** @private */
    _handleGossip(msg) {
        try {
            const states = JSON.parse(msg.content);
            for (const s of states) {
                const existing = this.gossipState.get(s.nodeId);
                if (!existing || s.timestamp > existing.timestamp) {
                    this.gossipState.set(s.nodeId, s);
                    this.peers.add(s.nodeId);
                }
            }
        } catch { /* malformed gossip */ }
    }

    // ─── Message Bus Subscriptions ────────────────────────────────

    /** @private */
    _setupSubscriptions() {
        this.messageBus.subscribe('consensus:raft', (msg) => {
            if (msg.fromAgentId === this.nodeId) return; // ignore own messages
            switch (msg.type) {
                case 'requestVote': this._handleVoteRequest(msg); break;
                case 'voteGranted': this._handleVoteGranted(msg); break;
                case 'heartbeat': this._handleHeartbeat(msg); break;
            }
        });

        this.messageBus.subscribe('consensus:gossip', (msg) => {
            if (msg.fromAgentId === this.nodeId) return;
            this._handleGossip(msg);
        });
    }

    // ─── Queries ──────────────────────────────────────────────────

    isLeader() {
        return this.raftState === RAFT_STATE.LEADER;
    }

    getLeader() {
        return this.leaderId;
    }

    getStatus() {
        return {
            nodeId: this.nodeId,
            raftState: this.raftState,
            currentTerm: this.currentTerm,
            leaderId: this.leaderId,
            peers: [...this.peers],
            crdts: [...this.crdts.keys()],
            gossipNodes: this.gossipState.size,
        };
    }
}
