"use client";
// ANL-02: cards × (predefined groups, Other, Unsorted) heat-map; top group per card highlighted.
import { memo, useCallback, useMemo } from "react";
import type { PlacementMatrix as Placement } from "@/lib/api-types";
import { CellTooltip, HeatLegend, useCellTooltip, useRovingGrid } from "./grid";
import { formatPct, HEAT_HIGH, HEAT_LOW, heatColor, heatTextColor } from "./scale";

/**
 * Column indices of the top group(s) for one card row: the highest count among group and
 * "Other" columns (not "Unsorted"); ties all count; none when the card was never placed.
 */
export function topColumns(placement: Placement, row: number): number[] {
  let best = 0;
  let out: number[] = [];
  placement.columns.forEach((col, ci) => {
    if (col.kind === "unsorted") return;
    const c = placement.counts[row][ci];
    if (c > best) {
      best = c;
      out = [ci];
    } else if (c === best && c > 0) out.push(ci);
  });
  return out;
}

type Row = { id: string; label: string; ratios: (number | null)[]; top: number[] };

export function PlacementMatrix({
  placement,
  labels,
}: {
  placement: Placement;
  labels: Map<string, string>;
}) {
  const rows: Row[] = useMemo(
    () =>
      placement.cardIds.map((id, i) => ({
        id,
        label: labels.get(id) ?? id,
        ratios: placement.ratio[i],
        top: topColumns(placement, i),
      })),
    [placement, labels],
  );
  const colLabels = useMemo(() => placement.columns.map((c) => c.label), [placement.columns]);
  const colCount = useCallback(() => placement.columns.length, [placement.columns.length]);
  const { active, tableRef, onKeyDown, onFocusCell } = useRovingGrid(rows.length, colCount);
  const { tip, handlers } = useCellTooltip();

  if (rows.length === 0) return <p className="text-sm text-muted">This study has no cards.</p>;

  const describe = (ri: number, ci: number): string => {
    const card = rows[ri].label;
    const col = placement.columns[ci];
    const count = placement.counts[ri][ci];
    const where = col.kind === "unsorted" ? "left unsorted" : `placed in “${col.label}”`;
    const top = rows[ri].top.includes(ci) ? " · top group" : "";
    return `${card}: ${where} on ${count} of ${placement.n} boards (${formatPct(placement.ratio[ri][ci])})${top}`;
  };

  return (
    <div className="flex flex-col gap-3">
      <HeatLegend
        low={HEAT_LOW}
        high={HEAT_HIGH}
        note={`Values are % of the ${placement.n} boards. Outlined + bold = the card's top group.`}
      />
      <div className="max-h-[75vh] overflow-auto rounded-lg border border-line bg-surface">
        <table
          ref={tableRef}
          role="grid"
          aria-label="Placement matrix"
          data-testid="placement-matrix"
          className="border-separate text-xs"
          style={{ borderSpacing: 2 }}
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
              <th
                scope="col"
                className="sticky top-0 left-0 z-20 bg-surface px-3 py-2 text-left font-medium text-muted"
              >
                Card
              </th>
              {placement.columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  title={col.label}
                  className="sticky top-0 z-10 w-16 min-w-16 bg-surface px-1 py-2 align-bottom font-medium text-ink"
                >
                  <div
                    className={
                      col.kind === "group"
                        ? "line-clamp-3 break-words"
                        : "line-clamp-3 text-muted italic"
                    }
                  >
                    {col.label}
                  </div>
                </th>
              ))}
              <th
                scope="col"
                className="sticky top-0 z-10 bg-surface px-3 py-2 text-left align-bottom font-medium text-muted"
              >
                Top group
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <PlacementRow
                key={row.id}
                row={row}
                ri={ri}
                columns={colLabels}
                activeCi={active.ri === ri ? active.ci : -1}
                activeLabel={active.ri === ri ? describe(ri, active.ci) : ""}
              />
            ))}
          </tbody>
        </table>
      </div>
      <CellTooltip tip={tip}>{tip && describe(tip.ri, tip.ci)}</CellTooltip>
    </div>
  );
}

const PlacementRow = memo(function PlacementRow({
  row,
  ri,
  columns,
  activeCi,
  activeLabel,
}: {
  row: Row;
  ri: number;
  columns: string[];
  activeCi: number;
  activeLabel: string;
}) {
  return (
    <tr>
      <th
        scope="row"
        title={row.label}
        className="sticky left-0 z-10 bg-surface py-0 pr-2 pl-3 text-left font-normal whitespace-nowrap text-ink"
      >
        <div className="max-w-56 truncate">{row.label}</div>
      </th>
      {row.ratios.map((v, ci) => {
        const top = row.top.includes(ci);
        return (
          <td
            key={ci}
            data-ri={ri}
            data-ci={ci}
            data-top={top || undefined}
            tabIndex={ci === activeCi ? 0 : -1}
            aria-label={ci === activeCi ? activeLabel : undefined}
            className="h-8 cursor-default rounded-[3px] text-center tabular-nums outline-offset-1 hover:outline-2 hover:outline-ink focus-visible:outline-2 focus-visible:outline-ink"
            style={{
              background: v === null ? "transparent" : heatColor(v),
              color: v === null ? undefined : heatTextColor(v),
              fontWeight: top ? 700 : undefined,
              boxShadow: top ? "inset 0 0 0 2px var(--color-ink)" : undefined,
            }}
          >
            {formatPct(v)}
          </td>
        );
      })}
      <td className="px-3 whitespace-nowrap text-muted">
        {row.top.length > 0 ? row.top.map((ci) => columns[ci]).join(", ") : "—"}
      </td>
    </tr>
  );
});
