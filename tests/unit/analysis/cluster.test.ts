import { describe, expect, it } from "vitest";
import type { DendrogramNode, SimilarityMatrix } from "@/lib/api-types";
import { clusterAverageLinkage, computeAnalysis, similarityMatrix } from "@/server/analysis";
import { at, board, input, randomInput, rng } from "./fixtures";

/** A similarity matrix given only its ratios (counts are irrelevant to clustering). */
function sim(cardIds: string[], ratio: (number | null)[][]): SimilarityMatrix {
  const zeros = cardIds.map(() => cardIds.map(() => 0));
  return { cardIds, together: zeros, both: zeros, ratio };
}
const leaf = (cardId: string): DendrogramNode => ({ type: "leaf", cardId });
const merge = (left: DendrogramNode, right: DendrogramNode, distance: number): DendrogramNode => ({
  type: "merge",
  left,
  right,
  distance,
  size: countLeaves(left) + countLeaves(right),
});
function countLeaves(n: DendrogramNode): number {
  return n.type === "leaf" ? 1 : countLeaves(n.left) + countLeaves(n.right);
}
function checkMonotone(n: DendrogramNode): number {
  if (n.type === "leaf") return 0;
  const l = checkMonotone(n.left);
  const r = checkMonotone(n.right);
  expect(n.distance).toBeGreaterThanOrEqual(l);
  expect(n.distance).toBeGreaterThanOrEqual(r);
  expect(n.size).toBe(countLeaves(n));
  return n.distance;
}

