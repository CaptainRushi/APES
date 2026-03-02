/**
 * Workspace Action Engine — Verification Test
 *
 * Tests:
 *   1. FileReader: read, readLines, readDirectory, findFiles, getMetadata
 *   2. FileWriter: write (atomic), mkdir, delete, backup
 *   3. LineEditor: replace, insert, delete, search-replace
 *   4. DiffGenerator: unified, summary, colorized
 *   5. PermissionGuard: path traversal, protected files, cluster permissions
 *   6. FileLock: acquire, release, stale cleanup
 *   7. AuditLogger: log, getEntries, getSummary
 *   8. Transaction: commit, rollback on failure
 *   9. RepoAnalyzer: analyze, detectLanguages, detectFrameworks
 *  10. WorkspaceEngine: full read/write/edit/delete flow
 *  11. WorkspacePermissions: agent definitions have workspace permissions
 *  12. SkillsLayer: workspace skills registered per cluster
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { FileReader } from '../src/workspace/file-reader.js';
import { FileWriter } from '../src/workspace/file-writer.js';
import { LineEditor } from '../src/workspace/line-editor.js';
import { DiffGenerator } from '../src/workspace/diff-generator.js';
import { PermissionGuard, CLUSTER_PERMISSIONS } from '../src/workspace/permission-guard.js';
import { FileLock } from '../src/workspace/file-lock.js';
import { AuditLogger } from '../src/workspace/audit-logger.js';
import { Transaction } from '../src/workspace/transaction.js';
import { RepoAnalyzer } from '../src/workspace/repo-analyzer.js';
import { WorkspaceEngine } from '../src/workspace/workspace-engine.js';
import { getDefaultAgents, WORKSPACE_PERMISSIONS } from '../src/agents/agent-definitions.js';
import { SKILL_REGISTRY, CLUSTER_SKILLS, SkillsLayer } from '../src/agents/skills-layer.js';
import { ConstraintEnforcer } from '../src/safety/constraint-enforcer.js';

// ─── Test Harness ─────────────────────────────────────────────
let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${err.message}`);
    }
}

async function testAsync(name, fn) {
    total++;
    try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${err.message}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

// ─── Setup ──────────────────────────────────────────────────────
const testDir = join(tmpdir(), 'apes-workspace-test-' + randomUUID().slice(0, 8));
const sessionId = 'test-' + randomUUID().slice(0, 8);

mkdirSync(testDir, { recursive: true });
mkdirSync(join(testDir, 'src'), { recursive: true });
writeFileSync(join(testDir, 'hello.txt'), 'Hello World\nLine 2\nLine 3\nLine 4\nLine 5\n');
writeFileSync(join(testDir, 'src', 'index.js'), 'console.log("hello");\nconst x = 1;\nconst y = 2;\n');
writeFileSync(join(testDir, 'package.json'), JSON.stringify({ name: 'test-project', version: '1.0.0', type: 'module', dependencies: { express: '^4.0.0' } }));
writeFileSync(join(testDir, '.env'), 'SECRET=abc123');

console.log(`\n  ████████████████████████████████████████████████`);
console.log(`  █  APES Workspace Action Engine — Test Suite  █`);
console.log(`  ████████████████████████████████████████████████`);
console.log(`  Test directory: ${testDir}`);
console.log(`  Session: ${sessionId}\n`);

// ═══════════════════════════════════════════════════════════════
// 1. FileReader
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── FileReader ───────────────────────────────');

test('read existing file', () => {
    const reader = new FileReader(testDir);
    const result = reader.read('hello.txt');
    assert(result.exists === true, 'file should exist');
    assert(result.content.includes('Hello World'), 'content mismatch');
    assert(result.lines === 6, `expected 6 lines, got ${result.lines}`);
    assert(result.encoding === 'utf-8', 'encoding mismatch');
});

test('read non-existent file', () => {
    const reader = new FileReader(testDir);
    const result = reader.read('missing.txt');
    assert(result.exists === false, 'should not exist');
});

test('readLines returns correct range', () => {
    const reader = new FileReader(testDir);
    const result = reader.readLines('hello.txt', 2, 4);
    assert(result.lines.length === 3, `expected 3 lines, got ${result.lines.length}`);
    assert(result.lines[0] === 'Line 2', 'first line mismatch');
    assert(result.totalLines === 6, 'totalLines mismatch');
});

test('readDirectory lists entries', () => {
    const reader = new FileReader(testDir);
    const result = reader.readDirectory('.', { recursive: true });
    assert(result.totalFiles >= 3, `expected >=3 files, got ${result.totalFiles}`);
    assert(result.totalDirs >= 1, `expected >=1 dir, got ${result.totalDirs}`);
});

test('findFiles matches pattern', () => {
    const reader = new FileReader(testDir);
    const results = reader.findFiles('**/*.js', '.');
    assert(results.length >= 1, 'should find at least 1 .js file');
});

