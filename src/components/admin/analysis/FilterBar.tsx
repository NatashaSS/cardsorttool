"use client";
// ANL-09: "Filter by participant" — one disclosure per participant field with checkboxes
// (value + board count, a search box for long lists), active filters as removable chips.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/components/ui";
import {
  filterValueLabel,
  isFilterActive,
  NOT_ANSWERED,
  normaliseText,
  toggleFilterValue,
  type AnalysisFilter,
  type FilterFieldOptions,
} from "@/lib/analysis-filter";

/** Lists longer than this get a search box. */
const SEARCH_THRESHOLD = 8;

export function FilterBar({
  options,
  filter,
  onChange,
}: {
  options: FilterFieldOptions[];
  /** The requested filter (reflected immediately; data follows when the refetch returns). */
  filter: AnalysisFilter;
  onChange: (next: AnalysisFilter) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const active = options.filter((f) => filter[f.key]?.length);

  return (
    <div className="flex flex-col gap-2" data-testid="analysis-filters">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium" id="filter-heading">
          Filter by participant
        </span>
        {options.map((field) => (
          <FieldFilter
            key={field.key}
            field={field}
            selected={filter[field.key] ?? []}
            open={openKey === field.key}
            onOpenChange={(open) => setOpenKey(open ? field.key : null)}
            onToggle={(value, on) => onChange(toggleFilterValue(filter, field.key, value, on))}
          />
        ))}
      </div>
      {isFilterActive(filter) && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {active.map((field) => {
            const text = `${field.label}: ${filter[field.key]
              .map((v) => filterValueLabel(field, v))
              .join(", ")}`;
            return (
              <li
                key={field.key}
                className="inline-flex max-w-md items-center gap-1 rounded-full border border-accent/30 bg-accent/5 py-0.5 pr-1 pl-3 text-sm"
              >
                <span className="truncate" title={text} data-testid="filter-chip">
                  {text}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...filter };
                    delete next[field.key];
                    onChange(next);
                  }}
                  aria-label={`Remove filter ${field.label}`}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-accent/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span aria-hidden>×</span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => onChange({})}
              className="rounded-md px-2 py-0.5 text-sm font-medium text-accent hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Clear all
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function FieldFilter({
  field,
  selected,
  open,
  onOpenChange,
  onToggle,
}: {
  field: FilterFieldOptions;
  selected: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (value: string, on: boolean) => void;
}) {
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const searchable = field.values.length > SEARCH_THRESHOLD;

  // Text values compare case-insensitively, so a URL spelling matches its option.
  const selectedKeys = useMemo(
    () => new Set(selected.map((v) => (field.input === "text" ? normaliseText(v) : v))),
    [selected, field.input],
  );
  const isSelected = (value: string) =>
    selectedKeys.has(field.input === "text" ? normaliseText(value) : value);
  /** The spelling in the current filter for a value (to remove exactly that entry). */
  const selectedSpelling = (value: string) =>
    field.input === "text"
      ? (selected.find((v) => normaliseText(v) === normaliseText(value)) ?? value)
      : value;

  const visible = useMemo(() => {
    const q = normaliseText(query);
    if (!q) return field.values;
    return field.values.filter(
      (o) => o.value === NOT_ANSWERED || normaliseText(o.label).includes(q),
    );
  }, [field.values, query]);

  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  // On open: focus the search box (or first checkbox); close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChangeRef.current(false);
    };
    document.addEventListener("mousedown", onDown);
    panelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      onOpenChange(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (open && e.relatedTarget && !wrapRef.current?.contains(e.relatedTarget as Node)) {
          onOpenChange(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setQuery("");
          onOpenChange(!open);
        }}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          selected.length > 0
            ? "border-accent/40 bg-accent/5 text-ink"
            : "border-line bg-surface text-ink hover:bg-canvas",
        )}
      >
        {field.label}
        {selected.length > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-white tabular-nums">
            <span className="sr-only">, </span>
            {selected.length}
            <span className="sr-only"> selected</span>
          </span>
        )}
        <svg aria-hidden viewBox="0 0 12 12" className="size-3 text-muted">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={`Filter by ${field.label}`}
          className="absolute top-full left-0 z-30 mt-1 flex w-80 flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-lg"
        >
          {searchable && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${field.label.toLowerCase()}…`}
              aria-label={`Search ${field.label}`}
              className="h-8 w-full rounded-md border border-line bg-surface px-2 text-sm focus:border-accent focus:outline-2 focus:outline-accent/30"
            />
          )}
          {field.values.length === 0 ? (
            <p className="text-sm text-muted">No answers among the analysed boards.</p>
          ) : (
            <ul className="-mx-1 flex max-h-72 flex-col overflow-y-auto">
              {visible.map((o) => {
                const checked = isSelected(o.value);
                return (
                  <li key={o.value === NOT_ANSWERED ? "\0" : o.value}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-canvas">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-accent"
                        checked={checked}
                        onChange={(e) =>
                          onToggle(
                            e.target.checked ? o.value : selectedSpelling(o.value),
                            e.target.checked,
                          )
                        }
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          o.value === NOT_ANSWERED && "italic text-muted",
                        )}
                        title={o.label}
                      >
                        {o.label}
                      </span>
                      <span className="text-muted tabular-nums">
                        {o.count}
                        <span className="sr-only"> {o.count === 1 ? "board" : "boards"}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {visible.length === 0 && (
                <li className="px-1 py-1 text-sm text-muted">No matching answers.</li>
              )}
            </ul>
          )}
          {field.hiddenValues > 0 && (
            <p className="text-xs text-muted">
              Showing the most common answers; {field.hiddenValues} less common{" "}
              {field.hiddenValues === 1 ? "answer is" : "answers are"} not listed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