describe("clusterAverageLinkage", () => {
  it("ANL-03: clusters a hand-computed fixture with average linkage", () => {
    // Cards in admin order A, C, B, D. Similarities (from the similarity test fixture):
    //   A-B 2/3, A-C 1/3, C-D 1, A-D = B-C = B-D = 0
    // Distances (1 − s): A-B 1/3, A-C 2/3, C-D 0, A-D = B-C = B-D = 1.
    // Step 1: merge C+D at 0.
    // Step 2: d(A,B) = 1/3; d(A,CD) = (2/3 + 1)/2 = 5/6; d(B,CD) = (1 + 1)/2 = 1 → merge A+B at 1/3.
    // Step 3: d(AB,CD) = (A-C 2/3 + A-D 1 + B-C 1 + B-D 1) / 4 = (11/3)/4 = 11/12.
    const ids = ["A", "C", "B", "D"];
    const d = clusterAverageLinkage(
      sim(ids, [
        [1, 1 / 3, 2 / 3, 0],
        [1 / 3, 1, 0, 1],
        [2 / 3, 0, 1, 0],
        [0, 1, 0, 1],
      ]),
    );
    const root = d.root as DendrogramNode & { type: "merge" };
    expect(root.type).toBe("merge");
    expect(root.distance).toBeCloseTo(11 / 12, 12);
    // AB contains index 0 (A) → left; CD's minIndex is 1 (C) → right, C before D.
    expect(root.left).toEqual(merge(leaf("A"), leaf("B"), 1 - 2 / 3)); // ≈ 1/3 in floats
    expect(root.right).toEqual(merge(leaf("C"), leaf("D"), 0));
    expect(root.size).toBe(4);
    expect(d.leafOrder).toEqual(["A", "B", "C", "D"]);
  });

  it("ANL-03: computes the dendrogram from a real similarity matrix", () => {
    const cards = ["A", "B", "C", "D"];
    const s = similarityMatrix(
      input(cards, [
        board("b1", cards, { A: at("g1"), B: at("g1"), C: at("g2"), D: at("g2") }),
        board("b2", cards, { A: at("g1"), B: at("g1"), C: at("g2") }),
        board("b3", cards, { A: at("g1"), C: at("g1"), B: at("g2") }),
      ]),
    );
    const d = clusterAverageLinkage(s);
    expect(d.leafOrder).toEqual(["A", "B", "C", "D"]);
    expect((d.root as { distance: number }).distance).toBeCloseTo(11 / 12, 12);
  });

  it("ANL-03: empty input → null root", () => {
    expect(clusterAverageLinkage(sim([], []))).toEqual({ root: null, leafOrder: [] });
  });

  it("ANL-03: single card → leaf root", () => {
    expect(clusterAverageLinkage(sim(["A"], [[1]]))).toEqual({
      root: leaf("A"),
      leafOrder: ["A"],
    });
  });

  it("ANL-03: null ratios are distance 1 (cards never sorted)", () => {
    // All distances 1 → ties everywhere: merge (0,1) at 1, then (01, 2) at 1.
    const d = clusterAverageLinkage(
      sim(
        ["A", "B", "C"],
        [
          [null, null, null],
          [null, null, null],
          [null, null, null],
        ],
      ),
    );
    expect(d.root).toEqual(merge(merge(leaf("A"), leaf("B"), 1), leaf("C"), 1));
    expect(d.leafOrder).toEqual(["A", "B", "C"]);
  });

  it("ANL-03: ties are broken by the smallest original indices", () => {
    // d(A,B) = d(A,C) = 0.5 (tie), d(B,C) = 1. Pairs by index: (0,1) beats (0,2) → A+B first.
    // Then d(AB, C) = (0.5 + 1)/2 = 0.75.
    const d = clusterAverageLinkage(
      sim(
        ["A", "B", "C"],
        [
          [1, 0.5, 0.5],
          [0.5, 1, 0],
          [0.5, 0, 1],
        ],
      ),
    );
    expect(d.root).toEqual(merge(merge(leaf("A"), leaf("B"), 0.5), leaf("C"), 0.75));

    // Tie between (1,2) and (0,3) at distance 0 — (0,3) wins because min index 0 < 1.
    // The merged {A,D} keeps A's slot; B+C (0) next; then d(AD, BC) = 1.
    const d2 = clusterAverageLinkage(
      sim(
        ["A", "B", "C", "D"],
        [
          [1, 0, 0, 1],
          [0, 1, 1, 0],
          [0, 1, 1, 0],
          [1, 0, 0, 1],
        ],
      ),
    );
    expect(d2.root).toEqual(
      merge(merge(leaf("A"), leaf("D"), 0), merge(leaf("B"), leaf("C"), 0), 1),
    );
    expect(d2.leafOrder).toEqual(["A", "D", "B", "C"]);
  });

  it("ANL-03: tie-breaking treats float noise as equal", () => {
    // 0.1 * 7 = 0.7000000000000001 in floating point, so d(A,C) is marginally smaller than
    // d(A,B) = 1 − 0.7. Within TIE_EPSILON that is a tie, so (0,1) wins.
    const noisy = 0.1 * 7;
    expect(1 - noisy).toBeLessThan(1 - 0.7);
    const d = clusterAverageLinkage(
      sim(
        ["A", "B", "C"],
        [
          [1, 0.7, noisy],
          [0.7, 1, 0],
          [noisy, 0, 1],
        ],
      ),
    );
    expect(d.leafOrder).toEqual(["A", "B", "C"]);
    expect((d.root as { left: DendrogramNode }).left).toEqual(merge(leaf("A"), leaf("B"), 1 - 0.7));
  });

  it("ANL-03: all cards in one group → everything merges at distance 0", () => {
    const cards = ["A", "B", "C"];
    const all = { A: at("g"), B: at("g"), C: at("g") };
    const d = clusterAverageLinkage(similarityMatrix(input(cards, [board("b1", cards, all)])));
    expect(d.root).toEqual(merge(merge(leaf("A"), leaf("B"), 0), leaf("C"), 0));
  });

  it("ANL-03: merge distances are monotone non-decreasing up the tree", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = similarityMatrix(randomInput(30, 15, 5, seed));
      const d = clusterAverageLinkage(s);
      checkMonotone(d.root as DendrogramNode);
      expect([...d.leafOrder].sort()).toEqual([...s.cardIds].sort());
    }
  });

  it("ANL-03: deterministic — same result when run twice and when board order is permuted", () => {
    // Coarse groups (3 per board, 6 boards) produce many exact ties.
    const base = randomInput(25, 6, 3, 42);
    const a = computeAnalysis(base, "open");
    const b = computeAnalysis(base, "open");
    expect(b.dendrogram).toEqual(a.dendrogram);

    const rand = rng(7);
    for (let k = 0; k < 5; k++) {
      const shuffled = [...base.boards].sort(() => rand() - 0.5);
      const c = computeAnalysis({ ...base, boards: shuffled }, "open");
      expect(c.similarity).toEqual(a.similarity);
      expect(c.dendrogram).toEqual(a.dendrogram);
    }
  });
});

describe("performance", () => {
  it("ANL-03: NFR-04: 200 cards × 1000 boards similarity + clustering runs in a few seconds", () => {
    const data = randomInput(200, 1000, 10, 99);
    const start = performance.now();
    const s = similarityMatrix(data);
    const d = clusterAverageLinkage(s);
    const ms = performance.now() - start;
    expect(d.leafOrder).toHaveLength(200);
    expect(ms).toBeLessThan(5000);
  });
});
