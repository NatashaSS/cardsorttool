// ANL-01 — similarity matrix. Pure; see docs/DESIGN.md §11.
import type { AnalysisInput, SimilarityMatrix } from "@/lib/api-types";

/**
 * For every pair of predefined cards (i, j), in `input.cards` order:
 * - `both[i][j]`     = boards where both cards have a non-null placement;
 * - `together[i][j]` = boards where both were placed in the same groupId;
 * - `ratio[i][j]`    = together / both, or null when both = 0.
 * Diagonal: both = together = boards where the card was sorted; ratio 1 (or null if never sorted).
 */
export function similarityMatrix(input: AnalysisInput): SimilarityMatrix {
  const cardIds = input.cards.map((c) => c.id);
  const n = cardIds.length;
  // Flat typed arrays keep the 200 × 1000 case fast (NFR-04).
  const both = new Int32Array(n * n);
  const together = new Int32Array(n * n);

  for (const board of input.boards) {
    // Sorted card indices on this board, bucketed by group.
    const sorted: number[] = [];
    const byGroup = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const p = board.placements[cardIds[i]];
      if (!p) continue;
      sorted.push(i);
      const bucket = byGroup.get(p.groupId);
      if (bucket) bucket.push(i);
      else byGroup.set(p.groupId, [i]);
    }
    for (let a = 0; a < sorted.length; a++) {
      const row = sorted[a] * n;
      for (let b = 0; b < sorted.length; b++) both[row + sorted[b]]++;
    }
    for (const members of byGroup.values()) {
      for (let a = 0; a < members.length; a++) {
        const row = members[a] * n;
        for (let b = 0; b < members.length; b++) together[row + members[b]]++;
      }
    }
  }

  const bothRows: number[][] = [];
  const togetherRows: number[][] = [];
  const ratioRows: (number | null)[][] = [];
  for (let i = 0; i < n; i++) {
    const bRow = new Array<number>(n);
    const tRow = new Array<number>(n);
    const rRow = new Array<number | null>(n);
    for (let j = 0; j < n; j++) {
      const b = both[i * n + j];
      const t = together[i * n + j];
      bRow[j] = b;
      tRow[j] = t;
      rRow[j] = b === 0 ? null : t / b;
    }
    bothRows.push(bRow);
    togetherRows.push(tRow);
    ratioRows.push(rRow);
  }
  return { cardIds, together: togetherRows, both: bothRows, ratio: ratioRows };
}
