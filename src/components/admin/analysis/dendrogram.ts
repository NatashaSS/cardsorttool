// Pure helpers for the dendrogram (ANL-03): cluster cut and SVG layout.
import type { DendrogramNode } from "@/lib/api-types";

const EPS = 1e-9;

/** Card ids of a subtree, left to right. */
export function leavesOf(node: DendrogramNode): string[] {
  const out: string[] = [];
  const stack: DendrogramNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop() as DendrogramNode;
    if (n.type === "leaf") out.push(n.cardId);
    else stack.push(n.right, n.left);
  }
  return out;
}

/**
 * Clusters obtained by cutting the tree at `maxDistance`: every maximal subtree whose merge
 * distance is ≤ maxDistance is one cluster; cards that never merge below it are singletons.
 * Returned in leaf order (left to right).
 */
export function cutDendrogram(root: DendrogramNode | null, maxDistance: number): string[][] {
  if (!root) return [];
  const out: string[][] = [];
  const stack: DendrogramNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop() as DendrogramNode;
    if (n.type === "leaf" || n.distance <= maxDistance + EPS) out.push(leavesOf(n));
    else stack.push(n.right, n.left);
  }
  return out;
}

/** Similarity cut-off in % (0..100) → distance threshold. */
export function similarityToDistance(pct: number): number {
  return 1 - pct / 100;
}

/** One merge drawn as a "⊐": vertical bar at `d` from y1 to y2, arms back to children at d1/d2. */
export type DendrogramLink = {
  d: number;
  y: number;
  y1: number;
  d1: number;
  y2: number;
  d2: number;
  /** True when this merge happens at or below the cut (it lies inside a cluster). */
  inCluster: boolean;
};

/**
 * Layout in leaf units: leaf k (position in `leafOrder`) sits at y = k + 0.5; x is the merge
 * distance (0 = identical, 1 = never together). Iterative, so deep trees (200 leaves) are safe.
 */
export function layoutDendrogram(
  root: DendrogramNode | null,
  leafOrder: string[],
  maxDistance: number,
): DendrogramLink[] {
  if (!root) return [];
  const yOf = new Map(leafOrder.map((id, i) => [id, i + 0.5]));
  const pos = new Map<DendrogramNode, { y: number; d: number }>();
  const links: DendrogramLink[] = [];
  // Post-order traversal.
  const stack: { node: DendrogramNode; visited: boolean }[] = [{ node: root, visited: false }];
  while (stack.length > 0) {
    const top = stack.pop() as { node: DendrogramNode; visited: boolean };
    const { node } = top;
    if (node.type === "leaf") {
      pos.set(node, { y: yOf.get(node.cardId) ?? 0, d: 0 });
      continue;
    }
    if (!top.visited) {
      stack.push(
        { node, visited: true },
        { node: node.right, visited: false },
        { node: node.left, visited: false },
      );
      continue;
    }
    const l = pos.get(node.left) as { y: number; d: number };
    const r = pos.get(node.right) as { y: number; d: number };
    const y = (l.y + r.y) / 2;
    pos.set(node, { y, d: node.distance });
    links.push({
      d: node.distance,
      y,
      y1: l.y,
      d1: l.d,
      y2: r.y,
      d2: r.d,
      inCluster: node.distance <= maxDistance + EPS,
    });
  }
  return links;
}
