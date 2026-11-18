"use client";
// Header: participant sticky note + instructions (BRD-01), save status (SAVE-02).
import type { ParticipantAnswers } from "@/lib/types";
import type { ParticipantFieldConfig } from "@/lib/schemas";
import {
  GENDER_SELF_DESCRIBE,
  GENDER_SELF_DESCRIBE_KEY,
  formatAnswer,
  resolveFields,
} from "@/lib/participant-fields";
import { Button, Spinner } from "@/components/ui";
import type { SaveQueueSnapshot } from "./save-queue";

/** Enabled fields with an answer, as display lines (PFLD-03 order). */
export function participantLines(
  fields: ParticipantFieldConfig[],
  answers: ParticipantAnswers,
): { key: string; label: string; value: string }[] {
  return resolveFields(fields).flatMap((f) => {
    const raw = answers[f.key];
    if (!raw) return [];
    const value =
      f.key === "gender" && raw === GENDER_SELF_DESCRIBE && answers[GENDER_SELF_DESCRIBE_KEY]
        ? answers[GENDER_SELF_DESCRIBE_KEY]
        : formatAnswer(f.key, raw);
    return value ? [{ key: f.key, label: f.label, value }] : [];
  });
}

export function ParticipantNote({
  lines,
}: {
  lines: { key: string; label: string; value: string }[];
}) {
  if (lines.length === 0) return null;
  return (
    <dl
      aria-label="Your details"
      data-testid="participant-note"
      className="w-56 shrink-0 -rotate-1 rounded-sm bg-note px-4 py-3 text-sm shadow-note"
    >
      {lines.map((l, i) => (
        <div key={l.key} className="truncate" title={`${l.label}: ${l.value}`}>
          <dt className="sr-only">{l.label}</dt>
          <dd className={i === 0 ? "font-semibold" : "text-ink/80"}>{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SaveIndicator({ save, onRetry }: { save: SaveQueueSnapshot; onRetry: () => void }) {
  return (
    <div className="flex h-8 items-center justify-end gap-2 text-sm" data-testid="save-status">
      <span role="status" aria-live="polite" className="flex items-center gap-2">
        {save.status === "saving" && (
          <>
            <Spinner className="size-3 text-muted" label="Saving" />
            <span className="text-muted">Saving…</span>
          </>
        )}
        {save.status === "saved" && <span className="text-success">✓ All changes saved</span>}
        {save.status === "error" && (
          <span className="text-danger">Couldn&apos;t save — retrying</span>
        )}
      </span>
      {save.status === "error" && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
