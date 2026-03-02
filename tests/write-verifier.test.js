import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WriteVerifier } from '../src/workspace/write-verifier.js';

async function runTests() {
    console.log('--- write-verifier.test.js ---');

    const testDir = mkdtempSync(join(tmpdir(), 'apes-verifier-test-'));
    const verifier = new WriteVerifier(testDir);

    try {
        console.log('1. SHA256 Consistency');
        const hash1 = verifier.hash('Hello World');
        const hash2 = verifier.hash('Hello World');
        assert.equal(hash1, hash2, 'Identical content must yield identical hashes');

        console.log('2. File Verification');
        const fp = 'test.txt';
        writeFileSync(join(testDir, fp), 'Secret Data', 'utf-8');
        const correctHash = verifier.hash('Secret Data');

        const verifyPass = verifier.verifyFile(fp, correctHash);
        assert.equal(verifyPass.verified, true, 'Verify should pass with correct hash');

        const verifyFail = verifier.verifyFile(fp, 'badhash');
        assert.equal(verifyFail.verified, false, 'Verify should fail with bad hash');

        console.log('3. Verify Write');
        const writeCheck = verifier.verifyWrite(fp, 'Secret Data');
        assert.equal(writeCheck.verified, true, 'verifyWrite should hash and check matching content');

        const writeCheckFail = verifier.verifyWrite(fp, 'Wrong Data');
        assert.equal(writeCheckFail.verified, false, 'verifyWrite should fail on mismatch');

        console.log('4. Snapshot capture and diff');
        const snap1 = verifier.snapshot([fp, 'missing.txt']);
        assert.equal(snap1.get(fp), correctHash);
        assert.equal(snap1.get('missing.txt'), null);

        writeFileSync(join(testDir, 'new.txt'), 'New File', 'utf-8');
        writeFileSync(join(testDir, fp), 'Updated Data', 'utf-8');

        const snap2 = verifier.snapshot([fp, 'missing.txt', 'new.txt']);

        const diff = verifier.diffSnapshots(snap1, snap2);
        assert.deepEqual(diff.created, ['new.txt']);
        assert.deepEqual(diff.modified, [fp]);
        assert.deepEqual(diff.deleted, []);
        assert.deepEqual(diff.unchanged, ['missing.txt']);

        console.log('✅ WriteVerifier all tests passed\n');
    } finally {
        rmSync(testDir, { recursive: true, force: true });
    }
}

runTests().catch(err => {
    console.error('❌ WriteVerifier Test failed:', err);
    process.exit(1);
});
