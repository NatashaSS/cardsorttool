// Display helpers for the admin results pages (RES-01/02). Client and server safe.
import {
  GENDER_SELF_DESCRIBE,
  GENDER_SELF_DESCRIBE_KEY,
  formatAnswer,
  resolveFields,
} from "@/lib/participant-fields";
import type { ParticipantFieldConfig } from "@/lib/schemas";
import type { BoardStatus, ParticipantAnswers } from "@/lib/types";

export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = {
  in_progress: "In progress",
  completed: "Completed",
};

export type ParticipantColumn = { key: string; label: string };

/** One column per enabled participant field, in the configured order (PFLD-03). */
export function participantColumns(fields: ParticipantFieldConfig[]): ParticipantColumn[] {
  return resolveFields(fields).map((f) => ({ key: f.key, label: f.label }));
}

/** Readable answer; "self-describe" shows the participant's own words. */
export function answerText(key: string, answers: ParticipantAnswers): string {
  const raw = answers[key];
  if (key === "gender" && raw === GENDER_SELF_DESCRIBE && answers[GENDER_SELF_DESCRIBE_KEY]) {
    return answers[GENDER_SELF_DESCRIBE_KEY];
  }
  return formatAnswer(key, raw);
}

const dateTimeFormat = () =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Local date and time, e.g. "18 Nov 2026, 14:05". */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFormat().format(d);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function formatShortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { timeStyle: "short" });
}

/** Table cells: date, then time on a second line. */
export const STACKED_DATE = { date: formatDate, time: formatShortTime };

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
