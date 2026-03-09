export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error('Embedding dimensions do not match');
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

export function rankNearestNeighbors<T extends { id: number; embedding: number[] }>(
  items: T[],
  params: { targetEmbedding: number[]; limit: number; minScore?: number; skipId?: number },
): Array<{ item: T; score: number }> {
  const minScore = params.minScore ?? -1;
  return items
    .filter((item) => item.id !== params.skipId)
    .map((item) => ({ item, score: cosineSimilarity(params.targetEmbedding, item.embedding) }))
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, params.limit);
}
