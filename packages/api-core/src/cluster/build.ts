export type SimilarityEdge = {
  leftThreadId: number;
  rightThreadId: number;
  score: number;
};

type Node = {
  threadId: number;
  number: number;
  title: string;
};

class UnionFind {
  private readonly parent = new Map<number, number>();

  add(value: number): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: number): number {
    const parent = this.parent.get(value);
    if (parent === undefined) {
      this.parent.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent.set(rightRoot, leftRoot);
    }
  }
}

export function buildClusters(nodes: Node[], edges: SimilarityEdge[]): Array<{ representativeThreadId: number; members: number[] }> {
  const uf = new UnionFind();
  for (const node of nodes) uf.add(node.threadId);
  for (const edge of edges) uf.union(edge.leftThreadId, edge.rightThreadId);

  const byRoot = new Map<number, number[]>();
  for (const node of nodes) {
    const root = uf.find(node.threadId);
    const list = byRoot.get(root) ?? [];
    list.push(node.threadId);
    byRoot.set(root, list);
  }

  const edgeCounts = new Map<number, number>();
  for (const edge of edges) {
    edgeCounts.set(edge.leftThreadId, (edgeCounts.get(edge.leftThreadId) ?? 0) + 1);
    edgeCounts.set(edge.rightThreadId, (edgeCounts.get(edge.rightThreadId) ?? 0) + 1);
  }

  const nodesById = new Map(nodes.map((node) => [node.threadId, node]));
  return Array.from(byRoot.values())
    .map((members) => {
      const representative = [...members].sort((leftId, rightId) => {
        const left = nodesById.get(leftId);
        const right = nodesById.get(rightId);
        const edgeDelta = (edgeCounts.get(rightId) ?? 0) - (edgeCounts.get(leftId) ?? 0);
        if (edgeDelta !== 0) return edgeDelta;
        if (!left || !right) return leftId - rightId;
        return left.number - right.number;
      })[0];
      return { representativeThreadId: representative, members: members.sort((left, right) => left - right) };
    })
    .sort((left, right) => right.members.length - left.members.length);
}
