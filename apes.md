# Project Overview
APES — Advanced Parallel Execution System v2.0

# Rules
- Pure ESM — use `"type": "module"` and `.js` extensions on all imports
- Zero dependencies — use only Node.js builtins
- ANSI colors use raw `\x1b[...]` escape sequences, no external color libraries
- Never use `Date.now()` directly in executor code — use injectable clock
- All async operations must check AbortSignal for cancellation
- WorkerPool must never exceed configured concurrency limit

# Conventions
- Optional chaining for animation: `context.animationEngine?.method()`
- Message bus injection via `context.messageBus`
- Workspace permissions per cluster defined in agent-definitions.js
- Snake_case for agent IDs, camelCase for methods
- All tests use Node.js built-in test runner

# Agent Instructions
**system_architect** — Focus on scalability and separation of concerns. Always consider DAG dependencies.
**backend_engineer** — Follow the zero-dependency constraint strictly. Use Node.js builtins only.
**test_engineer** — Write deterministic tests. Use fake clocks for time-dependent tests.

# Skills
- testing — Run and write tests
- deploy — Build and deploy the project
- optimize — Performance optimization
