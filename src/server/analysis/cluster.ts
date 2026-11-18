// ANL-03 — average-linkage (UPGMA) hierarchical clustering. Pure; see docs/DESIGN.md §11.
import type { Dendrogram, DendrogramNode, SimilarityMatrix } from "@/lib/api-types";

/** Distances closer than this are treated as equal, so float noise can't break ties. */
export const TIE_EPSILON = 1e-9;

type Cluster = { node: DendrogramNode; size: number; height: number };

/**
 * Agglomerative clustering with average linkage on distance = 1 − ratio (null ratio → 1).
 * The input is symmetrised as d(i,j) = (d_ij + d_ji) / 2 (a no-op for similarityMatrix output).
 *
 * Deterministic tie-breaking: at each step the pair of active clusters (A, B) with the smallest
 * average distance is merged; distances within TIE_EPSILON count as equal. Among tied pairs, the
 * one with the lexicographically smallest (min(minIndex A, minIndex B), max(minIndex A,
 * minIndex B)) wins, where a cluster's minIndex is the smallest original card index (position in
 * `similarity.cardIds`) it contains. The merged cluster's left child is the one with the smaller
 * minIndex. leafOrder is the in-order (left-to-right) traversal of the leaves.
 *
 * Average linkage is monotone; a merge distance is additionally clamped to be at least its
 * children's, so float rounding can never produce an inversion. O(n³) — fine for n ≤ 200.
 */
export function clusterAverageLinkage(similarity: SimilarityMatrix): Dendrogram {
  const ids = similarity.cardIds;
  const n = ids.length;
  if (n === 0) return { root: null, leafOrder: [] };

  const distOf = (i: number, j: number): number => {
    const r = similarity.ratio[i]?.[j] ?? null;
    return r === null ? 1 : 1 - r;
  };
  // dist[a][b] between active clusters, indexed by slot. A cluster lives in the slot of its
  // minIndex, because a merge keeps the slot of the child with the smaller minIndex.
  const dist: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    for (let j = 0; j < n; j++) if (i !== j) row[j] = (distOf(i, j) + distOf(j, i)) / 2;
    dist.push(row);
  }

  const clusters: (Cluster | null)[] = ids.map((cardId) => ({
    node: { type: "leaf", cardId },
    size: 1,
    height: 0,
  }));
  // Active slots in ascending order. Scanning pairs (a < b) in lexicographic order and replacing
  // the best only on a strictly smaller distance implements the (min, max) minIndex tie-break.
  let active = ids.map((_, i) => i);

  while (active.length > 1) {
    let bestA = -1;
    let bestB = -1;
    let best = Infinity;
    for (let x = 0; x < active.length; x++) {
      const a = active[x];
      const row = dist[a];
      for (let y = x + 1; y < active.length; y++) {
        const b = active[y];
        if (row[b] < best - TIE_EPSILON) {
          best = row[b];
          bestA = a;
          bestB = b;
        }
      }
    }
    const left = clusters[bestA] as Cluster;
    const right = clusters[bestB] as Cluster;
    const size = left.size + right.size;
    const height = Math.max(best, left.height, right.height);
    // Lance–Williams update for average linkage.
    for (const k of active) {
      if (k === bestA || k === bestB) continue;
      const d = (left.size * dist[bestA][k] + right.size * dist[bestB][k]) / size;
      dist[bestA][k] = d;
      dist[k][bestA] = d;
    }
    clusters[bestA] = {
      node: { type: "merge", left: left.node, right: right.node, distance: height, size },
      size,
      height,
    };
    clusters[bestB] = null;
    active = active.filter((s) => s !== bestB);
  }

  const root = (clusters[active[0]] as Cluster).node;
  return { root, leafOrder: leavesInOrder(root) };
}

function leavesInOrder(root: DendrogramNode): string[] {
  const out: string[] = [];
  const stack: DendrogramNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as DendrogramNode;
    if (node.type === "leaf") out.push(node.cardId);
    else stack.push(node.right, node.left);
  }
  return out;
}
