import { cn } from "@/components/ui";
import type { StudyStatus } from "@/lib/types";
import { STATUS_LABELS } from "./labels";

const TONES: Record<StudyStatus, string> = {
  draft: "border-line bg-canvas text-muted",
  live: "border-success/30 bg-success/10 text-success",
  closed: "border-ink/20 bg-ink/5 text-ink",
};

export function StatusBadge({ status, className }: { status: StudyStatus; className?: string }) {
  return (
    <span
      data-testid="status-badge"
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
