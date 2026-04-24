import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCodeSnapshotSignature, extractHunkSignatures, normalizePullFile } from './code-signature.js';

test('normalizePullFile extracts stable GitHub file metadata', () => {
  const file = normalizePullFile({
    filename: 'packages/api-core/src/service.ts',
    status: 'modified',
    previous_filename: 'old.ts',
    additions: 4,
    deletions: 2,
    changes: 6,
    patch: '@@ -1 +1 @@\n-old\n+new',
    sha: 'abc',
  });

  assert.deepEqual(file, {
    filename: 'packages/api-core/src/service.ts',
    status: 'modified',
    previousFilename: 'old.ts',
    additions: 4,
    deletions: 2,
    changes: 6,
    patch: '@@ -1 +1 @@\n-old\n+new',
    sha: 'abc',
  });
});

test('extractHunkSignatures produces deterministic hashes per diff hunk', () => {
  const patch = [
    '@@ -1,3 +1,3 @@',
    ' export function run() {',
    '-  return oldValue;',
    '+  return newValue;',
    ' }',
    '@@ -10,2 +10,2 @@',
    '-const mode = "slow";',
    '+const mode = "fast";',
  ].join('\n');

  const first = extractHunkSignatures('src/run.ts', patch);
  const second = extractHunkSignatures('src/run.ts', patch);

  assert.equal(first.length, 2);
  assert.deepEqual(first, second);
  assert.notEqual(first[0]?.hunkHash, first[1]?.hunkHash);
});

test('buildCodeSnapshotSignature returns files, patch digest, and hunk signatures', () => {
  const snapshot = buildCodeSnapshotSignature([
    {
      filename: 'src/run.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      changes: 2,
      patch: '@@ -1 +1 @@\n-old\n+new',
    },
  ]);

  assert.equal(snapshot.files.length, 1);
  assert.equal(snapshot.hunkSignatures.length, 1);
  assert.match(snapshot.patchDigest, /^[a-f0-9]{64}$/);
});
