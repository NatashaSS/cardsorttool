import { describe, expect, it } from "vitest";
import { similarityMatrix } from "@/server/analysis";
import { at, board, input } from "./fixtures";

const CARDS = ["A", "B", "C", "D"];

/**
 * b1: {A, B} in g1, {C, D} in g2
 * b2: {A, B} in g1, {C} in g2, D unsorted
 * b3: {A, C} in g1, {B} in g2, D unsorted
 */
const FIXTURE = input(CARDS, [
  board("b1", CARDS, { A: at("b1g1"), B: at("b1g1"), C: at("b1g2"), D: at("b1g2") }),
  board("b2", CARDS, { A: at("b2g1"), B: at("b2g1"), C: at("b2g2") }),
  board("b3", CARDS, { A: at("b3g1"), C: at("b3g1"), B: at("b3g2") }),
]);

describe("similarityMatrix", () => {
  it("ANL-01: computes together/both/ratio against a hand-computed fixture", () => {
    const s = similarityMatrix(FIXTURE);
    expect(s.cardIds).toEqual(CARDS);
    // both: A, B, C sorted on all 3 boards; D only on b1.
    //   A-B = A-C = B-C = 3; anything with D = 1; diagonal = sorted count.
    expect(s.both).toEqual([
      [3, 3, 3, 1],
      [3, 3, 3, 1],
      [3, 3, 3, 1],
      [1, 1, 1, 1],
    ]);
    // together: A-B on b1, b2 = 2; A-C on b3 = 1; C-D on b1 = 1; others 0.
    expect(s.together).toEqual([
      [3, 2, 1, 0],
      [2, 3, 0, 0],
      [1, 0, 3, 1],
      [0, 0, 1, 1],
    ]);
    // ratio: A-B 2/3, A-C 1/3, C-D 1/1, others 0; diagonal 1.
    expect(s.ratio).toEqual([
      [1, 2 / 3, 1 / 3, 0],
      [2 / 3, 1, 0, 0],
      [1 / 3, 0, 1, 1],
      [0, 0, 1, 1],
    ]);
  });

  it("ANL-01: is symmetric", () => {
    const s = similarityMatrix(FIXTURE);
    for (let i = 0; i < CARDS.length; i++)
      for (let j = 0; j < CARDS.length; j++) {
        expect(s.together[i][j]).toBe(s.together[j][i]);
        expect(s.both[i][j]).toBe(s.both[j][i]);
        expect(s.ratio[i][j]).toBe(s.ratio[j][i]);
      }
  });

  it("ANL-01: zero boards → all counts 0 and all ratios null", () => {
    const s = similarityMatrix(input(["A", "B"], []));
    expect(s.both).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(s.together).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(s.ratio).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("ANL-01: zero cards → empty matrices", () => {
    expect(similarityMatrix(input([], [board("b1", [], {})]))).toEqual({
      cardIds: [],
      together: [],
      both: [],
      ratio: [],
    });
  });

  it("ANL-01: one board → ratios are 0 or 1", () => {
    const cards = ["A", "B", "C"];
    const s = similarityMatrix(
      input(cards, [board("b1", cards, { A: at("g1"), B: at("g1"), C: at("g2") })]),
    );
    expect(s.ratio).toEqual([
      [1, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
    ]);
  });

  it("ANL-01: a card that is never sorted has null ratios (including its diagonal)", () => {
    const cards = ["A", "B", "X"];
    const s = similarityMatrix(
      input(cards, [
        board("b1", cards, { A: at("g1"), B: at("g1") }),
        board("b2", cards, { A: at("g1"), B: at("g2") }),
      ]),
    );
    // X: both = 0 everywhere → null. A-B: together 1 (b1) / both 2 = 0.5.
    expect(s.both[2]).toEqual([0, 0, 0]);
    expect(s.ratio).toEqual([
      [1, 0.5, null],
      [0.5, 1, null],
      [null, null, null],
    ]);
  });

  it("ANL-01: all cards in one group on every board → all ratios 1", () => {
    const cards = ["A", "B", "C"];
    const all = { A: at("g"), B: at("g"), C: at("g") };
    const s = similarityMatrix(input(cards, [board("b1", cards, all), board("b2", cards, all)]));
    expect(s.together).toEqual([
      [2, 2, 2],
      [2, 2, 2],
      [2, 2, 2],
    ]);
    expect(s.ratio.flat().every((r) => r === 1)).toBe(true);
  });

  it("ANL-01: same groupId on different boards does not count as together across boards", () => {
    // Group ids are per board; the matrix only ever compares cards within one board.
    const cards = ["A", "B"];
    const s = similarityMatrix(
      input(cards, [
        board("b1", cards, { A: at("g"), B: at("h") }),
        board("b2", cards, { A: at("h"), B: at("g") }),
      ]),
    );
    expect(s.together[0][1]).toBe(0);
    expect(s.ratio[0][1]).toBe(0);
  });
});
