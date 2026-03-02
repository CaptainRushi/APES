import { strict as assert } from 'node:assert';
import { ExecutionVerifier } from '../src/tasks/execution-verifier.js';

async function runTests() {
    console.log('--- execution-verifier.test.js ---');

    // mock WorkspaceEngine with a mock WriteVerifier
    const mockWorkspaceEngine = {
        writeVerifier: {
            fileExists: (fp) => fp !== 'missing.txt',
            snapshot: (paths) => {
                const map = new Map();
                for (const p of paths) map.set(p, 'hash-' + Date.now());
                return map;
            },
            diffSnapshots: (b, a) => {
                // Mock a difference or no difference
                if (b.get('unchanged.txt') === a.get('unchanged.txt')) {
                    return { created: [], modified: [], deleted: [], unchanged: ['unchanged.txt'] };
                }
                return { created: ['new.txt'], modified: [], deleted: [], unchanged: [] };
            }
        }
    };

    const verifier = new ExecutionVerifier({
        workspaceEngine: mockWorkspaceEngine,
        minExecutionTime: 100,
        requireSnapshotMatch: true
    });

    console.log('1. Instant completion flagging');
    const res1 = verifier.verify({
        result: { filesWritten: ['fast.txt'], output: 'done', completed: true },
        task: {},
        duration: 50, // very fast
        preSnapshot: null
    });
    assert.equal(res1.pass, false, 'Should fail instant completion');
    assert.ok(res1.flags.includes('suspicious_instant_completion'));

    console.log('2. Missing file detection');
    const res2 = verifier.verify({
        result: { filesWritten: ['missing.txt'], output: 'done', completed: true },
        task: {},
        duration: 500,
        preSnapshot: null
    });
    assert.equal(res2.pass, false, 'Should fail missing file');
    assert.ok(res2.flags.includes('missing_written_file'));

    console.log('3. Snapshot mismatch (no changes)');
    const snapHashes = new Map();
    snapHashes.set('unchanged.txt', 'hash-1');
    const snap = { hashes: snapHashes };

    // Override mock diff logic just for this check
    mockWorkspaceEngine.writeVerifier.diffSnapshots = () => ({ created: [], modified: [], deleted: [], unchanged: ['unchanged.txt'] });

    const res3 = verifier.verify({
        result: { filesWritten: ['unchanged.txt'], output: 'done', completed: true },
        task: {},
        duration: 500,
        preSnapshot: snap
    });
    assert.equal(res3.pass, false, 'Should fail if no workspace changes');
    assert.ok(res3.flags.includes('no_workspace_changes'));

    console.log('4. Normal pass case');
    mockWorkspaceEngine.writeVerifier.diffSnapshots = () => ({ created: ['good.txt'], modified: [], deleted: [], unchanged: [] });
    const res4 = verifier.verify({
        result: { filesWritten: ['good.txt'], output: 'done', completed: true },
        task: {},
        duration: 500,
        preSnapshot: snap
    });
    assert.equal(res4.pass, true, 'Should pass valid execution');
    assert.equal(res4.flags.length, 0);

    console.log('5. Empty result detection');
    const res5 = verifier.verify({
        result: { filesWritten: [] },
        task: {},
        duration: 500,
        preSnapshot: null
    });
    assert.equal(res5.pass, false, 'Should fail empty result without output/completed flag');
    assert.ok(res5.flags.includes('empty_result'));

    console.log('✅ ExecutionVerifier all tests passed\n');
}

runTests().catch(err => {
    console.error('❌ ExecutionVerifier Test failed:', err);
    process.exit(1);
});
