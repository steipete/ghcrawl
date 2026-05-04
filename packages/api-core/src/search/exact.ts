export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error("Embedding dimensions do not match");
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function normalizeEmbedding(embedding: number[]): { normalized: number[]; norm: number } {
  let normSquared = 0;
  for (let index = 0; index < embedding.length; index += 1) {
    normSquared += embedding[index] * embedding[index];
  }
  const norm = Math.sqrt(normSquared);
  if (norm === 0) {
    return { normalized: embedding.map(() => 0), norm: 0 };
  }
  return {
    normalized: embedding.map((value) => value / norm),
    norm,
  };
}

export function dotProduct(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error("Embedding dimensions do not match");
  }
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

function insertTopK<T>(
  ranked: Array<{ item: T; score: number }>,
  candidate: { item: T; score: number },
  limit: number,
): void {
  let insertAt = ranked.length;
  while (insertAt > 0 && candidate.score > ranked[insertAt - 1].score) {
    insertAt -= 1;
  }

  if (insertAt >= limit) {
    return;
  }

  ranked.splice(insertAt, 0, candidate);
  if (ranked.length > limit) {
    ranked.length = limit;
  }
}

export function rankNearestNeighbors<T extends { id: number; embedding: number[] }>(
  items: T[],
  params: { targetEmbedding: number[]; limit: number; minScore?: number; skipId?: number },
): Array<{ item: T; score: number }> {
  const minScore = params.minScore ?? -1;
  const ranked: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    if (item.id === params.skipId) continue;
    const score = cosineSimilarity(params.targetEmbedding, item.embedding);
    if (score < minScore) continue;
    insertTopK(ranked, { item, score }, params.limit);
  }
  return ranked;
}

export function rankNearestNeighborsByScore<T>(
  items: T[],
  params: { limit: number; score: (item: T) => number; minScore?: number },
): Array<{ item: T; score: number }> {
  const minScore = params.minScore ?? -1;
  const ranked: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = params.score(item);
    if (score < minScore) continue;
    insertTopK(ranked, { item, score }, params.limit);
  }
  return ranked;
}
