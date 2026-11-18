"use client";
// Create a study (STU-01/02/04/05), then open the editor.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import type { StudyDetailDTO } from "@/lib/api-types";
import { LIMITS } from "@/lib/types";
import { adminApi, errorDetailLines, errorMessage } from "./api";
import { SortTypeFields, fixedCountError, type SortTypeValue } from "./SortTypeFields";

export function CreateStudyForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [sort, setSort] = useState<SortTypeValue>({
    sortType: "closed",
    groupMode: "unbounded",
    fixedGroupCount: "4",
  });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; lines: string[] } | null>(null);

  const titleError = submitted && !title.trim() ? "Title is required" : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!title.trim() || fixedCountError(sort)) return;
    setBusy(true);
    setError(null);
    try {
      const fixed = sort.sortType === "open" && sort.groupMode === "fixed";
      const study = await adminApi<StudyDetailDTO>("/studies", {
        method: "POST",
        body: {
          title: title.trim(),
          sortType: sort.sortType,
          groupMode: fixed ? "fixed" : "unbounded",
          fixedGroupCount: fixed ? Number(sort.fixedGroupCount) : null,
        },
      });
      router.push(`/admin/studies/${study.id}`);
    } catch (err) {
      setError({ message: errorMessage(err), lines: errorDetailLines(err) });
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-6"
      noValidate
    >
      {error && (
        <Notice tone="error" title={error.message}>
          {error.lines.length > 0 && (
            <ul className="list-disc pl-5">
              {error.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      <Field label="Title" required error={titleError} hint="Shown to participants.">
        {(p) => (
          <Input
            {...p}
            value={title}
            maxLength={LIMITS.studyTitle}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        )}
      </Field>
      <SortTypeFields value={sort} onChange={setSort} />
      <div className="flex justify-end gap-2">
        <Link
          href="/admin"
          className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-canvas"
        >
          Cancel
        </Link>
        <Button type="submit" disabled={busy}>
          Create study
        </Button>
      </div>
    </form>
  );
}
