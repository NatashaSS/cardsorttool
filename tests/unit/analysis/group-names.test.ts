import { describe, expect, it } from "vitest";
import {
  computeAnalysis,
  groupNameStats,
  normalizeGroupName,
  participantCardRows,
} from "@/server/analysis";
import { at, board, input } from "./fixtures";

const CARDS = ["A", "B", "C"];

/**
 * b1: "  Fruit " {A, B}; "Veg  stuff" {C}
 * b2: "fruit" {A}; "veg stuff" {B}; C in predefined group (ignored)
 * b3: "FRUIT  " {A, C}; B in a group named "   " (skipped)
 * b4: "fruit" {B}
 */
const FIXTURE = input(CARDS, [
  board("b1", CARDS, {
    A: at("b1x", "  Fruit "),
    B: at("b1x", "  Fruit "),
    C: at("b1y", "Veg  stuff"),
  }),
  board("b2", CARDS, {
    A: at("b2x", "fruit"),
    B: at("b2y", "veg stuff", "placeholder"),
    C: at("G1", "fruit", "predefined"),
  }),
  board("b3", CARDS, { A: at("b3x", "FRUIT  "), C: at("b3x", "FRUIT  "), B: at("b3e", "   ") }),
  board("b4", CARDS, { B: at("b4x", "fruit") }),
]);

describe("groupNameStats", () => {
  it("ANL-04: normalises trim / whitespace / case", () => {
    expect(normalizeGroupName("  Fruit ")).toBe("fruit");
    expect(normalizeGroupName("FRUIT  ")).toBe("fruit");
    expect(normalizeGroupName(" Veg \t  Stuff\n")).toBe("veg stuff");
    expect(normalizeGroupName("   ")).toBe("");
  });

  it("ANL-04: groups names, counts boards and top cards against a hand-computed fixture", () => {
    expect(groupNameStats(FIXTURE)).toEqual([
      {
        // Boards b1, b2, b3, b4 = 4. Spellings (one per group): Fruit 1, fruit 2, FRUIT 1 → "fruit".
        // Cards: A on b1, b2, b3 = 3; B on b1, b4 = 2; C on b3 = 1 (b2's predefined G1 ignored).
        normalizedName: "fruit",
        displayName: "fruit",
        boardCount: 4,
        topCards: [
          { cardId: "A", count: 3 },
          { cardId: "B", count: 2 },
          { cardId: "C", count: 1 },
        ],
      },
      {
        // Boards b1, b2 = 2. Spellings "Veg  stuff" 1, "veg stuff" 1 → tie → code-unit order.
        // Cards: C on b1, B on b2 → tie at 1 → card order B, C.
        normalizedName: "veg stuff",
        displayName: "Veg  stuff",
        boardCount: 2,
        topCards: [
          { cardId: "B", count: 1 },
          { cardId: "C", count: 1 },
        ],
      },
    ]);
  });

  it('ANL-04: "  Fruit ", "fruit", "FRUIT  " become one stat', () => {
    const stats = groupNameStats(
      input(CARDS, [
        board("b1", CARDS, { A: at("x", "  Fruit ") }),
        board("b2", CARDS, { A: at("x", "fruit") }),
        board("b3", CARDS, { A: at("x", "FRUIT  ") }),
      ]),
    );
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ normalizedName: "fruit", boardCount: 3 });
    // All spellings tie at 1 → alphabetical by code unit: "FRUIT" < "Fruit" < "fruit".
    expect(stats[0].displayName).toBe("FRUIT");
    expect(stats[0].topCards).toEqual([{ cardId: "A", count: 3 }]);
  });

  it("ANL-04: sorts by board count desc, then name; topCards limited to 10", () => {
    const many = Array.from({ length: 12 }, (_, i) => `k${i}`);
    const allIn = (g: string) => Object.fromEntries(many.map((c) => [c, at(g, "Zeta")]));
    const stats = groupNameStats(
      input(many, [
        board("b1", many, { k0: at("a", "beta"), k1: at("b", "alpha") }),
        board("b2", many, allIn("z")),
        board("b3", many, allIn("z")),
      ]),
    );
    expect(stats.map((s) => [s.normalizedName, s.boardCount])).toEqual([
      ["zeta", 2],
      ["alpha", 1],
      ["beta", 1],
    ]);
    expect(stats[0].topCards).toHaveLength(10);
    expect(stats[0].topCards[0]).toEqual({ cardId: "k0", count: 2 });
    expect(stats[0].topCards[9]).toEqual({ cardId: "k9", count: 2 });
  });

  it("ANL-04: zero boards → no stats", () => {
    expect(groupNameStats(input(CARDS, []))).toEqual([]);
  });
});

describe("participantCardRows", () => {
  it("ANL-05: flattens participant cards in board order then given order", () => {
    const data = input(CARDS, [
      board("b1", CARDS, {}, [
        { label: "Kiwi", groupName: "Fruit" },
        { label: "Leek", groupName: null },
      ]),
      board("b2", CARDS, {}, []),
      board("b3", CARDS, {}, [{ label: "Yam", groupName: "Veg" }]),
    ]);
    expect(participantCardRows(data)).toEqual([
      { boardId: "b1", label: "Kiwi", groupName: "Fruit" },
      { boardId: "b1", label: "Leek", groupName: null },
      { boardId: "b3", label: "Yam", groupName: "Veg" },
    ]);
  });
});

describe("computeAnalysis", () => {
  it("ANL-02: placement is null for open sorts and present for closed/hybrid", () => {
    expect(computeAnalysis(FIXTURE, "open").placement).toBeNull();
    expect(computeAnalysis(FIXTURE, "closed").placement?.n).toBe(4);
    expect(computeAnalysis(FIXTURE, "hybrid").placement?.columns.map((c) => c.id)).toEqual([
      "__other",
      "__unsorted",
    ]);
  });

  it("ANL-04: group names for open/hybrid only", () => {
    expect(computeAnalysis(FIXTURE, "closed").groupNames).toEqual([]);
    expect(computeAnalysis(FIXTURE, "open").groupNames).toHaveLength(2);
    expect(computeAnalysis(FIXTURE, "hybrid").groupNames).toHaveLength(2);
  });

  it("ANL-06: zero boards produces an empty but well-formed result", () => {
    const r = computeAnalysis(input(CARDS, []), "hybrid");
    expect(r.n).toBe(0);
    expect(r.similarity.ratio.flat().every((x) => x === null)).toBe(true);
    expect(r.placement?.ratio.flat().every((x) => x === null)).toBe(true);
    expect(r.dendrogram.leafOrder).toEqual(CARDS);
    expect(r.groupNames).toEqual([]);
    expect(r.participantCards).toEqual([]);
  });

  it("ANL-06: n, similarity, dendrogram and participant cards are wired together", () => {
    const r = computeAnalysis(FIXTURE, "open");
    expect(r.n).toBe(4);
    expect(r.similarity.cardIds).toEqual(CARDS);
    expect([...r.dendrogram.leafOrder].sort()).toEqual(CARDS);
    expect(r.participantCards).toEqual([]);
  });
});
