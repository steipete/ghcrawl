export type SourceEmbeddingItem = {
  id: number;
  normalizedEmbedding: number[];
};

export type SourceKindEdge = {
  leftThreadId: number;
  rightThreadId: number;
  score: number;
};

const DEFAULT_PROGRESS_INTERVAL_MS = 5_000;

function dotProduct(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error("Embedding dimensions do not match");
  }
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

function insertBoundedNeighbor(
  neighbors: Array<{ neighborId: number; score: number }>,
  candidate: { neighborId: number; score: number },
  limit: number,
): number {
  const initialLength = neighbors.length;
  let insertAt = neighbors.length;
  while (insertAt > 0 && candidate.score > neighbors[insertAt - 1].score) {
    insertAt -= 1;
  }

  if (insertAt >= limit) {
    return 0;
  }

  neighbors.splice(insertAt, 0, candidate);
  if (neighbors.length > limit) {
    neighbors.length = limit;
  }
  return neighbors.length - initialLength;
}

export function buildSourceKindEdges(
  items: SourceEmbeddingItem[],
  params: {
    limit: number;
    minScore: number;
    progressIntervalMs?: number;
    onProgress?: (progress: {
      processedItems: number;
      totalItems: number;
      currentEdgeEstimate: number;
    }) => void;
  },
): SourceKindEdge[] {
  const topNeighbors = new Map<number, Array<{ neighborId: number; score: number }>>();
  const totalItems = items.length;
  let processedItems = 0;
  let currentNeighborEntries = 0;
  let lastProgressAt = Date.now();

  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex];
    let leftNeighbors = topNeighbors.get(left.id);
    if (!leftNeighbors) {
      leftNeighbors = [];
      topNeighbors.set(left.id, leftNeighbors);
    }

    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex];
      const score = dotProduct(left.normalizedEmbedding, right.normalizedEmbedding);
      if (score < params.minScore) {
        continue;
      }

      currentNeighborEntries += insertBoundedNeighbor(
        leftNeighbors,
        { neighborId: right.id, score },
        params.limit,
      );

      let rightNeighbors = topNeighbors.get(right.id);
      if (!rightNeighbors) {
        rightNeighbors = [];
        topNeighbors.set(right.id, rightNeighbors);
      }
      currentNeighborEntries += insertBoundedNeighbor(
        rightNeighbors,
        { neighborId: left.id, score },
        params.limit,
      );
    }

    processedItems += 1;
    const now = Date.now();
    if (
      params.onProgress &&
      now - lastProgressAt >= (params.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS)
    ) {
      params.onProgress({
        processedItems,
        totalItems,
        currentEdgeEstimate: Math.floor(currentNeighborEntries / 2),
      });
      lastProgressAt = now;
    }
  }

  const edges: SourceKindEdge[] = [];
  for (const [threadId, neighbors] of topNeighbors.entries()) {
    for (const neighbor of neighbors) {
      if (threadId >= neighbor.neighborId) {
        continue;
      }
      edges.push({
        leftThreadId: threadId,
        rightThreadId: neighbor.neighborId,
        score: neighbor.score,
      });
    }
  }

  return edges;
}
