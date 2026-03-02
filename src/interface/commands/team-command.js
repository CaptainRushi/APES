/**
 * Team Command
 *
 * Handles /team subcommands for team management.
 *
 * Subcommands:
 *   /team create [name]          Create a new team
 *   /team list                   List all teams
 *   /team spawn <id> <agents>    Spawn agents into a team
 *   /team assign <id> <task>     Assign a task to a team
 *   /team message <id> <from> <to> <msg>  Send message within team
 *   /team shutdown <id>          Shutdown a team
 *   /team cleanup <id>           Remove a team
 *   /team help                   Show command reference
 */

const A = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', gray: '\x1b[90m',
    brightGreen: '\x1b[92m', brightCyan: '\x1b[96m',
};
const c  = (col, txt) => `${A[col]}${txt}${A.reset}`;
const hr = (n = 58)   => c('gray', '─'.repeat(n));
const pr = (...a)     => console.log(...a);

export class TeamCommand {
    /**
     * @param {import('../../teams/team-manager.js').TeamManager} teamManager
     * @param {import('../../communication/message-bus.js').MessageBus} messageBus
     */
    constructor(teamManager, messageBus) {
        this.teamManager = teamManager;
        this.messageBus  = messageBus;
    }

    /**
     * Entry point — called from CLI with the words after "/team".
     * @param {string[]} args
     * @param {import('readline').Interface} rl
     */
    async execute(args, rl) {
        const sub = (args[0] ?? 'help').toLowerCase();

        switch (sub) {
            case 'create':
                await this._create(args.slice(1), rl);
                break;
            case 'list': case 'ls':
                this._list();
                break;
            case 'spawn':
                this._spawn(args[1], args.slice(2));
                break;
            case 'assign':
                this._assign(args[1], args.slice(2).join(' '));
                break;
            case 'message': case 'msg':
                this._message(args[1], args[2], args[3], args.slice(4).join(' '));
                break;
            case 'shutdown':
                this._shutdown(args[1]);
                break;
            case 'cleanup':
                this._cleanup(args[1]);
                break;
            case 'info': case 'show':
                this._info(args[1]);
                break;
            case 'help':
                this._help();
                break;
            default:
                pr(`\n  ${c('red', '✗')} Unknown subcommand: ${c('yellow', sub)}`);
                pr(`  Run ${c('cyan', '/team help')} to see all commands.\n`);
        }
    }

    async _create(args, rl) {
        const name = args.join(' ') || undefined;

        pr(`\n  ${c('bold', c('brightCyan', '✦ Create Team'))}`);
        pr(`  ${hr(50)}`);

        let objective = '';
        if (rl) {
            objective = await new Promise(resolve =>
                rl.question(`  ${c('yellow', '?')} Team objective ${c('dim', '(optional)')}: `, a => resolve(a.trim()))
            );
        }

        try {
            const team = this.teamManager.create({ name, objective });
            pr(`\n  ${c('brightGreen', '✓')} Team created: ${c('bold', team.name)}`);
            pr(`  ${c('dim', 'ID:')} ${team.id}`);
            if (team.objective) pr(`  ${c('dim', 'Objective:')} ${team.objective}`);
            pr('');
        } catch (err) {
            pr(`\n  ${c('red', '✗')} Failed to create team: ${err.message}\n`);
        }
    }

    _list() {
        const teams = this.teamManager.list();

        pr(`\n  ${c('bold', c('brightCyan', '✦ Teams'))}`);
        pr(`  ${hr(58)}`);

        if (teams.length === 0) {
            pr(`\n  ${c('dim', 'No teams created yet.')}`);
            pr(`  Run ${c('cyan', '/team create')} to create a team.\n`);
            return;
        }

        for (const team of teams) {
            const statusColor = team.status === 'active' ? 'brightGreen'
                              : team.status === 'shutdown' ? 'red'
                              : 'yellow';
            const dot = team.status === 'active' ? c('brightGreen', '●')
                      : team.status === 'shutdown' ? c('red', '●')
                      : c('yellow', '●');

            pr('');
            pr(`  ${dot} ${c('bold', team.name)}  ${c(statusColor, `[${team.status}]`)}`);
            pr(`    ${c('dim', 'ID:')} ${team.id}`);
            pr(`    ${c('dim', 'Agents:')} ${team.agents?.length || 0}/${team.maxAgents || 8}`);
            if (team.objective) pr(`    ${c('dim', 'Objective:')} ${team.objective}`);
            if (team.taskQueue) {
                pr(`    ${c('dim', 'Tasks:')} ${c('yellow', team.taskQueue.pending + ' pending')} · ${c('cyan', team.taskQueue.claimed + ' claimed')} · ${c('green', team.taskQueue.completed + ' done')}`);
            }
        }

        pr('');
        pr(`  ${hr(58)}\n`);
    }

