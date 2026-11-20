import { cn } from "@/components/ui";
import type { BoardStatus } from "@/lib/types";
import { BOARD_STATUS_LABELS } from "./format";

const TONES: Record<BoardStatus, string> = {
  in_progress: "border-amber-400/50 bg-amber-50 text-amber-800",
  completed: "border-success/30 bg-success/10 text-success",
};

export function BoardStatusBadge({ status, className }: { status: BoardStatus; className?: string }) {
  return (
    <span
      data-testid="board-status"
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[status],
        className,
      )}
    >
      {BOARD_STATUS_LABELS[status]}
    </span>
  );
}

export function ExcludedTag({ className }: { className?: string }) {
  return (
    <span
      data-testid="excluded-tag"
      className={cn(
        "inline-flex items-center rounded-full border border-ink/20 bg-ink/5 px-2 py-0.5 text-xs font-medium text-muted",
        className,
      )}
    >
      Excluded
    </span>
  );
}

/** Local date-time; the server and browser may differ, so the text isn't hydration-checked. */
export function DateTime({
  iso,
  format,
  stacked,
}: {
  iso: string | null;
  format: (iso: string) => string;
  /** Date on one line, time below (compact table cells). */
  stacked?: { date: (iso: string) => string; time: (iso: string) => string };
}) {
  if (!iso) return <span className="text-muted">—</span>;
  if (stacked) {
    return (
      <time dateTime={iso} className="flex flex-col whitespace-nowrap">
        <span suppressHydrationWarning>{stacked.date(iso)}</span>
        <span suppressHydrationWarning className="text-xs text-muted">
          {stacked.time(iso)}
        </span>
      </time>
    );
  }
  return (
    <time dateTime={iso} title={iso} suppressHydrationWarning className="whitespace-nowrap">
      {format(iso)}
    </time>
  );
}
