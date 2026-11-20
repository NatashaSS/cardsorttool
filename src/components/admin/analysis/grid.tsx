"use client";
// Shared heat-map plumbing: roving keyboard focus over table cells (one tab stop, arrow keys)
// and one hover/focus tooltip for the whole grid (delegated events, so 20 000 cells stay cheap).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

export type CellPos = { ri: number; ci: number };

function cellOf(target: EventTarget | null): (CellPos & { el: HTMLElement }) | null {
  const el = (target as HTMLElement | null)?.closest?.("[data-ri][data-ci]") as HTMLElement | null;
  if (!el) return null;
  return { ri: Number(el.dataset.ri), ci: Number(el.dataset.ci), el };
}

/**
 * Roving tabindex for a table whose row `ri` has cells 0..colCount(ri)-1 (data-ri / data-ci).
 * Arrow keys move, Home/End go to the row's first/last cell; the column is clamped to the row.
 */
export function useRovingGrid(rowCount: number, colCount: (ri: number) => number) {
  const [active, setActive] = useState<CellPos>({ ri: 0, ci: 0 });
  const tableRef = useRef<HTMLTableElement>(null);
  const moved = useRef(false);

  const clamp = useCallback(
    (ri: number, ci: number): CellPos => {
      const r = Math.min(Math.max(ri, 0), Math.max(rowCount - 1, 0));
      const c = Math.min(Math.max(ci, 0), Math.max(colCount(r) - 1, 0));
      return { ri: r, ci: c };
    },
    [rowCount, colCount],
  );

  // Keep the active cell valid when the data changes (e.g. after the toggle refetches).
  const current = clamp(active.ri, active.ci);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const el = tableRef.current?.querySelector<HTMLElement>(
      `[data-ri="${current.ri}"][data-ci="${current.ci}"]`,
    );
    el?.focus();
  }, [current.ri, current.ci]);

  const onKeyDown = (e: KeyboardEvent) => {
    const { ri, ci } = current;
    let next: CellPos | null = null;
    if (e.key === "ArrowUp") next = clamp(ri - 1, ci);
    else if (e.key === "ArrowDown") next = clamp(ri + 1, ci);
    else if (e.key === "ArrowLeft") next = clamp(ri, ci - 1);
    else if (e.key === "ArrowRight") next = clamp(ri, ci + 1);
    else if (e.key === "Home") next = clamp(ri, 0);
    else if (e.key === "End") next = clamp(ri, colCount(ri) - 1);
    if (!next) return;
    e.preventDefault();
    moved.current = true;
    setActive(next);
  };

  const onFocusCell = (e: FocusEvent) => {
    const cell = cellOf(e.target);
    if (cell && (cell.ri !== current.ri || cell.ci !== current.ci)) {
      setActive({ ri: cell.ri, ci: cell.ci });
    }
  };

  return { active: current, tableRef, onKeyDown, onFocusCell };
}

type Tip = CellPos & { rect: DOMRect };

/** Hover takes precedence over keyboard focus; both show the same tooltip. */
export function useCellTooltip() {
  const [hover, setHover] = useState<Tip | null>(null);
  const [focus, setFocus] = useState<Tip | null>(null);

  useEffect(() => {
    if (!hover && !focus) return;
    const clear = () => setHover(null);
    window.addEventListener("scroll", clear, true);
    return () => window.removeEventListener("scroll", clear, true);
  }, [hover, focus]);

  const handlers = {
    onMouseOver: (e: MouseEvent) => {
      const c = cellOf(e.target);
      if (!c) return setHover(null);
      if (hover && hover.ri === c.ri && hover.ci === c.ci) return;
      setHover({ ri: c.ri, ci: c.ci, rect: c.el.getBoundingClientRect() });
    },
    onMouseLeave: () => setHover(null),
    onFocus: (e: FocusEvent) => {
      const c = cellOf(e.target);
      setFocus(c ? { ri: c.ri, ci: c.ci, rect: c.el.getBoundingClientRect() } : null);
    },
    onBlur: () => setFocus(null),
  };
  return { tip: hover ?? focus, handlers };
}

export function CellTooltip({ tip, children }: { tip: Tip | null; children: ReactNode }) {
  if (!tip) return null;
  const above = tip.rect.top > 72;
  return (
    <div
      role="tooltip"
      data-testid="cell-tooltip"
      className="pointer-events-none fixed z-50 max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg"
      style={{
        left: tip.rect.left + tip.rect.width / 2,
        top: above ? tip.rect.top - 6 : tip.rect.bottom + 6,
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      {children}
    </div>
  );
}

/** Horizontal legend for the sequential scale. */
export function HeatLegend({ low, high, note }: { low: string; high: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span>0%</span>
      <span
        aria-hidden
        className="h-2.5 w-40 rounded-sm"
        style={{ background: `linear-gradient(to right, ${low}, ${high})` }}
      />
      <span>100%</span>
      {note && <span>{note}</span>}
    </div>
  );
}

/** Link styled as a secondary small button (CSV downloads). */
export const DOWNLOAD_LINK_CLASS =
  "inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