    _spawn(teamId, agentIds) {
        if (!teamId) {
            pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/team spawn <teamId> <agent1> [agent2] ...')}\n`);
            return;
        }
        if (agentIds.length === 0) {
            pr(`\n  ${c('red', '✗')} Provide at least one agent ID.\n`);
            return;
        }

        try {
            const config = this.teamManager.spawn(teamId, agentIds);
            pr(`\n  ${c('brightGreen', '✓')} Spawned ${agentIds.length} agent(s) into ${c('bold', config.name)}`);
            pr(`  ${c('dim', 'Active agents:')} ${config.agents.length}/${config.maxAgents}\n`);
        } catch (err) {
            pr(`\n  ${c('red', '✗')} ${err.message}\n`);
        }
    }

    _assign(teamId, taskDescription) {
        if (!teamId || !taskDescription) {
            pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/team assign <teamId> <task description>')}\n`);
            return;
        }

        const taskId = `task_${Date.now()}`;
        try {
            this.teamManager.assign(teamId, {
                id: taskId,
                description: taskDescription,
                priority: 5,
            });
            pr(`\n  ${c('brightGreen', '✓')} Task assigned to team: ${c('dim', taskDescription)}`);
            pr(`  ${c('dim', 'Task ID:')} ${taskId}\n`);
        } catch (err) {
            pr(`\n  ${c('red', '✗')} ${err.message}\n`);
        }
    }

    _message(teamId, fromAgent, toAgent, content) {
        if (!teamId || !fromAgent || !toAgent || !content) {
            pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/team message <teamId> <from> <to> <message>')}\n`);
            return;
        }

        try {
            this.teamManager.message(teamId, fromAgent, toAgent, content);
            pr(`\n  ${c('brightGreen', '✓')} Message sent: ${fromAgent} → ${toAgent}\n`);
        } catch (err) {
            pr(`\n  ${c('red', '✗')} ${err.message}\n`);
        }
    }

    _info(teamId) {
        if (!teamId) {
            pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/team info <teamId>')}\n`);
            return;
        }

        const team = this.teamManager.get(teamId);
        if (!team) {
            pr(`\n  ${c('red', '✗')} Team ${c('bold', teamId)} not found.\n`);
            return;
        }

        pr(`\n  ${c('bold', c('brightCyan', `✦ ${team.name}`))}`);
        pr(`  ${hr(50)}`);
        pr(`  ${c('dim', 'ID:')}        ${team.id}`);
        pr(`  ${c('dim', 'Status:')}    ${team.status}`);
        pr(`  ${c('dim', 'Agents:')}    ${team.agents?.length || 0}/${team.maxAgents || 8}`);
        if (team.objective) pr(`  ${c('dim', 'Objective:')} ${team.objective}`);
        if (team.agents?.length > 0) {
            pr(`  ${c('dim', 'Members:')}   ${team.agents.join(', ')}`);
        }
        if (team.taskQueue) {
            pr(`  ${c('dim', 'Queue:')}     ${team.taskQueue.pending} pending · ${team.taskQueue.claimed} claimed · ${team.taskQueue.completed} done`);
        }
        pr('');
    }

    _shutdown(teamId) {
        if (!teamId) {
            pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/team shutdown <teamId>')}\n`);
            return;
        }

        try {
            this.teamManager.shutdown(teamId);
            pr(`\n  ${c('yellow', '○')} Team ${c('bold', teamId)} shut down.\n`);
        } catch (err) {
            pr(`\n  ${c('red', '✗')} ${err.message}\n`);
        }
    }

    _cleanup(teamId) {
        if (!teamId) {
            pr(`\n  ${c('red', '✗')} Usage: ${c('cyan', '/team cleanup <teamId>')}\n`);
            return;
        }

        try {
            this.teamManager.cleanup(teamId);
            pr(`\n  ${c('brightGreen', '✓')} Team ${c('bold', teamId)} cleaned up.\n`);
        } catch (err) {
            pr(`\n  ${c('red', '✗')} ${err.message}\n`);
        }
    }

    _help() {
        pr(`
  ${c('bold', c('brightCyan', '✦ /team — Team Management'))}
  ${hr(58)}
  ${c('bold', 'Commands:')}
    ${c('cyan', '/team create')} ${c('green', '[name]')}                  Create a new team
    ${c('cyan', '/team list')}                             List all teams
    ${c('cyan', '/team info')} ${c('green', '<id>')}                     Show team details
    ${c('cyan', '/team spawn')} ${c('green', '<id> <agent1> [...]')}     Add agents to a team
    ${c('cyan', '/team assign')} ${c('green', '<id> <description>')}     Assign a task to a team
    ${c('cyan', '/team message')} ${c('green', '<id> <from> <to> <msg>')} Send inter-agent message
    ${c('cyan', '/team shutdown')} ${c('green', '<id>')}                  Shutdown a team
    ${c('cyan', '/team cleanup')} ${c('green', '<id>')}                   Remove a team permanently
    ${c('cyan', '/team help')}                             Show this reference
`);
    }
}
