# Testing Skill
Write and run comprehensive tests for APES platform modules.

## Triggers
- test
- testing
- write tests
- unit test
- integration test
- /test
- /tests

## Instructions
When this skill is activated:
1. Identify the modules affected by the current task
2. Write tests using Node.js built-in test runner (`node:test`)
3. Cover happy path, error cases, edge cases, and concurrency invariants
4. Use fake clocks for time-dependent tests
5. Run tests with `node --test tests/*.test.js`
6. Ensure all 163+ existing tests continue to pass

## Agent Hints
- cluster: verification_layer
- priority: high
