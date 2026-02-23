#!/usr/bin/env node

/**
 * APES — Advanced Parallel Execution System
 * Entry point for the CLI
 */

import { CLI } from '../src/interface/cli.js';

const cli = new CLI();
cli.run(process.argv.slice(2));
