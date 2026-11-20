"use client";
// RES-01 boards table (participant columns, status filter, date sorting), RES-03 exclude/include,
// RES-04 delete with confirmation, RES-05 CSV export links, RES-06 auto-refresh (15 s polling).
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Notice, cn } from "@/components/ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/Dialog";
import { adminApi, errorMessage } from "@/components/admin/study-editor/api";
import { StatusBadge } from "@/components/admin/study-editor/StatusBadge";
import type { BoardSummaryDTO } from "@/lib/api-types";
import type { ParticipantFieldConfig } from "@/lib/schemas";
import type { StudyStatus } from "@/lib/types";
import { BoardStatusBadge, DateTime, ExcludedTag } from "./BoardStatusBadge";
import { STACKED_DATE, answerText, formatDateTime, formatTime, participantColumns } from "./format";

export const POLL_INTERVAL_MS = 15_000;

export type BoardsListStudy = {
  id: string;
  title: string;
  status: StudyStatus;
  shareUrl: string;
  participantFields: ParticipantFieldConfig[];
};

type Filter = "all" | "in_progress" | "completed";
type SortKey = "startedAt" | "lastActivityAt" | "completedAt";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
];

const DATE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "startedAt", label: "Started" },
  { key: "lastActivityAt", label: "Last activity" },
  { key: "completedAt", label: "Completed" },
];

function compareBoards(a: BoardSummaryDTO, b: BoardSummaryDTO, sort: Sort): number {
  const av = a[sort.key];
  const bv = b[sort.key];
  // Boards without the date (not completed yet) always go last.
  if (av === null && bv === null) return a.id.localeCompare(b.id);
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = av.localeCompare(bv);
  return (sort.dir === "asc" ? cmp : -cmp) || a.id.localeCompare(b.id);
}

