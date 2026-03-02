import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export class WriteVerifier {
  constructor(projectRoot) {
    this.projectRoot = resolve(projectRoot || process.cwd());
  }

  _resolve(filePath) {
    return resolve(this.projectRoot, filePath);
  }

  hash(content) {
    if (content === null || content === undefined) {
      return null;
    }
    return createHash('sha256').update(content).digest('hex');
  }

  verifyWrite(filePath, intendedContent) {
    try {
      const resolved = this._resolve(filePath);
      if (!existsSync(resolved)) {
        return { verified: false, contentHash: null };
      }
      const actualContent = readFileSync(resolved, 'utf-8');
      const actualHash = this.hash(actualContent);
      const intendedHash = this.hash(intendedContent);
      return { verified: actualHash === intendedHash, contentHash: actualHash };
    } catch {
      return { verified: false, contentHash: null };
    }
  }

  verifyFile(filePath, expectedHash) {
    try {
      const resolved = this._resolve(filePath);
      if (!existsSync(resolved)) {
        return { verified: false, contentHash: null };
      }
      const actualContent = readFileSync(resolved, 'utf-8');
      const actualHash = this.hash(actualContent);
      return { verified: actualHash === expectedHash, contentHash: actualHash };
    } catch {
      return { verified: false, contentHash: null };
    }
  }

  fileExists(filePath) {
    return existsSync(this._resolve(filePath));
  }

  snapshot(filePaths) {
    const snapshotMap = new Map();
    for (const filePath of filePaths) {
      try {
        const resolved = this._resolve(filePath);
        if (existsSync(resolved)) {
          const content = readFileSync(resolved, 'utf-8');
          snapshotMap.set(filePath, this.hash(content));
        } else {
          snapshotMap.set(filePath, null);
        }
      } catch {
        snapshotMap.set(filePath, null);
      }
    }
    return snapshotMap;
  }

  diffSnapshots(before, after) {
    const diff = { created: [], modified: [], deleted: [], unchanged: [] };
    const allPaths = new Set([...before.keys(), ...after.keys()]);

    for (const filePath of allPaths) {
      const hashBefore = before.has(filePath) ? before.get(filePath) : null;
      const hashAfter = after.has(filePath) ? after.get(filePath) : null;

      if (hashBefore === null && hashAfter !== null) {
        diff.created.push(filePath);
      } else if (hashBefore !== null && hashAfter === null) {
        diff.deleted.push(filePath);
      } else if (hashBefore !== hashAfter) {
        diff.modified.push(filePath);
      } else if (hashBefore === hashAfter) {
        diff.unchanged.push(filePath);
      }
    }
    return diff;
  }
}