test('getMetadata returns file info', () => {
    const reader = new FileReader(testDir);
    const meta = reader.getMetadata('hello.txt');
    assert(meta.exists === true, 'should exist');
    assert(meta.isFile === true, 'should be file');
    assert(meta.extension === '.txt', 'wrong extension');
});

// ═══════════════════════════════════════════════════════════════
// 2. FileWriter
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── FileWriter ──────────────────────────────');

test('write new file (atomic)', () => {
    const writer = new FileWriter(testDir);
    const result = writer.write('new-file.txt', 'New content here');
    assert(result.success === true, 'write failed');
    assert(result.created === true, 'should be created');
    const content = readFileSync(join(testDir, 'new-file.txt'), 'utf-8');
    assert(content === 'New content here', 'content mismatch');
});

test('overwrite existing file', () => {
    const writer = new FileWriter(testDir);
    const result = writer.write('new-file.txt', 'Overwritten!');
    assert(result.success === true, 'write failed');
    assert(result.overwritten === true, 'should be overwritten');
});

test('mkdir creates nested dirs', () => {
    const writer = new FileWriter(testDir);
    const result = writer.mkdir('deep/nested/dir');
    assert(result.success === true, 'mkdir failed');
    assert(existsSync(join(testDir, 'deep', 'nested', 'dir')), 'dir not created');
});

test('delete file', () => {
    const writer = new FileWriter(testDir);
    writer.write('to-delete.txt', 'temporary');
    const result = writer.delete('to-delete.txt');
    assert(result.success === true, 'delete failed');
    assert(!existsSync(join(testDir, 'to-delete.txt')), 'file still exists');
});

test('backup file', () => {
    const writer = new FileWriter(testDir);
    const result = writer.backup('hello.txt');
    assert(result.success === true, 'backup failed');
    assert(result.content.includes('Hello World'), 'backup content mismatch');
    assert(existsSync(result.backupPath), 'backup file not created');
});

// ═══════════════════════════════════════════════════════════════
// 3. LineEditor
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── LineEditor ──────────────────────────────');

test('replace line range', () => {
    const editor = new LineEditor(testDir);
    writeFileSync(join(testDir, 'edit-test.txt'), 'Line 1\nLine 2\nLine 3\nLine 4\n');
    const result = editor.replaceLine('edit-test.txt', 2, 3, 'Replaced Line 2-3');
    assert(result.success === true, 'replace failed');
    assert(result.after.includes('Replaced Line 2-3'), 'replacement not applied');
});

test('insert lines', () => {
    const editor = new LineEditor(testDir);
    writeFileSync(join(testDir, 'insert-test.txt'), 'Line 1\nLine 2\n');
    const result = editor.insertLines('insert-test.txt', 1, 'Inserted');
    assert(result.success === true, 'insert failed');
    assert(result.after.includes('Inserted'), 'insertion not applied');
});

test('delete lines', () => {
    const editor = new LineEditor(testDir);
    writeFileSync(join(testDir, 'delete-test.txt'), 'Line 1\nLine 2\nLine 3\n');
    const result = editor.deleteLines('delete-test.txt', 2, 2);
    assert(result.success === true, 'delete failed');
    assert(!result.after.includes('Line 2'), 'line not deleted');
});

test('search-replace', () => {
    const editor = new LineEditor(testDir);
    writeFileSync(join(testDir, 'sr-test.txt'), 'foo bar foo\nbaz foo\n');
    const result = editor.searchReplace('sr-test.txt', 'foo', 'qux');
    assert(result.success === true, 'search-replace failed');
    assert(result.matchCount >= 3, `expected >=3 matches, got ${result.matchCount}`);
});

