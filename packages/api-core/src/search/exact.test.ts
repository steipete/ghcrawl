import test from 'node:test';
import assert from 'node:assert/strict';

import { cosineSimilarity, rankNearestNeighbors } from './exact.js';

test('cosine similarity is 1 for identical embeddings', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
});

test('nearest neighbors sorts by similarity descending', () => {
  const ranked = rankNearestNeighbors(
    [
      { id: 1, embedding: [1, 0] },
      { id: 2, embedding: [0.9, 0.1] },
      { id: 3, embedding: [0, 1] },
    ],
    { targetEmbedding: [1, 0], limit: 2, skipId: 1 },
  );

  assert.equal(ranked[0]?.item.id, 2);
  assert.equal(ranked[1]?.item.id, 3);
});
