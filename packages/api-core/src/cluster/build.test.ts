import test from 'node:test';
import assert from 'node:assert/strict';

import { buildClusters } from './build.js';

test('buildClusters groups connected components', () => {
  const clusters = buildClusters(
    [
      { threadId: 1, number: 10, title: 'a' },
      { threadId: 2, number: 11, title: 'b' },
      { threadId: 3, number: 12, title: 'c' },
    ],
    [{ leftThreadId: 1, rightThreadId: 2, score: 0.9 }],
  );

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0]?.members, [1, 2]);
});
