"use client";
// ANL-01: lower-triangular similarity heat-map in dendrogram leaf order.
import { memo, useCallback, useMemo } from "react";
import type { SimilarityMatrix as Sim } from "@/lib/api-types";
import { CellTooltip, HeatLegend, useCellTooltip, useRovingGrid } from "./grid";
import { cellPct, formatPct, HEAT_HIGH, HEAT_LOW, heatColor, heatTextColor } from "./scale";

type Row = { id: string; label: string; values: (number | null)[] };

/** Cell size in px by card count, so 200 cards still fit a scrollable view. */
export function similarityCellSize(n: number): number {
  if (n <= 15) return 40;
  if (n <= 30) return 32;
  if (n <= 60) return 24;
  return 14;
}

export function SimilarityMatrix({
  similarity,
  leafOrder,
  labels,
}: {
  similarity: Sim;
  leafOrder: string[];
  labels: Map<string, string>;
}) {
  const { order, index } = useMemo(() => {
    const index = new Map(similarity.cardIds.map((id, i) => [id, i]));
    const fromLeaves = leafOrder.filter((id) => index.has(id));
    return { order: fromLeaves.length === index.size ? fromLeaves : similarity.cardIds, index };
  }, [similarity, leafOrder]);

  // Rendered row ri = card order[ri + 1]; its cells are columns order[0..ri].
  const rows: Row[] = useMemo(
    () =>
      order.slice(1).map((id, k) => {
        const i = index.get(id) as number;
        return {
          id,
          label: labels.get(id) ?? id,
          values: order.slice(0, k + 1).map((b) => similarity.ratio[i][index.get(b) as number]),
        };
      }),
    [order, index, labels, similarity],
  );
  const cols = useMemo(() => order.slice(0, -1).map((id) => labels.get(id) ?? id), [order, labels]);

  const colCount = useCallback((ri: number) => ri + 1, []);
  const { active, tableRef, onKeyDown, onFocusCell } = useRovingGrid(rows.length, colCount);
  const { tip, handlers } = useCellTooltip();

  if (order.length < 2) {
    return <p className="text-sm text-muted">The similarity matrix needs at least two cards.</p>;
  }

  const size = similarityCellSize(order.length);
  const showNumbers = size >= 24;

  const describe = (ri: number, ci: number): string => {
    const a = order[ri + 1];
    const b = order[ci];
    const i = index.get(a) as number;
    const j = index.get(b) as number;
    const both = similarity.both[i][j];
    const together = similarity.together[i][j];
    const names = `${labels.get(a) ?? a} & ${labels.get(b) ?? b}`;
    if (both === 0) return `${names}: never sorted on the same board`;
    return `${names}: together in ${together} of ${both} boards (${formatPct(together / both)})`;
  };

  return (
    <div className="flex flex-col gap-3">
      <HeatLegend
        low={HEAT_LOW}
        high={HEAT_HIGH}
        note="Values are % of boards (where both cards were sorted) that put the pair in the same group. Blank = never both sorted."
      />
      <div
        className="max-h-[75vh] overflow-auto rounded-lg border border-line bg-surface"
        data-testid="similarity-scroll"
      >
        <table
          ref={tableRef}
          role="grid"
          aria-label="Similarity matrix"
          data-testid="similarity-matrix"
          className="border-separate"
          style={{ borderSpacing: size >= 24 ? 2 : 1 }}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            onFocusCell(e);
            handlers.onFocus(e);
          }}
          onBlur={handlers.onBlur}
          onMouseOver={handlers.onMouseOver}
          onMouseLeave={handlers.onMouseLeave}
        >
          <thead>
            <tr>
              <td className="sticky top-0 left-0 z-20 bg-surface" />
              {cols.map((label, ci) => (
                <th
                  key={ci}
                  scope="col"
                  className="sticky top-0 z-10 bg-surface p-0 align-bottom font-normal"
                  style={{ width: size, minWidth: size }}
                  title={label}
                >
                  <div
                    className="mx-auto max-h-36 overflow-hidden text-ellipsis whitespace-nowrap pb-1 text-left text-xs text-ink"
                    style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                  >
                    {label}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <MatrixRow
                key={row.id}
                row={row}
                ri={ri}
                size={size}
                showNumbers={showNumbers}
                activeCi={active.ri === ri ? active.ci : -1}
                activeLabel={active.ri === ri ? describe(ri, active.ci) : ""}
              />
            ))}
          </tbody>
        </table>
      </div>
      <CellTooltip tip={tip}>{tip && describe(tip.ri, tip.ci)}</CellTooltip>
      <p className="text-xs text-muted">
        Tip: focus the matrix and use the arrow keys to read each pair. Cards are ordered by the
        dendrogram clustering.
      </p>
    </div>
  );
}

const MatrixRow = memo(function MatrixRow({
  row,
  ri,
  size,
  showNumbers,
  activeCi,
  activeLabel,
}: {
  row: Row;
  ri: number;
  size: number;
  showNumbers: boolean;
  activeCi: number;
  activeLabel: string;
}) {
  return (
    <tr>
      <th
        scope="row"
        className="sticky left-0 z-10 bg-surface py-0 pr-2 pl-3 text-left text-xs font-normal whitespace-nowrap text-ink"
        style={{ height: size }}
        title={row.label}
      >
        <div className="max-w-52 truncate">{row.label}</div>
      </th>
      {row.values.map((v, ci) => (
        <td
          key={ci}
          data-ri={ri}
          data-ci={ci}
          tabIndex={ci === activeCi ? 0 : -1}
          aria-label={ci === activeCi ? activeLabel : undefined}
          className="cursor-default rounded-[3px] p-0 text-center align-middle tabular-nums outline-offset-1 hover:outline-2 hover:outline-ink focus-visible:outline-2 focus-visible:outline-ink"
          style={{
            width: size,
            minWidth: size,
            height: size,
            fontSize: size >= 32 ? 12 : 10,
            background: v === null ? "transparent" : heatColor(v),
            color: v === null ? undefined : heatTextColor(v),
            boxShadow: v === null ? "inset 0 0 0 1px var(--color-line)" : undefined,
          }}
        >
          {showNumbers ? cellPct(v) : null}
        </td>
      ))}
    </tr>
  );
});
