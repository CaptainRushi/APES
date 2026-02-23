/**
 * APES Interface Layer — CLI
 * 
 * Responsibilities:
 *   - Command parsing
 *   - Permission handling  
 *   - Session context management
 *   - Interactive approval system (write/edit/delete)
 */

import { CommandParser } from './command-parser.js';
import { PermissionHandler } from './permission-handler.js';
import { SessionContext } from './session-context.js';
import { Renderer } from './renderer.js';
import { Orchestrator } from '../orchestration/orchestrator.js';

export class CLI {
    constructor() {
        this.parser = new CommandParser();
        this.permissions = new PermissionHandler();
        this.session = new SessionContext();
        this.renderer = new Renderer();
        this.orchestrator = new Orchestrator();
    }

    async run(argv) {
        this.renderer.showBanner();

        const command = this.parser.parse(argv);

        if (command.type === 'help') {
            this.renderer.showHelp();
            return;
        }

        if (command.type === 'status') {
            await this.showStatus();
            return;
        }

        if (command.type === 'interactive') {
            await this.startInteractiveMode();
            return;
        }

        if (command.type === 'task') {
            await this.executeTask(command.input);
            return;
        }

        // Default: if raw input is given, treat it as a task
        if (command.type === 'raw') {
            await this.executeTask(command.input);
            return;
        }

        this.renderer.showHelp();
    }

    async executeTask(input) {
        this.session.startTask(input);
        this.renderer.showTaskStart(input);

        try {
            const result = await this.orchestrator.execute(input, {
                session: this.session,
                permissions: this.permissions,
                renderer: this.renderer,
            });

            this.renderer.showTaskResult(result);
            this.session.endTask(result);
        } catch (error) {
            this.renderer.showError(error);
            this.session.endTask({ error: error.message });
        }
    }

    async startInteractiveMode() {
        const readline = await import('node:readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        this.renderer.showInteractiveStart();

        const prompt = () => {
            rl.question(this.renderer.getPrompt(), async (input) => {
                const trimmed = input.trim();

                if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '.q') {
                    this.renderer.showGoodbye();
                    rl.close();
                    return;
                }

                if (trimmed === 'status') {
                    await this.showStatus();
                    prompt();
                    return;
                }

                if (trimmed === 'clear') {
                    console.clear();
                    this.renderer.showBanner();
                    prompt();
                    return;
                }

                if (trimmed.length === 0) {
                    prompt();
                    return;
                }

                await this.executeTask(trimmed);
                prompt();
            });
        };

        prompt();
    }

    async showStatus() {
        const status = {
            session: this.session.getStatus(),
            agents: this.orchestrator.registry.getStatus(),
            memory: this.orchestrator.memory.getStatus(),
        };
        this.renderer.showStatus(status);
    }
}
