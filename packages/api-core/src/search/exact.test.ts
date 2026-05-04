import test from "node:test";
import assert from "node:assert/strict";

import {
  cosineSimilarity,
  dotProduct,
  normalizeEmbedding,
  rankNearestNeighbors,
  rankNearestNeighborsByScore,
} from "./exact.js";

test("cosine similarity is 1 for identical embeddings", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
});

test("nearest neighbors sorts by similarity descending", () => {
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

test("normalizeEmbedding returns unit vector and original norm", () => {
  const result = normalizeEmbedding([3, 4]);

  assert.equal(result.norm, 5);
  assert.deepEqual(result.normalized, [0.6, 0.8]);
});

test("dotProduct matches cosine for normalized vectors", () => {
  const left = normalizeEmbedding([1, 1]);
  const right = normalizeEmbedding([1, 0]);

  assert.equal(dotProduct(left.normalized, right.normalized), cosineSimilarity([1, 1], [1, 0]));
});

test("rankNearestNeighborsByScore keeps exact top-k without full sort semantics drift", () => {
  const ranked = rankNearestNeighborsByScore(
    [
      { id: 1, score: 0.2 },
      { id: 2, score: 0.95 },
      { id: 3, score: 0.8 },
      { id: 4, score: 0.1 },
    ],
    {
      limit: 2,
      minScore: 0.15,
      score: (item) => item.score,
    },
  );

  assert.deepEqual(
    ranked.map((entry) => [entry.item.id, entry.score]),
    [
      [2, 0.95],
      [3, 0.8],
    ],
  );
});
