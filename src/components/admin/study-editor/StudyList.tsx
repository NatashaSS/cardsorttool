"use client";
// STU-01 study list with per-row open / duplicate (STU-12) / delete actions.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/Dialog";
import type { StudyDetailDTO, StudySummaryDTO } from "@/lib/api-types";
import { adminApi, errorMessage } from "./api";
import { SORT_TYPE_LABELS, formatDate } from "./labels";
import { StatusBadge } from "./StatusBadge";

export function StudyList({ studies }: { studies: StudySummaryDTO[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicated, setDuplicated] = useState<{ id: string; title: string } | null>(null);
  const [toDelete, setToDelete] = useState<StudySummaryDTO | null>(null);

  async function duplicate(study: StudySummaryDTO) {
    setBusyId(study.id);
    setError(null);
    try {
      const copy = await adminApi<StudyDetailDTO>(`/studies/${study.id}/duplicate`, {
        method: "POST",
      });
      setDuplicated({ id: copy.id, title: copy.title });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const study = toDelete;
    setBusyId(study.id);
    setError(null);
    try {
      await adminApi(`/studies/${study.id}`, { method: "DELETE" });
      setToDelete(null);
      if (duplicated?.id === study.id) setDuplicated(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="error">{error}</Notice>}
      {duplicated && (
        <Notice tone="success">
          Created a draft copy:{" "}
          <Link
            href={`/admin/studies/${duplicated.id}`}
            className="font-medium text-accent hover:underline"
          >
            {duplicated.title}
          </Link>
        </Notice>
      )}

      {studies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="font-medium">No studies yet</p>
          <p className="mt-1 text-sm text-muted">Create your first card sort to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">In progress</th>
                <th className="px-4 py-3 text-right font-medium">Completed</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {studies.map((s) => (
                <tr key={s.id} data-testid="study-row">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/studies/${s.id}`}
                      className="font-medium text-ink hover:text-accent hover:underline"
                    >
                      {s.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{SORT_TYPE_LABELS[s.sortType]}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.boardCounts.inProgress}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.boardCounts.completed}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">
                    {formatDate(s.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Link
                        href={`/admin/studies/${s.id}`}
                        className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium hover:bg-black/5"
                        aria-label={`Open ${s.title}`}
                      >
                        Open
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => duplicate(s)}
                        aria-label={`Duplicate ${s.title}`}
                      >
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        disabled={busyId === s.id}
                        onClick={() => setToDelete(s)}
                        aria-label={`Delete ${s.title}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        {toDelete && (
          <DialogContent>
            <DialogTitle>Delete “{toDelete.title}”?</DialogTitle>
            <DialogDescription>
              This permanently removes the study, its cards and groups, and all{" "}
              {toDelete.boardCounts.inProgress + toDelete.boardCounts.completed} participant boards.
              This cannot be undone.
            </DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <Button variant="danger" disabled={busyId === toDelete.id} onClick={confirmDelete}>
                Delete study
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