// ═══════════════════════════════════════════════════════════════
// 4. DiffGenerator
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── DiffGenerator ───────────────────────────');

test('unified diff generation', () => {
    const dg = new DiffGenerator();
    const diff = dg.unified('hello\nworld\n', 'hello\nuniverse\n', 'test.txt');
    assert(diff.includes('-world'), 'missing deletion');
    assert(diff.includes('+universe'), 'missing addition');
});

test('diff summary counts', () => {
    const dg = new DiffGenerator();
    const summary = dg.summary('a\nb\nc\n', 'a\nB\nc\nd\n');
    assert(summary.additions >= 1, 'expected additions');
    assert(summary.deletions >= 1, 'expected deletions');
});

test('colorized diff has ANSI codes', () => {
    const dg = new DiffGenerator();
    const diff = dg.unified('a\n', 'b\n', 'test.txt');
    const colored = dg.colorized(diff);
    assert(colored.includes('\x1b['), 'expected ANSI escape codes');
});

// ═══════════════════════════════════════════════════════════════
// 5. PermissionGuard
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── PermissionGuard ─────────────────────────');

test('path traversal is rejected', () => {
    const guard = new PermissionGuard(testDir);
    const result = guard.validatePath('../../etc/passwd');
    assert(result.valid === false, 'traversal should be rejected');
    assert(result.reason.includes('escape'), 'should mention escape');
});

test('valid path passes', () => {
    const guard = new PermissionGuard(testDir);
    const result = guard.validatePath('src/index.js');
    assert(result.valid === true, 'should be valid');
});

test('protected file is blocked', () => {
    const guard = new PermissionGuard(testDir);
    const resolved = join(testDir, '.env');
    const result = guard.checkProtectedFile(resolved);
    assert(result.protected === true, '.env should be protected');
});

test('cluster permission enforcement', () => {
    const guard = new PermissionGuard(testDir);
    guard.registerAgentCluster('researcher_v1', 'research_intelligence');
    const readCheck = guard.checkPermission('researcher_v1', 'read', 'hello.txt');
    assert(readCheck.allowed === true, 'read should be allowed');
    const writeCheck = guard.checkPermission('researcher_v1', 'write', 'hello.txt');
    assert(writeCheck.allowed === false, 'write should be denied for research');
});

test('read-only mode blocks writes', () => {
    const guard = new PermissionGuard(testDir);
    guard.registerAgentCluster('backend_v1', 'engineering');
    guard.setReadOnlyMode(true);
    const result = guard.checkPermission('backend_v1', 'write', 'hello.txt');
    assert(result.allowed === false, 'should be blocked in read-only mode');
    guard.setReadOnlyMode(false);
});

// ═══════════════════════════════════════════════════════════════
// 6. FileLock
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── FileLock ────────────────────────────────');

await testAsync('acquire and release lock', async () => {
    const lock = new FileLock(sessionId);
    const acquired = await lock.acquire('test-file.js', 'agent1');
    assert(acquired.success === true, 'should acquire lock');
    const status = lock.isLocked('test-file.js');
    assert(status.locked === true, 'should show locked');
    assert(status.holder === 'agent1', 'wrong holder');
    const released = lock.release('test-file.js');
    assert(released.success === true, 'should release');
    const after = lock.isLocked('test-file.js');
    assert(after.locked === false, 'should be unlocked');
});

await testAsync('releaseAll by agent', async () => {
    const lock = new FileLock(sessionId);
    await lock.acquire('file1.js', 'agent2');
    await lock.acquire('file2.js', 'agent2');
    const result = lock.releaseAll('agent2');
    assert(result.released >= 2, 'should release multiple');
});

test('cleanStaleLocks removes old locks', () => {
    const lock = new FileLock(sessionId);
    const result = lock.cleanStaleLocks(1); // 1ms threshold
    assert(typeof result.cleaned === 'number', 'should return count');
});

// ═══════════════════════════════════════════════════════════════
// 7. AuditLogger
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── AuditLogger ────────────────────────────');

