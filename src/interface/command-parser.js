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
            ['--clusters', 'clusters'],
            ['/clusters', 'clusters'],
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

        if (first === 'provider' || first === '/provider') {
            return { type: 'provider', args: argv.slice(1) };
        }

        // Loop subcommand - autonomous iterative execution
        if (first === 'loop' || first === '/loop') {
            const loopFlags = this.extractLoopFlags(argv.slice(1));
            return {
                type: 'loop',
                input: loopFlags.task,
                flags: loopFlags,
            };
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

    /**
     * Extract flags specific to loop command
     */
    extractLoopFlags(argv) {
        const flags = {
            completionPromise: null,
            maxIterations: 100,
            interval: 0,
            verbose: false,
            continueOnError: false,
            task: '',
        };

        const remaining = [];
        
        for (let i = 0; i < argv.length; i++) {
            const arg = argv[i];
            
            if (arg === '--completion-promise' || arg === '-p') {
                flags.completionPromise = argv[++i] || null;
            } else if (arg.startsWith('--completion-promise=')) {
                flags.completionPromise = arg.split('=')[1];
            } else if (arg === '--max-iterations' || arg === '-n') {
                flags.maxIterations = parseInt(argv[++i], 10) || 100;
            } else if (arg.startsWith('--max-iterations=')) {
                flags.maxIterations = parseInt(arg.split('=')[1], 10) || 100;
            } else if (arg === '--interval' || arg === '-i') {
                flags.interval = parseInt(argv[++i], 10) || 0;
            } else if (arg.startsWith('--interval=')) {
                flags.interval = parseInt(arg.split('=')[1], 10) || 0;
            } else if (arg === '--verbose' || arg === '-v') {
                flags.verbose = true;
            } else if (arg === '--continue-on-error') {
                flags.continueOnError = true;
            } else if (!arg.startsWith('-')) {
                remaining.push(arg);
            }
        }

        flags.task = remaining.join(' ');
        return flags;
    }
}
