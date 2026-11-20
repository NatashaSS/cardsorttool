"use client";
// RES-02 / PART-05: read-only board view for the admin, with participant details, dates and the
// RES-03 exclude toggle. Participant-created cards and groups are marked.
import Link from "next/link";
import { useState } from "react";
import { Board } from "@/components/board";
import { Button, Notice } from "@/components/ui";
import { adminApi, errorMessage } from "@/components/admin/study-editor/api";
import type { BoardStateDTO, BoardSummaryDTO } from "@/lib/api-types";
import { BoardStatusBadge, DateTime, ExcludedTag } from "./BoardStatusBadge";
import { SortedProgress } from "./BoardsList";
import { answerText, formatDateTime, participantColumns } from "./format";

export function AdminBoardView({
  studyId,
  studyTitle,
  summary,
  state,
}: {
  studyId: string;
  studyTitle: string;
  summary: BoardSummaryDTO;
  state: BoardStateDTO;
}) {
  const [excluded, setExcluded] = useState(summary.excluded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = participantColumns(state.study.participantFields);
  const ownGroups = state.groups.filter((g) => g.kind === "participant").length;
  const ownCards = state.cards.filter((c) => c.origin === "participant").length;

  async function toggleExcluded() {
    setBusy(true);
    setError(null);
    try {
      await adminApi(`/studies/${studyId}/boards/${summary.id}`, {
        method: "PATCH",
        body: { excluded: !excluded },
      });
      setExcluded(!excluded);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/admin" className="hover:text-ink">
              Studies
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={`/admin/studies/${studyId}`} className="hover:text-ink">
              {studyTitle}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={`/admin/studies/${studyId}/boards`} className="hover:text-ink">
              Boards
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-ink">
            {fields[0] ? answerText(fields[0].key, state.board.participant) || "Board" : "Board"}
          </li>
        </ol>
      </nav>

      <div className="grid gap-4 rounded-lg border border-line bg-surface p-5 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Board</h1>
            <BoardStatusBadge status={state.board.status} />
            {excluded && <ExcludedTag />}
            <span className="font-mono text-xs text-muted">{summary.id}</span>
          </div>
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-3 text-sm" data-testid="board-details">
            {fields.map((f) => (
              <div key={f.key}>
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd className="break-words">{answerText(f.key, state.board.participant) || "—"}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-muted">Started</dt>
              <dd>
                <DateTime iso={state.board.startedAt} format={formatDateTime} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Last activity</dt>
              <dd>
                <DateTime iso={state.board.lastActivityAt} format={formatDateTime} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Completed</dt>
              <dd>
                <DateTime iso={state.board.completedAt} format={formatDateTime} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Cards sorted</dt>
              <dd>
                <SortedProgress sorted={summary.sortedCount} total={summary.totalCount} />
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted" data-testid="participant-additions">
            {ownGroups === 0 && ownCards === 0
              ? "The participant didn't add any groups or cards."
              : `Added by the participant: ${ownGroups} group${ownGroups === 1 ? "" : "s"} (dashed outline) and ${ownCards} card${ownCards === 1 ? "" : "s"} (orange notes).`}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <Button variant="secondary" size="sm" onClick={toggleExcluded} disabled={busy}>
            {excluded ? "Include in analysis" : "Exclude from analysis"}
          </Button>
          <p className="max-w-56 text-xs text-muted lg:text-right">
            {excluded
              ? "This board is excluded from the analysis."
              : "Exclude test runs or unusable boards from the analysis."}
          </p>
        </div>
      </div>

      {error && <Notice tone="error" title={error} />}

      <Notice tone="info">
        Read-only view — this is the board as the participant {state.board.status === "completed" ? "submitted" : "currently has"} it.
      </Notice>

      <div
        data-testid="admin-board"
        className="-mx-6 rounded-lg border border-line bg-canvas"
      >
        <Board initialState={state} readOnly mode="admin" />
      </div>
    </div>
  );
}
