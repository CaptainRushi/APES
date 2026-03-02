/**
 * Team Manager
 *
 * Manages team lifecycle: create, spawn agents, assign tasks, shutdown, cleanup.
 * Teams are groups of agents that work together on a shared objective.
 */

import { TeamStore } from './team-store.js';
import { TaskClaimer } from './task-claimer.js';
import { Mailbox } from '../communication/mailbox.js';

export class TeamManager {
    /**
     * @param {import('../communication/message-bus.js').MessageBus} messageBus
     */
    constructor(messageBus) {
        this.messageBus = messageBus;
        this.store = new TeamStore();

        /** @type {Map<string, Team>} active teams in memory */
        this.teams = new Map();
    }

    /**
     * Create a new team.
     * @param {{ name?: string, objective?: string, clusters?: string[], maxAgents?: number }} options
     * @returns {object} Created team config
     */
    create(options = {}) {
        const id = `team_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const config = {
            id,
            name: options.name || `Team ${id.slice(-4)}`,
            objective: options.objective || '',
            clusters: options.clusters || [],
            maxAgents: options.maxAgents || 8,
            createdAt: Date.now(),
            status: 'created',
            agents: [],
        };

        this.store.save(id, config);

        const team = {
            config,
            mailboxes: new Map(),
            claimer: new TaskClaimer(id),
        };
        this.teams.set(id, team);

        return config;
    }

    /**
     * Spawn agents into a team.
     * @param {string} teamId
     * @param {string[]} agentIds
     * @returns {object} Updated team config
     */
    spawn(teamId, agentIds) {
        const team = this.teams.get(teamId);
        if (!team) throw new Error(`Team ${teamId} not found`);

        for (const agentId of agentIds) {
            if (team.config.agents.includes(agentId)) continue;
            if (team.config.agents.length >= team.config.maxAgents) break;

            team.config.agents.push(agentId);

            // Create mailbox for this agent within the team
            const mailbox = new Mailbox(agentId, this.messageBus, teamId);
            team.mailboxes.set(agentId, mailbox);
        }

        team.config.status = 'active';
        this.store.save(teamId, team.config);

        return team.config;
    }

    /**
     * Assign a task to a team's task queue.
     * @param {string} teamId
     * @param {{ id: string, description: string, priority?: number, cluster?: string }} task
     */
    assign(teamId, task) {
        const team = this.teams.get(teamId);
        if (!team) throw new Error(`Team ${teamId} not found`);

        team.claimer.addTask(task);

        // Broadcast task availability to team agents
        this.messageBus.publish({
            type: 'broadcast',
            channel: `cluster:${teamId}`,
            output: `New task available: ${task.description}`,
            taskId: task.id,
        });
    }

    /**
     * Have an agent claim the next available task.
     * @param {string} teamId
     * @param {string} agentId
     * @returns {object|null}
     */
    claimTask(teamId, agentId) {
        const team = this.teams.get(teamId);
        if (!team) return null;

        return team.claimer.claim(agentId);
    }

    /**
     * Send a message within a team.
     * @param {string} teamId
     * @param {string} fromAgentId
     * @param {string} toAgentId
     * @param {string} content
     */
    message(teamId, fromAgentId, toAgentId, content) {
        const team = this.teams.get(teamId);
        if (!team) throw new Error(`Team ${teamId} not found`);

        const mailbox = team.mailboxes.get(fromAgentId);
        if (mailbox) {
            return mailbox.send({
                type: 'query',
                toAgentId,
                output: content,
            });
        }

        // Fallback: direct bus publish
        return this.messageBus.publish({
            type: 'query',
            fromAgentId,
            toAgentId,
            channel: `agent:${toAgentId}`,
            output: content,
        });
    }

    /**
     * Shutdown a team — mark inactive, cleanup mailboxes.
     * @param {string} teamId
     */
    shutdown(teamId) {
        const team = this.teams.get(teamId);
        if (!team) return;

        // Destroy all mailboxes
        for (const mailbox of team.mailboxes.values()) {
            mailbox.destroy();
        }
        team.mailboxes.clear();

        team.config.status = 'shutdown';
        team.config.shutdownAt = Date.now();
        this.store.save(teamId, team.config);
    }

    /**
     * Cleanup a team — remove from memory.
     * @param {string} teamId
     */
    cleanup(teamId) {
        this.shutdown(teamId);
        this.teams.delete(teamId);
        this.store.delete(teamId);
    }

    /**
     * List all teams (active + stored).
     * @returns {object[]}
     */
    list() {
        const storedIds = this.store.list();
        const all = new Map();

        // Active teams
        for (const [id, team] of this.teams) {
            all.set(id, {
                ...team.config,
                taskQueue: team.claimer.getStatus(),
            });
        }

        // Stored-only teams
        for (const id of storedIds) {
            if (all.has(id)) continue;
            const config = this.store.load(id);
            if (config) all.set(id, config);
        }

        return [...all.values()];
    }

    /**
     * Get a specific team.
     * @param {string} teamId
     * @returns {object|null}
     */
    get(teamId) {
        const team = this.teams.get(teamId);
        if (team) {
            return {
                ...team.config,
                taskQueue: team.claimer.getStatus(),
            };
        }
        return this.store.load(teamId);
    }
}