test('log and retrieve entry', () => {
    const logger = new AuditLogger(sessionId);
    logger.clear();
    const result = logger.log({ agentId: 'test_agent', action: 'read', path: 'test.txt', success: true });
    assert(result.auditId != null, 'should return auditId');

    const entries = logger.getEntries({ agentId: 'test_agent' });
    assert(entries.length >= 1, 'should find entries');
    assert(entries[0].action === 'read', 'wrong action');
});

test('getSummary provides stats', () => {
    const logger = new AuditLogger(sessionId);
    logger.log({ agentId: 'a1', action: 'write', success: true });
    logger.log({ agentId: 'a2', action: 'read', success: false, error: 'test' });
    const summary = logger.getSummary();
    assert(summary.totalEntries >= 2, 'expected entries');
    assert(Object.keys(summary.byAction).length >= 1, 'should have by-action');
    assert(Object.keys(summary.byAgent).length >= 1, 'should have by-agent');
});

// ═══════════════════════════════════════════════════════════════
// 8. Transaction
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── Transaction ─────────────────────────────');

await testAsync('multi-file commit succeeds', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    engine.permissionGuard.registerAgentCluster('devops_v1', 'execution_automation');
    const ctx = { agentId: 'devops_v1' };
    const tx = engine.beginTransaction(ctx);
    tx.addOperation('write', 'tx-file1.txt', { content: 'Transaction file 1' });
    tx.addOperation('write', 'tx-file2.txt', { content: 'Transaction file 2' });
    const result = await tx.commit();
    assert(result.success === true, 'commit should succeed');
    assert(existsSync(join(testDir, 'tx-file1.txt')), 'tx-file1 should exist');
    assert(existsSync(join(testDir, 'tx-file2.txt')), 'tx-file2 should exist');
});

await testAsync('transaction rollback on failure', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    engine.permissionGuard.registerAgentCluster('devops_v1', 'execution_automation');
    const ctx = { agentId: 'devops_v1' };
    writeFileSync(join(testDir, 'rollback-orig.txt'), 'Original content');
    const tx = engine.beginTransaction(ctx);
    tx.addOperation('write', 'rollback-orig.txt', { content: 'Modified' });
    tx.addOperation('edit', 'nonexistent-file-for-rollback.txt', { edits: [{ type: 'replace', startLine: 1, content: 'x' }] });
    const result = await tx.commit();
    assert(result.success === false, 'should fail');
    assert(result.rolledBack === true, 'should rollback');
    // Verify original was restored
    const content = readFileSync(join(testDir, 'rollback-orig.txt'), 'utf-8');
    assert(content === 'Original content', `expected original, got: ${content}`);
});

// ═══════════════════════════════════════════════════════════════
// 9. RepoAnalyzer
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── RepoAnalyzer ───────────────────────────');

test('analyze detects languages', () => {
    const analyzer = new RepoAnalyzer(testDir);
    const analysis = analyzer.analyze();
    assert(analysis.languages.length >= 1, 'should detect at least 1 language');
    const jsLang = analysis.languages.find(l => l.language === 'JavaScript');
    assert(jsLang, 'should detect JavaScript');
});

test('analyze detects frameworks', () => {
    const analyzer = new RepoAnalyzer(testDir);
    const analysis = analyzer.analyze();
    // Should detect Node.js from package.json
    const nodejs = analysis.frameworks.find(f => f.name === 'Node.js');
    assert(nodejs, 'should detect Node.js');
    // Should detect Express from dependencies
    const express = analysis.frameworks.find(f => f.name === 'Express');
    assert(express, 'should detect Express');
});

test('getStats returns file counts', () => {
    const analyzer = new RepoAnalyzer(testDir);
    const stats = analyzer.getStats();
    assert(stats.totalFiles >= 3, `expected >=3 files, got ${stats.totalFiles}`);
});

// ═══════════════════════════════════════════════════════════════
// 10. WorkspaceEngine — full flow
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── WorkspaceEngine ─────────────────────────');

await testAsync('readFile through engine', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    engine.permissionGuard.registerAgentCluster('backend_v1', 'engineering');
    const result = await engine.readFile('hello.txt', { agentId: 'backend_v1' });
    assert(result.success === true, 'read should succeed');
    assert(result.content.includes('Hello World'), 'content mismatch');
});

