/**
 * APES Loop Controller
 *
 * Enables autonomous iterative execution until completion promise is met.
 * Similar to Claude Code's ralph-wiggum stop-hook pattern.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export class LoopController {
    constructor(options = {}) {
        this.completionPromise = options.completionPromise || null;
        this.maxIterations = options.maxIterations || 100;
        this.interval = options.interval || 0;
        this.verbose = options.verbose || false;
        this.stateFile = options.stateFile || path.join(os.tmpdir(), 'apes-loop-state.json');
        
        this.iteration = 0;
        this.lastOutput = '';
        this.lastError = '';
        this.startTime = null;
        this.completed = false;
        
        // ANSI color codes
        this.c = {
            green: '\x1b[32m',
            red: '\x1b[31m',
            yellow: '\x1b[33m',
            cyan: '\x1b[36m',
            dim: '\x1b[2m',
            bold: '\x1b[1m',
            reset: '\x1b[0m',
        };
    }

    /**
     * Run the loop until completion promise is met or max iterations reached
     * @param {string} task - The task to execute
     * @param {Function} executor - Function that executes APES and returns output
     * @returns {Promise<{success: boolean, iterations: number, output: string}>}
     */
    async run(task, executor) {
        this.startTime = Date.now();
        this._saveState();

        this._print('cyan', `\n🔄 APES Loop Started`);
        this._print('dim', `  Task: ${task.slice(0, 60)}${task.length > 60 ? '...' : ''}`);
        if (this.completionPromise) {
            this._print('dim', `  Completion promise: "${this.completionPromise}"`);
        }
        this._print('dim', `  Max iterations: ${this.maxIterations}`);
        if (this.interval > 0) {
            this._print('dim', `  Interval: ${this.interval}ms`);
        }
        console.log('');

        while (this.iteration < this.maxIterations) {
            this.iteration++;
            this._print('cyan', `\n${'─'.repeat(50)}`);
            this._print('cyan', `  Iteration ${this.iteration}/${this.maxIterations}`);
            this._print('cyan', `${'─'.repeat(50)}\n`);

            try {
                const result = await executor(task, this.iteration);
                this.lastOutput = result.output || '';
                this.lastError = result.error || '';

                if (this.verbose) {
                    console.log(this.lastOutput);
                }

                // Check for completion promise
                if (this.completionPromise && this._checkCompletion()) {
                    this.completed = true;
                    this._saveState();
                    this._print('green', `\n✅ Completion promise met!`);
                    this._print('dim', `  "${this.completionPromise}" found in output`);
                    this._print('dim', `  Total iterations: ${this.iteration}`);
                    this._print('dim', `  Total time: ${this._formatDuration()}`);
                    return {
                        success: true,
                        iterations: this.iteration,
                        output: this.lastOutput,
                    };
                }

                // Check if execution signaled completion
                if (result.completed) {
                    this.completed = true;
                    this._saveState();
                    this._print('green', `\n✅ Task completed!`);
                    this._print('dim', `  Total iterations: ${this.iteration}`);
                    this._print('dim', `  Total time: ${this._formatDuration()}`);
                    return {
                        success: true,
                        iterations: this.iteration,
                        output: this.lastOutput,
                    };
                }

            } catch (error) {
                this.lastError = error.message;
                this._print('red', `\n❌ Iteration ${this.iteration} failed: ${error.message}`);
                
                // Check if we should continue on error
                if (!this.continueOnError) {
                    this._saveState();
                    return {
                        success: false,
                        iterations: this.iteration,
                        output: this.lastOutput,
                        error: error.message,
                    };
                }
            }

            // Wait interval between iterations
            if (this.interval > 0 && this.iteration < this.maxIterations) {
                this._print('dim', `\n⏳ Waiting ${this.interval}ms before next iteration...`);
                await this._sleep(this.interval);
            }

            this._saveState();
        }

        // Max iterations reached
        this._print('yellow', `\n⚠️ Max iterations reached (${this.maxIterations})`);
        this._print('dim', `  Total time: ${this._formatDuration()}`);
        
        return {
            success: false,
            iterations: this.iteration,
            output: this.lastOutput,
            error: 'Max iterations reached',
        };
    }

    /**
     * Check if the completion promise string is in the output
     */
    _checkCompletion() {
        if (!this.completionPromise) return false;
        
        // Check in both stdout and stderr
        const combined = this.lastOutput + '\n' + this.lastError;
        
        // Support regex patterns if wrapped in //
        if (this.completionPromise.startsWith('/') && this.completionPromise.endsWith('/')) {
            try {
                const regex = new RegExp(this.completionPromise.slice(1, -1));
                return regex.test(combined);
            } catch {
                return combined.includes(this.completionPromise);
            }
        }
        
        return combined.includes(this.completionPromise);
    }

    /**
     * Sleep for specified milliseconds
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Format duration in human readable form
     */
    _formatDuration() {
        const ms = Date.now() - this.startTime;
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Print colored message
     */
    _print(color, message) {
        console.log(`${this.c[color] || ''}${message}${this.c.reset}`);
    }

    /**
     * Save state to file for persistence between runs
     */
    _saveState() {
        try {
            const state = {
                iteration: this.iteration,
                completed: this.completed,
                completionPromise: this.completionPromise,
                maxIterations: this.maxIterations,
                startTime: this.startTime,
                lastOutput: this.lastOutput.slice(-1000), // Keep last 1000 chars
                savedAt: new Date().toISOString(),
            };
            fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
        } catch {
            // Ignore state save errors
        }
    }

    /**
     * Load state from file
     */
    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
                this.iteration = state.iteration || 0;
                this.completed = state.completed || false;
                this.startTime = state.startTime || Date.now();
                this.lastOutput = state.lastOutput || '';
                return true;
            }
        } catch {
            // Ignore state load errors
        }
        return false;
    }

    /**
     * Clear saved state
     */
    clearState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                fs.unlinkSync(this.stateFile);
            }
        } catch {
            // Ignore state clear errors
        }
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            iteration: this.iteration,
            maxIterations: this.maxIterations,
            completed: this.completed,
            running: this.startTime !== null && !this.completed,
            duration: this.startTime ? Date.now() - this.startTime : 0,
            stateFile: this.stateFile,
        };
    }
}

/**
 * Create a LoopController from CLI arguments
 */
export function createLoopController(argv) {
    const options = {
        completionPromise: null,
        maxIterations: 100,
        interval: 0,
        verbose: false,
        continueOnError: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        
        if (arg === '--completion-promise' || arg === '-p') {
            options.completionPromise = argv[++i] || null;
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
        }
    }

    return options;
}