export function BoardsList({
  study,
  initialBoards,
  loadedAt,
}: {
  study: BoardsListStudy;
  initialBoards: BoardSummaryDTO[];
  loadedAt: string;
}) {
  const [boards, setBoards] = useState(initialBoards);
  const [updatedAt, setUpdatedAt] = useState(loadedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>({ key: "lastActivityAt", dir: "desc" });
  const [toDelete, setToDelete] = useState<BoardSummaryDTO | null>(null);
  const columns = useMemo(() => participantColumns(study.participantFields), [study.participantFields]);

  // --- RES-06: polling ------------------------------------------------------
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const fresh = await adminApi<BoardSummaryDTO[]>(`/studies/${study.id}/boards`);
      setBoards(fresh);
      setUpdatedAt(new Date().toISOString());
      setRefreshError(null);
    } catch (err) {
      setRefreshError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [study.id]);

  useEffect(() => {
    let lastPoll = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      lastPoll = Date.now();
      void refresh();
    };
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    // Coming back to a tab that missed a poll refreshes straight away.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastPoll >= POLL_INTERVAL_MS) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // --- RES-03 / RES-04 -------------------------------------------------------
  async function setExcluded(board: BoardSummaryDTO, excluded: boolean) {
    setBusyId(board.id);
    setActionError(null);
    try {
      await adminApi(`/studies/${study.id}/boards/${board.id}`, {
        method: "PATCH",
        body: { excluded },
      });
      setBoards((list) => list.map((b) => (b.id === board.id ? { ...b, excluded } : b)));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const board = toDelete;
    setBusyId(board.id);
    setActionError(null);
    try {
      await adminApi(`/studies/${study.id}/boards/${board.id}`, { method: "DELETE" });
      setBoards((list) => list.filter((b) => b.id !== board.id));
      setToDelete(null);
    } catch (err) {
      setActionError(errorMessage(err));
      setToDelete(null);
    } finally {
      setBusyId(null);
    }
  }

  // --- RES-01: filter + sort --------------------------------------------------
  const visible = useMemo(
    () =>
      boards
        .filter((b) => filter === "all" || b.status === filter)
        .sort((a, b) => compareBoards(a, b, sort)),
    [boards, filter, sort],
  );
  const counts = useMemo(
    () => ({
      all: boards.length,
      in_progress: boards.filter((b) => b.status === "in_progress").length,
      completed: boards.filter((b) => b.status === "completed").length,
      excluded: boards.filter((b) => b.excluded).length,
    }),
    [boards],
  );

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  const participantLabel = (b: BoardSummaryDTO) => {
    const first = columns[0] ? answerText(columns[0].key, b.participant) : "";
    return first || `board ${b.id.slice(0, 8)}`;
  };

  const exportBase = `/api/admin/studies/${study.id}/export`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/studies/${study.id}`} className="text-sm text-muted hover:text-ink">
          ← Back to study editor
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="study-title">
            {study.title}
          </h1>
          <StatusBadge status={study.status} />
          <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Study">
            <Link
              href={`/admin/studies/${study.id}`}
              className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent/5"
            >
              Edit study
            </Link>
            <Link
              href={`/admin/studies/${study.id}/analysis`}
              className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent/5"
            >
              Analysis
            </Link>
          </nav>
        </div>
        <p className="mt-1 text-sm text-muted">
          Boards — every participant&apos;s card sort, in progress and completed.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line bg-surface px-4 py-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="board-counts">
          <Count label="Boards" value={counts.all} />
          <Count label="In progress" value={counts.in_progress} />
          <Count label="Completed" value={counts.completed} />
          <Count label="Excluded" value={counts.excluded} />
        </dl>
        <div className="ml-auto flex items-center gap-2">
          <ExportLink href={`${exportBase}/placements.csv`}>Export placements CSV</ExportLink>
          <ExportLink href={`${exportBase}/participants.csv`}>Export participants CSV</ExportLink>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by status" className="flex rounded-md border border-line bg-surface p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium",
                filter === f.id ? "bg-accent text-white" : "text-muted hover:text-ink",
              )}
            >
              {f.label} <span className={filter === f.id ? "text-white/80" : "text-muted"}>({counts[f.id]})</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted" data-testid="last-updated">
          <span role="status" aria-live="polite">
            {refreshError ? (
              <span className="text-danger">Couldn&apos;t refresh: {refreshError}</span>
            ) : (
              <>
                Last updated <time suppressHydrationWarning dateTime={updatedAt}>{formatTime(updatedAt)}</time>
                {" · refreshes every 15 s"}
              </>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {actionError && <Notice tone="error" title={actionError} />}

      {boards.length === 0 ? (
        <EmptyState study={study} />
      ) : (
        <div className="relative min-w-0 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm" data-testid="boards-table">
            <thead className="border-b border-line bg-canvas text-xs font-medium text-muted">
              <tr>
                {columns.length === 0 && <th className="px-2.5 py-2 font-medium">Board</th>}
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-2.5 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="px-2.5 py-2 font-medium">
                  Status
                </th>
                {DATE_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className="px-2.5 py-2 font-medium"
                    aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === c.key && "text-ink")}
                    >
                      {c.label}
                      <span aria-hidden className="w-3 text-[10px]">
                        {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-2.5 py-2 font-medium">
                  Cards sorted
                </th>
                <th scope="col" className="px-2.5 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => (
                <tr
                  key={b.id}
                  data-testid="board-row"
                  data-board-id={b.id}
                  data-excluded={b.excluded ? "true" : undefined}
                  className={cn("border-b border-line last:border-0", b.excluded ? "bg-canvas text-muted" : "hover:bg-canvas/60")}
                >
                  {columns.length === 0 && (
                    <td className="px-2.5 py-2 font-mono text-xs">{b.id.slice(0, 8)}</td>
                  )}
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn("max-w-44 px-3 py-2 break-words", i === 0 && !b.excluded && "font-medium")}>
                      {answerText(c.key, b.participant) || <span className="text-muted">—</span>}
                    </td>
                  ))}
                  <td className="px-2.5 py-2">
                    <span className="flex flex-col items-start gap-1">
                      <BoardStatusBadge status={b.status} className={b.excluded ? "opacity-60" : undefined} />
                      {b.excluded && <ExcludedTag />}
                    </span>
                  </td>
                  {DATE_COLUMNS.map((c) => (
                    <td key={c.key} className="px-2.5 py-2">
                      <DateTime iso={b[c.key]} format={formatDateTime} stacked={STACKED_DATE} />
                    </td>
                  ))}
                  <td className="px-2.5 py-2">
                    <SortedProgress sorted={b.sortedCount} total={b.totalCount} />
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex justify-end gap-0.5">
                      <Link
                        href={`/admin/studies/${study.id}/boards/${b.id}`}
                        className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-accent hover:bg-accent/5"
                        aria-label={`View board of ${participantLabel(b)}`}
                      >
                        View
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="px-2"
                        disabled={busyId === b.id}
                        onClick={() => setExcluded(b, !b.excluded)}
                        aria-label={`${b.excluded ? "Include" : "Exclude"} board of ${participantLabel(b)}`}
                      >
                        {b.excluded ? "Include" : "Exclude"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="px-2 text-danger hover:bg-danger/10"
                        disabled={busyId === b.id}
                        onClick={() => setToDelete(b)}
                        aria-label={`Delete board of ${participantLabel(b)}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 6 + (columns.length === 0 ? 1 : 0)} className="px-3 py-8 text-center text-muted">
                    No boards match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogTitle>Delete this board?</DialogTitle>
          <DialogDescription>
            The board of {toDelete ? participantLabel(toDelete) : ""} and all its placements,
            groups and cards will be permanently removed. This can&apos;t be undone. To keep the
            board but leave it out of the analysis, exclude it instead.
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="danger" disabled={busyId !== null} onClick={confirmDelete}>
              Delete board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ExportLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      download
      className="inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-canvas"
    >
      {children}
    </a>
  );
}

export function SortedProgress({ sorted, total }: { sorted: number; total: number }) {
  const pct = total > 0 ? Math.round((sorted / total) * 100) : 0;
  return (
    <div className="flex w-24 flex-col gap-1">
      <span className="text-xs whitespace-nowrap tabular-nums" data-testid="sorted-count">
        {sorted} / {total} sorted
      </span>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-line/60"
        role="progressbar"
        aria-label="Cards sorted"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={sorted}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EmptyState({ study }: { study: BoardsListStudy }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center" data-testid="boards-empty">
      <p className="font-medium">No boards yet</p>
      {study.status === "draft" ? (
        <p className="mt-1 text-sm text-muted">
          Publish the study in the{" "}
          <Link href={`/admin/studies/${study.id}`} className="text-accent hover:underline">
            editor
          </Link>{" "}
          to get a participant link. Boards appear here as soon as participants start.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            Share the participant link — boards appear here as soon as participants start.
          </p>
          <p className="mt-3 inline-block rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-sm select-all">
            {study.shareUrl}
          </p>
        </>
      )}
    </div>
  );
}