await testAsync('writeFile through engine with diff', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    engine.permissionGuard.registerAgentCluster('backend_v1', 'engineering');
    const result = await engine.writeFile('engine-test.txt', 'Engine wrote this', { agentId: 'backend_v1' });
    assert(result.success === true, 'write should succeed');
    assert(result.diff != null, 'should have diff');
    assert(result.auditId != null, 'should have auditId');
});

await testAsync('editLines through engine', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    engine.permissionGuard.registerAgentCluster('backend_v1', 'engineering');
    writeFileSync(join(testDir, 'engine-edit.txt'), 'L1\nL2\nL3\n');
    const result = await engine.editLines('engine-edit.txt', [
        { type: 'replace', startLine: 2, endLine: 2, content: 'EDITED' },
    ], { agentId: 'backend_v1' });
    assert(result.success === true, 'edit should succeed');
    assert(result.linesChanged >= 1, 'should have changes');
});

await testAsync('deleteFile blocked for engineering cluster', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    engine.permissionGuard.registerAgentCluster('backend_v1', 'engineering');
    const result = await engine.deleteFile('engine-test.txt', { agentId: 'backend_v1' });
    assert(result.success === false, 'delete should be blocked for engineering');
});

await testAsync('analyzeRepo through engine', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    engine.permissionGuard.registerAgentCluster('backend_v1', 'engineering');
    const result = await engine.analyzeRepo({ agentId: 'backend_v1' });
    assert(result.success === true, 'analyze should succeed');
    assert(result.languages.length >= 1, 'should have languages');
});

await testAsync('findFiles through engine', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    engine.permissionGuard.registerAgentCluster('backend_v1', 'engineering');
    const result = await engine.findFiles('*.txt', '.', { agentId: 'backend_v1' });
    assert(result.success === true, 'find should succeed');
    assert(result.count >= 1, 'should find files');
});

await testAsync('getStatus returns engine state', async () => {
    const engine = new WorkspaceEngine(testDir, { sessionId });
    const status = engine.getStatus();
    assert(status.projectRoot === engine.projectRoot, 'projectRoot mismatch');
    assert(typeof status.activeLocks === 'number', 'should have activeLocks');
    assert(typeof status.totalOperations === 'number', 'should have totalOperations');
});

// ═══════════════════════════════════════════════════════════════
// 11. Agent Definitions — Workspace Permissions
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── Agent Definitions ───────────────────────');

test('all 64 agents have workspacePermissions', () => {
    const agents = getDefaultAgents();
    assert(agents.length === 64, `expected 64 agents, got ${agents.length}`);
    for (const agent of agents) {
        assert(agent.workspacePermissions != null, `agent ${agent.id} missing workspacePermissions`);
        assert(typeof agent.workspacePermissions.read === 'boolean', `${agent.id}: read not boolean`);
        assert(typeof agent.workspacePermissions.write === 'boolean', `${agent.id}: write not boolean`);
        assert(typeof agent.workspacePermissions.edit === 'boolean', `${agent.id}: edit not boolean`);
        assert(typeof agent.workspacePermissions.delete === 'boolean', `${agent.id}: delete not boolean`);
    }
});

test('WORKSPACE_PERMISSIONS exported and matches clusters', () => {
    assert(WORKSPACE_PERMISSIONS.engineering.write === true, 'engineering should have write');
    assert(WORKSPACE_PERMISSIONS.research_intelligence.write === false, 'research should not write');
    assert(WORKSPACE_PERMISSIONS.execution_automation.delete === true, 'exec_auto should delete');
    assert(WORKSPACE_PERMISSIONS.control_safety.delete === false, 'control should not delete');
});

test('permission model matches spec', () => {
    const agents = getDefaultAgents();
    const eng = agents.find(a => a.cluster === 'engineering');
    assert(eng.workspacePermissions.read === true && eng.workspacePermissions.write === true && eng.workspacePermissions.edit === true && eng.workspacePermissions.delete === false, 'engineering permissions wrong');
    const res = agents.find(a => a.cluster === 'research_intelligence');
    assert(res.workspacePermissions.read === true && res.workspacePermissions.write === false && res.workspacePermissions.edit === false, 'research permissions wrong');
});

// ═══════════════════════════════════════════════════════════════
// 12. SkillsLayer — Workspace Skills
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── SkillsLayer ────────────────────────────');

