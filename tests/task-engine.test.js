/**
 * APES Task Engine — Verification Test Script
 *
 * Tests all core functionality:
 *   1. TaskEngine: creation, state machine, DAG validation, retry
 *   2. TaskGraphGenerator: decomposition, graph generation
 *   3. TaskTreeRenderer: tree rendering output
 *   4. TaskLearningBridge: performance recording
 *   5. Integration: full flow
 */

import { TaskEngine } from '../src/tasks/task-engine.js';
import { TaskGraphGenerator } from '../src/tasks/task-graph.js';
import { TaskTreeRenderer } from '../src/tasks/task-renderer.js';
import { TaskLearningBridge } from '../src/tasks/task-learning.js';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TEST_SESSION = `test-session-${Date.now()}`;
const SESSION_DIR = join(homedir(), '.apes', 'sessions', TEST_SESSION);

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  \x1b[32m✓\x1b[0m ${message}`);
        passed++;
    } else {
        console.log(`  \x1b[31m✗\x1b[0m ${message}`);
        failed++;
    }
}

function section(title) {
    console.log(`\n\x1b[1m\x1b[36m═══ ${title} ═══\x1b[0m`);
}

// ─── Test 1: Task Engine ─────────────────────────────────────────
section('TaskEngine — Core');

const engine = new TaskEngine(TEST_SESSION);

// Create tasks
const task1 = engine.createTask({
    id: 'task-001',
    title: 'Setup Database',
    description: 'Create the database schema',
    priority: 'high',
    dependencies: [],
});
assert(task1.id === 'task-001', 'Task created with correct ID');
assert(task1.status === 'pending', 'Initial status is pending');
assert(task1.priority === 'high', 'Priority is set correctly');

const task2 = engine.createTask({
    id: 'task-002',
    title: 'Create API Routes',
    description: 'Build REST endpoints',
    priority: 'medium',
    dependencies: ['task-001'],
});
assert(task2.status === 'blocked', 'Task with unmet dependencies starts as blocked');

const task3 = engine.createTask({
    id: 'task-003',
    title: 'Build Frontend',
    description: 'Create React components',
    priority: 'low',
    dependencies: ['task-001'],
});
assert(task3.status === 'blocked', 'Task 3 is blocked on task-001');

// Retrieval
const retrieved = engine.getTask('task-001');
assert(retrieved !== null, 'getTask retrieves existing task');
assert(retrieved.title === 'Setup Database', 'Retrieved task has correct title');

const all = engine.getAllTasks();
assert(all.length === 3, `getAllTasks returns all 3 tasks (got ${all.length})`);

// Status
const status = engine.getStatus();
assert(status.total === 3, 'Status total is 3');
assert(status.pending === 1, 'Status pending is 1');
assert(status.blocked === 2, 'Status blocked is 2');

// ─── Test 2: State Machine ──────────────────────────────────────
section('TaskEngine — State Machine');

// Valid transition: pending → in_progress
const claimed = engine.transitionTask('task-001', 'in_progress', { assignedAgent: 'agent-A' });
assert(claimed.status === 'in_progress', 'pending → in_progress transition works');

// Valid transition: in_progress → completed
const completed = engine.transitionTask('task-001', 'completed');
assert(completed.status === 'completed', 'in_progress → completed transition works');
assert(completed.completedAt !== null, 'completedAt is set on completion');

// Illegal transition: completed → pending
try {
    engine.transitionTask('task-001', 'pending');
    assert(false, 'Should throw on illegal transition completed → pending');
} catch (e) {
    assert(e.message.includes('Illegal transition'), 'Illegal transition throws error');
}

// Auto-unblocking: task-002 and task-003 should be unblocked now
const t2 = engine.getTask('task-002');
const t3 = engine.getTask('task-003');
assert(t2.status === 'pending', 'task-002 auto-unblocked after task-001 completed');
assert(t3.status === 'pending', 'task-003 auto-unblocked after task-001 completed');

// ─── Test 3: DAG Validation ─────────────────────────────────────
section('TaskEngine — DAG Validation');

// Valid DAG
try {
    engine._validateDAG([
        { id: 'a', dependencies: [] },
        { id: 'b', dependencies: ['a'] },
        { id: 'c', dependencies: ['a'] },
        { id: 'd', dependencies: ['b', 'c'] },
    ]);
    assert(true, 'Valid DAG passes validation');
} catch {
    assert(false, 'Valid DAG should not throw');
}

// Circular dependency
try {
    engine._validateDAG([
        { id: 'x', dependencies: ['z'] },
        { id: 'y', dependencies: ['x'] },
        { id: 'z', dependencies: ['y'] },
    ]);
    assert(false, 'Circular DAG should throw');
} catch (e) {
    assert(e.message.includes('Circular dependency'), 'Circular dependency detected correctly');
}

// ─── Test 4: Claiming ───────────────────────────────────────────
section('TaskEngine — Task Claiming');

const claim1 = engine.claimTask('task-002', 'agent-B');
assert(claim1.success === true, 'Claim task-002 succeeds (deps met)');

const claim2 = engine.claimNextAvailable('agent-C');
assert(claim2.success === true, 'claimNextAvailable returns task-003');

// ─── Test 5: Retry Logic ────────────────────────────────────────
section('TaskEngine — Retry Logic');

const engine2 = new TaskEngine(TEST_SESSION + '-retry');
const retryTask = engine2.createTask({
    id: 'retry-001',
    title: 'Flaky Task',
    maxRetries: 2,
});

// Claim (this also transitions to in_progress)
engine2.claimTask('retry-001', 'agent-X');
const fail1 = engine2.failTask('retry-001', 'agent-X', { message: 'timeout' });
assert(fail1.retrying === true, 'First failure triggers retry');
assert(fail1.task.retryCount === 1, 'Retry count is 1');

// Claim again and fail again
engine2.claimTask('retry-001', 'agent-Y');
const fail2 = engine2.failTask('retry-001', 'agent-Y', { message: 'timeout again' });
assert(fail2.retrying === false, 'Second failure escalates (maxRetries=2)');
assert(fail2.task.escalated === true, 'Task is marked as escalated');

// ─── Test 6: Task Graph Generator ────────────────────────────────
section('TaskGraphGenerator');

const generator = new TaskGraphGenerator(TEST_SESSION + '-gen');
const result = await generator.generate('create a REST API and set up the database then build the frontend');

assert(result.tasks.length > 0, `Generated ${result.tasks.length} tasks`);
assert(result.graph.nodes.length === result.tasks.length, 'Graph nodes match task count');
assert(result.graph.totalTasks === result.tasks.length, 'Graph totalTasks is correct');
assert(result.intent !== null, 'Intent classification returned');

// Check task IDs are sequential
assert(result.tasks[0].id === 'task-001', 'First task ID is task-001');
if (result.tasks.length > 1) {
    assert(result.tasks[1].id === 'task-002', 'Second task ID is task-002');
}

// ─── Test 7: Task Tree Renderer ──────────────────────────────────
section('TaskTreeRenderer');

const renderer = new TaskTreeRenderer(TEST_SESSION + '-gen');
const tree = renderer.engine.getTaskTree();
assert(tree.length > 0, 'Task tree has root nodes');

console.log('\n  --- Tree Output ---');
const output = renderer.renderTaskTree(tree);
console.log('  --- End ---');
assert(output.includes('task-001'), 'Tree output includes task-001');
assert(output.includes('['), 'Tree output includes checkbox brackets');

// ─── Test 8: Task Learning Bridge ────────────────────────────────
section('TaskLearningBridge');

const learning = new TaskLearningBridge(TEST_SESSION + '-learn');

const record = learning.recordCompletion({
    taskId: 'task-001',
    duration: 3200,
    agent: 'backendEngineer',
    confidence: 0.88,
    issuesFound: 1,
    cluster: 'engineering',
    type: 'code',
});

assert(record.taskId === 'task-001', 'Learning record has correct taskId');
assert(record.duration === 3200, 'Learning record has correct duration');
assert(record.confidence === 0.88, 'Learning record has correct confidence');

const taskPerf = learning.getTaskPerformance('task-001');
assert(taskPerf.length === 1, 'getTaskPerformance returns 1 record');

const stats = learning.getStats();
assert(stats.totalRecords === 1, 'Stats show 1 total record');
assert(stats.avgConfidence === 0.88, 'Stats avg confidence is correct');

// ─── Test 9: Hierarchical Tasks ──────────────────────────────────
section('Hierarchical Tasks');

const engine3 = new TaskEngine(TEST_SESSION + '-hier');
engine3.createTask({ id: 'project', title: 'Full Project' });
engine3.createTask({ id: 'backend', title: 'Backend Setup', parentId: 'project' });
engine3.createTask({ id: 'api', title: 'Create API', parentId: 'backend' });
engine3.createTask({ id: 'db', title: 'Setup DB', parentId: 'backend' });
engine3.createTask({ id: 'frontend', title: 'Frontend', parentId: 'project' });

const hierTree = engine3.getTaskTree();
assert(hierTree.length === 1, 'Hierarchical tree has 1 root (project)');
assert(hierTree[0].children.length === 2, 'Project has 2 children (backend, frontend)');
if (hierTree[0].children.length >= 1) {
    const backend = hierTree[0].children.find(c => c.id === 'backend');
    assert(backend && backend.children.length === 2, 'Backend has 2 children (api, db)');
}

// ─── Summary ─────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(48));
console.log(`  Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
console.log('═'.repeat(48));

// ─── Cleanup ─────────────────────────────────────────────────────
const sessionsDir = join(homedir(), '.apes', 'sessions');
for (const dir of [TEST_SESSION, TEST_SESSION + '-retry', TEST_SESSION + '-gen', TEST_SESSION + '-learn', TEST_SESSION + '-hier']) {
    const fullDir = join(sessionsDir, dir);
    if (existsSync(fullDir)) {
        rmSync(fullDir, { recursive: true, force: true });
    }
}

process.exit(failed > 0 ? 1 : 0);
