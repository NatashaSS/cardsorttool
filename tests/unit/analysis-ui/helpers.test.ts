import { describe, expect, it } from "vitest";
import { csvCell, placementCsv, similarityCsv, toCsv } from "@/components/admin/analysis/csv";
import {
  cutDendrogram,
  layoutDendrogram,
  similarityToDistance,
} from "@/components/admin/analysis/dendrogram";
import { topColumns } from "@/components/admin/analysis/PlacementMatrix";
import {
  cellPct,
  contrastRatio,
  formatPct,
  HEAT_HIGH,
  HEAT_LOW,
  heatColor,
  heatTextColor,
} from "@/components/admin/analysis/scale";
import type { AnalysisResult, DendrogramNode, PlacementMatrix } from "@/lib/api-types";

const leaf = (cardId: string): DendrogramNode => ({ type: "leaf", cardId });
const merge = (left: DendrogramNode, right: DendrogramNode, distance: number): DendrogramNode => ({
  type: "merge",
  left,
  right,
  distance,
  size: 0,
});
// ((a, b)@0.1, (c, d)@0.4)@0.9 , then e joins at 1
const tree = merge(
  merge(merge(leaf("a"), leaf("b"), 0.1), merge(leaf("c"), leaf("d"), 0.4), 0.9),
  leaf("e"),
  1,
);

describe("analysis UI helpers", () => {
  it("ANL-01: sequential scale runs light → accent, monotone, with readable text", () => {
    expect(heatColor(0)).toBe(HEAT_LOW);
    expect(heatColor(1)).toBe(HEAT_HIGH);
    expect(heatColor(-1)).toBe(HEAT_LOW);
    expect(heatColor(2)).toBe(HEAT_HIGH);
    // Contrast against white grows with the value (single hue, getting darker).
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const c = contrastRatio(heatColor(t), "#ffffff");
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    for (let t = 0; t <= 1.0001; t += 0.05) {
      expect(contrastRatio(heatColor(t), heatTextColor(t))).toBeGreaterThanOrEqual(4.5);
    }
    expect(heatTextColor(0)).toBe("#000000");
    expect(heatTextColor(1)).toBe("#ffffff");
  });

  it("ANL-01: percentage formatting", () => {
    expect(formatPct(0.456)).toBe("46%");
    expect(formatPct(null)).toBe("–");
    expect(cellPct(1)).toBe("100");
    expect(cellPct(null)).toBe("");
  });

  it("ANL-03: cutting the dendrogram yields clusters in leaf order", () => {
    expect(cutDendrogram(null, 0.5)).toEqual([]);
    expect(cutDendrogram(tree, 0)).toEqual([["a"], ["b"], ["c"], ["d"], ["e"]]);
    expect(cutDendrogram(tree, similarityToDistance(90))).toEqual([
      ["a", "b"],
      ["c"],
      ["d"],
      ["e"],
    ]);
    expect(cutDendrogram(tree, similarityToDistance(50))).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(cutDendrogram(tree, similarityToDistance(10))).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(cutDendrogram(tree, 1)).toEqual([["a", "b", "c", "d", "e"]]);
  });

  it("ANL-03: dendrogram layout places merges between their children", () => {
    const links = layoutDendrogram(tree, ["a", "b", "c", "d", "e"], 0.5);
    expect(links).toHaveLength(4);
    const ab = links.find((l) => l.d === 0.1);
    expect(ab).toMatchObject({ y1: 0.5, y2: 1.5, y: 1, d1: 0, d2: 0, inCluster: true });
    const top = links.find((l) => l.d === 0.9);
    expect(top).toMatchObject({ y1: 1, y2: 3, y: 2, d1: 0.1, d2: 0.4, inCluster: false });
  });

  it("ANL-02: top group per card ignores Unsorted and keeps ties", () => {
    const p: PlacementMatrix = {
      cardIds: ["a", "b", "c"],
      columns: [
        { kind: "group", id: "g1", label: "G1" },
        { kind: "other", id: "__other", label: "Other" },
        { kind: "unsorted", id: "__unsorted", label: "Unsorted" },
      ],
      counts: [
        [1, 2, 5],
        [2, 2, 0],
        [0, 0, 4],
      ],
      ratio: [],
      n: 4,
    };
    expect(topColumns(p, 0)).toEqual([1]);
    expect(topColumns(p, 1)).toEqual([0, 1]);
    expect(topColumns(p, 2)).toEqual([]);
  });

  it("ANL-07: CSV cells are RFC 4180 quoted and protected against formula injection", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    for (const s of ["=1+1", "+1", "-1", "@x", "\tx"]) expect(csvCell(s)).toBe(`'${s}`);
    expect(csvCell("\rx")).toBe('"\'\rx"');
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(
      toCsv([
        ["a", 1],
        ["b", null],
      ]),
    ).toBe("﻿a,1\r\nb,\r\n");
  });

  it("ANL-07: matrix CSVs use leaf order / admin order and blank for null", () => {
    const result = {
      n: 2,
      similarity: {
        cardIds: ["a", "b"],
        together: [],
        both: [],
        ratio: [
          [1, null],
          [null, 1],
        ],
      },
      dendrogram: { root: null, leafOrder: ["b", "a"] },
      placement: null,
      groupNames: [],
      participantCards: [],
    } as AnalysisResult;
    const labels = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    expect(similarityCsv(labels, result)).toBe("﻿Similarity % (n = 2),B,A\r\nB,100,\r\nA,,100\r\n");
    expect(placementCsv(labels, result)).toBeNull();
    const withPlacement = {
      ...result,
      placement: {
        cardIds: ["a"],
        columns: [{ kind: "unsorted", id: "__unsorted", label: "Unsorted" }],
        counts: [[1]],
        ratio: [[1 / 3]],
        n: 3,
      },
    } as AnalysisResult;
    expect(placementCsv(labels, withPlacement)).toBe("﻿Placement % (n = 3),Unsorted\r\nA,33.3\r\n");
  });
});
