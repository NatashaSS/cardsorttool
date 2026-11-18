// Display labels for study enums (admin UI).
import type { GroupMode, SortType, StudyStatus } from "@/lib/types";

export const SORT_TYPE_LABELS: Record<SortType, string> = {
  open: "Open",
  closed: "Closed",
  hybrid: "Hybrid",
};

export const SORT_TYPE_HINTS: Record<SortType, string> = {
  open: "Participants create and name their own groups.",
  closed: "Participants sort cards into groups you define.",
  hybrid: "You define groups; participants may add their own as well.",
};

export const GROUP_MODE_LABELS: Record<GroupMode, string> = {
  unbounded: "Participants add as many groups as they need",
  fixed: "A fixed number of groups",
};

export const STATUS_LABELS: Record<StudyStatus, string> = {
  draft: "Draft",
  live: "Live",
  closed: "Closed",
};

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