test('workspace skills exist in SKILL_REGISTRY', () => {
    const wsSkills = ['readFile', 'writeFile', 'editLines', 'createDir', 'deleteFile', 'analyzeRepo', 'previewDiff', 'findFiles'];
    for (const name of wsSkills) {
        assert(SKILL_REGISTRY[name], `workspace skill ${name} missing from SKILL_REGISTRY`);
        assert(SKILL_REGISTRY[name].cluster === '_workspace', `${name} should be _workspace cluster`);
    }
});

test('CLUSTER_SKILLS includes workspace skills per permission level', () => {
    // All clusters get readFile, findFiles, analyzeRepo
    for (const cluster of Object.keys(CLUSTER_SKILLS)) {
        assert(CLUSTER_SKILLS[cluster].includes('readFile'), `${cluster} missing readFile`);
        assert(CLUSTER_SKILLS[cluster].includes('findFiles'), `${cluster} missing findFiles`);
        assert(CLUSTER_SKILLS[cluster].includes('analyzeRepo'), `${cluster} missing analyzeRepo`);
    }
    // engineering gets writeFile, editLines
    assert(CLUSTER_SKILLS.engineering.includes('writeFile'), 'engineering missing writeFile');
    assert(CLUSTER_SKILLS.engineering.includes('editLines'), 'engineering missing editLines');
    // Only execution_automation gets deleteFile
    assert(CLUSTER_SKILLS.execution_automation.includes('deleteFile'), 'exec_auto missing deleteFile');
    assert(!CLUSTER_SKILLS.engineering.includes('deleteFile'), 'engineering should NOT have deleteFile');
    assert(!CLUSTER_SKILLS.research_intelligence.includes('writeFile'), 'research should NOT have writeFile');
});

test('SkillsLayer loads workspace skills for engineering', () => {
    const sl = new SkillsLayer('engineering');
    const available = sl.getAvailableSkills();
    assert(available.includes('readFile'), 'should have readFile');
    assert(available.includes('writeFile'), 'should have writeFile');
    assert(available.includes('editLines'), 'should have editLines');
});

test('SkillsLayer loads only read skills for research', () => {
    const sl = new SkillsLayer('research_intelligence');
    const available = sl.getAvailableSkills();
    assert(available.includes('readFile'), 'should have readFile');
    assert(!available.includes('writeFile'), 'should NOT have writeFile');
    assert(!available.includes('deleteFile'), 'should NOT have deleteFile');
});

// ═══════════════════════════════════════════════════════════════
// 13. ConstraintEnforcer — Workspace Safety Rule
// ═══════════════════════════════════════════════════════════════
console.log('\n  ─── ConstraintEnforcer ──────────────────────');

test('workspace safety rule catches path traversal', () => {
    const enforcer = new ConstraintEnforcer();
    const result = enforcer.enforce({ output: 'writeFile("../../etc/passwd", "malicious")' });
    const wsViolation = result.violations.find(v => v.rule === 'workspace_file_safety');
    assert(wsViolation != null, 'should flag path traversal');
    assert(wsViolation.severity === 'error', 'should be error severity');
});

test('workspace safety rule catches .env writes', () => {
    const enforcer = new ConstraintEnforcer();
    const result = enforcer.enforce({ output: 'writeFile(".env", "SECRET=hacked")' });
    const wsViolation = result.violations.find(v => v.rule === 'workspace_file_safety');
    assert(wsViolation != null, 'should flag .env write');
});

test('workspace safety rule allows normal output', () => {
    const enforcer = new ConstraintEnforcer();
    const result = enforcer.enforce({ output: 'Successfully refactored the utils module with improved error handling and type safety.' });
    const wsViolation = result.violations.find(v => v.rule === 'workspace_file_safety');
    assert(wsViolation == null, 'should NOT flag normal output');
});

// ═══════════════════════════════════════════════════════════════
// Cleanup & Report
// ═══════════════════════════════════════════════════════════════
try {
    rmSync(testDir, { recursive: true, force: true });
} catch { /* best effort */ }

console.log(`\n  ════════════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${total} total`);
if (failed === 0) {
    console.log(`  ✅ All tests passed!`);
} else {
    console.log(`  ❌ ${failed} test(s) failed`);
}
console.log(`  ════════════════════════════════════════════════\n`);

process.exit(failed > 0 ? 1 : 0);
