"use client";
// Small building blocks shared by the editor sections.
import { useCallback, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Notice } from "@/components/ui";
import type { StudyDetailDTO } from "@/lib/api-types";
import type { UpdateStudyInput } from "@/lib/schemas";
import { adminApi, errorDetailLines, errorMessage } from "./api";

export type ErrorState = { message: string; lines: string[] };

export function toErrorState(err: unknown): ErrorState {
  return { message: errorMessage(err), lines: errorDetailLines(err) };
}

export function ErrorNotice({
  error,
  className,
}: {
  error: ErrorState | null;
  className?: string;
}) {
  if (!error) return null;
  return (
    <Notice tone="error" title={error.message} className={className}>
      {error.lines.length > 0 && (
        <ul className="list-disc pl-5">
          {error.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

/** Busy + error state around async actions. `run` resolves to undefined on failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(toErrorState(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

/** Props every editor section receives. */
export type SectionProps = {
  study: StudyDetailDTO;
  /** True when the study isn't a draft: config is read-only (STU-03). */
  locked: boolean;
  onStudyChange: Dispatch<SetStateAction<StudyDetailDTO>>;
};

export function patchStudy(id: string, input: UpdateStudyInput): Promise<StudyDetailDTO> {
  return adminApi<StudyDetailDTO>(`/studies/${id}`, { method: "PATCH", body: input });
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function LockedHint() {
  return <p className="mb-4 text-sm text-muted">Locked while the study is not a draft.</p>;
}

/** Brief "Saved" confirmation shown next to save buttons. */
export function SavedHint({ show }: { show: boolean }) {
  return (
    <span role="status" className="text-sm text-success">
      {show ? "Saved" : ""}
    </span>
  );
}
