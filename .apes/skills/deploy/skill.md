# Deploy Skill
Build and package APES for distribution.

## Triggers
- deploy
- build
- release
- package
- publish
- /deploy

## Instructions
When this skill is activated:
1. Run the full test suite first
2. Verify all exit codes are properly defined
3. Check that bin/apes.js is executable
4. Validate package.json metadata
5. Create a tagged release if requested

## Agent Hints
- cluster: release_layer
- priority: medium
