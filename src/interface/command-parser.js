/**
 * Command Parser
 * 
 * Parses CLI arguments into structured command objects.
 * Supports: task execution, interactive mode, status, help
 */

export class CommandParser {
    constructor() {
        this.commands = new Map([
            ['--help', 'help'],
            ['-h', 'help'],
            ['--status', 'status'],
            ['-s', 'status'],
            ['--interactive', 'interactive'],
            ['-i', 'interactive'],
        ]);
    }

    /**
     * @param {string[]} argv - Raw CLI arguments
     * @returns {{ type: string, input?: string, flags?: object }}
     */
    parse(argv) {
        if (argv.length === 0) {
            return { type: 'interactive' };
        }

        const first = argv[0];

        // Check for known command flags
        if (this.commands.has(first)) {
            return { type: this.commands.get(first) };
        }

        // Check for subcommands
        if (first === 'run' || first === 'exec') {
            return {
                type: 'task',
                input: argv.slice(1).join(' '),
                flags: this.extractFlags(argv.slice(1)),
            };
        }

        if (first === 'status') {
            return { type: 'status' };
        }

        // Raw input — treat as task
        return {
            type: 'raw',
            input: argv.join(' '),
            flags: this.extractFlags(argv),
        };
    }

    extractFlags(argv) {
        const flags = {};
        for (const arg of argv) {
            if (arg.startsWith('--')) {
                const [key, value] = arg.slice(2).split('=');
                flags[key] = value ?? true;
            }
        }
        return flags;
    }
}
