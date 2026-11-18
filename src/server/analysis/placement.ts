// ANL-02 — placement matrix (closed / hybrid). Pure; see docs/DESIGN.md §11.
import type { AnalysisInput, PlacementColumn, PlacementMatrix } from "@/lib/api-types";
import type { SortType } from "@/lib/types";

export const OTHER_COLUMN: PlacementColumn = {
  kind: "other",
  id: "__other",
  label: "Other (participant groups)",
};
export const UNSORTED_COLUMN: PlacementColumn = {
  kind: "unsorted",
  id: "__unsorted",
  label: "Unsorted",
};

/**
 * Rows: predefined cards (input.cards order). Columns: each predefined group (input.groups
 * order), then "Other (participant groups)" for hybrid sorts only, then "Unsorted".
 *
 * A placement counts under a group column when its groupId is one of `input.groups`
 * (whatever its groupKind). Any other placement (a participant/placeholder group, or an
 * unknown groupId) counts under "Other" for hybrid sorts; for closed sorts it cannot happen
 * legitimately and is ignored, so such a row may then sum to less than n. A null placement
 * counts under "Unsorted". Open sorts have no predefined groups and are handled like closed
 * (computeAnalysis does not call this for open sorts).
 *
 * ratio = counts / n with n = number of boards, or null when n = 0.
 */
export function placementMatrix(input: AnalysisInput, sortType: SortType): PlacementMatrix {
  const hybrid = sortType === "hybrid";
  const columns: PlacementColumn[] = [
    ...input.groups.map((g): PlacementColumn => ({ kind: "group", id: g.id, label: g.name })),
    ...(hybrid ? [OTHER_COLUMN] : []),
    UNSORTED_COLUMN,
  ];
  const groupCol = new Map(input.groups.map((g, i) => [g.id, i]));
  const otherCol = hybrid ? input.groups.length : -1;
  const unsortedCol = columns.length - 1;
  const n = input.boards.length;

  const counts = input.cards.map((card) => {
    const row = new Array<number>(columns.length).fill(0);
    for (const board of input.boards) {
      const p = board.placements[card.id];
      if (!p) {
        row[unsortedCol]++;
        continue;
      }
      const col = groupCol.get(p.groupId);
      if (col !== undefined) row[col]++;
      else if (otherCol >= 0) row[otherCol]++;
      // closed sort + non-predefined group: ignored (see doc comment).
    }
    return row;
  });
  const ratio = counts.map((row) => row.map((c) => (n === 0 ? null : c / n)));
  return { cardIds: input.cards.map((c) => c.id), columns, counts, ratio, n };
}
