#!/usr/bin/env node

/**
 * APES Loop — Autonomous execution until completion promise is met
 * 
 * Usage:
 *   node bin/apes-loop.js "task description" --completion-promise "success string"
 *   node bin/apes-loop.js "task" -p "Typecheck passes" -n 50 -v
 * 
 * Options:
 *   -p, --completion-promise <string>  String that must appear in output to stop (required)
 *   -n, --max-iterations <number>      Maximum iterations (default: 100)
 *   -i, --interval <ms>               Wait between iterations in ms (default: 0)
 *   -v, --verbose                     Show all output
 *   --continue-on-error               Continue looping even if task fails
 */

import { CLI } from '../src/interface/cli.js';

const argv = process.argv.slice(2);

// Parse arguments
let task = '';
let options = {
    completionPromise: null,
    maxIterations: 100,
    interval: 0,
    verbose: false,
    continueOnError: false,
};

for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '--help' || arg === '-h') {
        console.log(`
APES Loop — Autonomous execution until completion promise is met

Usage:
  node bin/apes-loop.js "task description" --completion-promise "success string"
  node bin/apes-loop.js "build a REST API" -p "Typecheck passes" -n 50 -v

Options:
  -p, --completion-promise <string>  String that must appear in output to stop (required)
  -n, --max-iterations <number>     Maximum iterations (default: 100)
  -i, --interval <ms>                Wait between iterations in ms (default: 0)
  -v, --verbose                      Show all output
  --continue-on-error                 Continue looping even if task fails
  -h, --help                         Show this help message

Examples:
  # Run until "Typecheck passes" appears in output
  node bin/apes-loop.js "build a user authentication system" -p "Typecheck passes"
  
  # Run with regex pattern
  node bin/apes-loop.js "fix all bugs" -p "/Error:.*not found/"
  
  # Run with max 50 iterations and verbose output
  node bin/apes-loop.js "migrate database" -p "Migration complete" -n 50 -v
`);
        process.exit(0);
    }
    
    if (arg === '--completion-promise' || arg === '-p') {
        options.completionPromise = argv[++i];
    } else if (arg.startsWith('--completion-promise=')) {
        options.completionPromise = arg.split('=')[1];
    } else if (arg === '--max-iterations' || arg === '-n') {
        options.maxIterations = parseInt(argv[++i], 10) || 100;
    } else if (arg.startsWith('--max-iterations=')) {
        options.maxIterations = parseInt(arg.split('=')[1], 10) || 100;
    } else if (arg === '--interval' || arg === '-i') {
        options.interval = parseInt(argv[++i], 10) || 0;
    } else if (arg.startsWith('--interval=')) {
        options.interval = parseInt(arg.split('=')[1], 10) || 0;
    } else if (arg === '--verbose' || arg === '-v') {
        options.verbose = true;
    } else if (arg === '--continue-on-error') {
        options.continueOnError = true;
    } else if (!arg.startsWith('-')) {
        task = arg;
    }
}

// Validate
if (!task) {
    console.error('Error: No task specified');
    console.error('Usage: node bin/apes-loop.js "task" --completion-promise "string"');
    process.exit(1);
}

if (!options.completionPromise) {
    console.error('Error: --completion-promise is required');
    console.error('Usage: node bin/apes-loop.js "task" --completion-promise "string"');
    process.exit(1);
}

// Build command for CLI
const cliArgv = ['loop', task, 
    '--completion-promise', options.completionPromise,
    '--max-iterations', String(options.maxIterations),
];

if (options.interval > 0) {
    cliArgv.push('--interval', String(options.interval));
}
if (options.verbose) {
    cliArgv.push('--verbose');
}
if (options.continueOnError) {
    cliArgv.push('--continue-on-error');
}

// Run via CLI
const cli = new CLI();
cli.run(cliArgv).catch(err => {
    console.error('Loop execution failed:', err);
    process.exit(1);
});
