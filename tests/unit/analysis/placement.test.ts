import { describe, expect, it } from "vitest";
import { placementMatrix } from "@/server/analysis";
import { at, board, input } from "./fixtures";

const CARDS = ["A", "B"];
const GROUPS = [
  { id: "G1", name: "Fruit" },
  { id: "G2", name: "Veg" },
];
const pre = (id: string) => at(id, id, "predefined");

/**
 * b1: A → G1, B → participant group p1
 * b2: A → G1, B unsorted
 * b3: A → participant group p2, B → G2
 */
const FIXTURE = input(
  CARDS,
  [
    board("b1", CARDS, { A: pre("G1"), B: at("p1", "Mine") }),
    board("b2", CARDS, { A: pre("G1") }),
    board("b3", CARDS, { A: at("p2", "Other stuff"), B: pre("G2") }),
  ],
  GROUPS,
);

describe("placementMatrix", () => {
  it("ANL-02: hybrid — predefined groups, Other, Unsorted against a hand-computed fixture", () => {
    const m = placementMatrix(FIXTURE, "hybrid");
    expect(m.cardIds).toEqual(CARDS);
    expect(m.n).toBe(3);
    expect(m.columns).toEqual([
      { kind: "group", id: "G1", label: "Fruit" },
      { kind: "group", id: "G2", label: "Veg" },
      { kind: "other", id: "__other", label: "Other (participant groups)" },
      { kind: "unsorted", id: "__unsorted", label: "Unsorted" },
    ]);
    // A: G1 on b1, b2 = 2; Other (p2) on b3 = 1.
    // B: G2 on b3 = 1; Other (p1) on b1 = 1; Unsorted on b2 = 1.
    expect(m.counts).toEqual([
      [2, 0, 1, 0],
      [0, 1, 1, 1],
    ]);
    // ratio = counts / 3
    expect(m.ratio).toEqual([
      [2 / 3, 0, 1 / 3, 0],
      [0, 1 / 3, 1 / 3, 1 / 3],
    ]);
  });

  it("ANL-02: hybrid rows sum to n", () => {
    const m = placementMatrix(FIXTURE, "hybrid");
    for (const row of m.counts) expect(row.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("ANL-02: closed — no Other column; non-predefined placements are ignored", () => {
    const m = placementMatrix(FIXTURE, "closed");
    expect(m.columns.map((c) => c.id)).toEqual(["G1", "G2", "__unsorted"]);
    // Same as hybrid minus the Other column (A's p2 and B's p1 placements are dropped).
    expect(m.counts).toEqual([
      [2, 0, 0],
      [0, 1, 1],
    ]);
  });

  it("ANL-02: zero boards → counts 0, ratio null, n 0", () => {
    const m = placementMatrix(input(CARDS, [], GROUPS), "closed");
    expect(m.n).toBe(0);
    expect(m.counts).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(m.ratio).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
  });

  it("ANL-02: one board, a card never sorted → 100% Unsorted", () => {
    const m = placementMatrix(
      input(CARDS, [board("b1", CARDS, { A: pre("G2") })], GROUPS),
      "closed",
    );
    expect(m.counts).toEqual([
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(m.ratio).toEqual([
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });
});
