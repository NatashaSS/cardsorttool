"use client";
// STU-03 status transitions, STU-10 publish problems, STU-11 share link.
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/Dialog";
import type { StudyDetailDTO } from "@/lib/api-types";
import type { StudyStatus } from "@/lib/types";
import { adminApi } from "./api";
import { StatusBadge } from "./StatusBadge";
import { ErrorNotice, useAction, type SectionProps } from "./shared";

export function StatusBar({ study, onStudyChange }: Omit<SectionProps, "locked">) {
  const { busy, error, setError, run } = useAction();
  const [confirmClose, setConfirmClose] = useState(false);

  async function setStatus(status: StudyStatus) {
    const updated = await run(() =>
      adminApi<StudyDetailDTO>(`/studies/${study.id}/status`, { method: "POST", body: { status } }),
    );
    if (updated) onStudyChange(updated);
    setConfirmClose(false);
  }

  const boards = study.boardCounts.inProgress + study.boardCounts.completed;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <StatusBadge status={study.status} />
        <span className="text-sm text-muted">
          {study.boardCounts.inProgress} in progress · {study.boardCounts.completed} completed
        </span>
        <nav className="flex items-center gap-1 text-sm" aria-label="Results">
          <Link
            href={`/admin/studies/${study.id}/boards`}
            className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent/5"
          >
            Boards
          </Link>
          <Link
            href={`/admin/studies/${study.id}/analysis`}
            className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent/5"
          >
            Analysis
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {study.status === "draft" && (
            <Button onClick={() => setStatus("live")} disabled={busy}>
              Publish
            </Button>
          )}
          {study.status === "live" && (
            <Button variant="secondary" onClick={() => setConfirmClose(true)} disabled={busy}>
              Close study
            </Button>
          )}
          {study.status === "closed" && (
            <Button onClick={() => setStatus("live")} disabled={busy}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      {error && (
        <ErrorNotice
          error={
            error.lines.length > 0 && error.lines.join(" ") === error.message
              ? { message: "This study can't be published yet:", lines: error.lines }
              : error
          }
        />
      )}

      {study.status !== "draft" && <ShareLink url={study.shareUrl} status={study.status} />}

      {study.status !== "draft" && (
        <Notice tone="warning" title={`This study is ${study.status}.`}>
          Cards, groups, sort type, participant fields and permissions are locked so that every
          board shares the same setup. Title, description and instructions can still be edited.
        </Notice>
      )}

      <Dialog open={confirmClose} onOpenChange={(open) => !open && setConfirmClose(false)}>
        <DialogContent>
          <DialogTitle>Close this study?</DialogTitle>
          <DialogDescription>
            New participants won&apos;t be able to start, and boards in progress can no longer be
            changed{boards > 0 ? ` (${study.boardCounts.inProgress} in progress)` : ""}. You can
            reopen it later.
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStatus("closed");
              }}
            >
              Close study
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShareLink({ url, status }: { url: string; status: StudyStatus }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"yes" | "manual" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      inputRef.current?.select();
      setCopied("manual");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <label htmlFor="share-link" className="text-sm font-medium">
        Participant link
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id="share-link"
          ref={inputRef}
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="h-9 flex-1 rounded-md border border-line bg-canvas px-3 font-mono text-sm"
        />
        <Button variant="secondary" size="sm" onClick={copy}>
          Copy link
        </Button>
        <span role="status" className="w-32 text-sm text-success">
          {copied === "yes" ? "Copied" : copied === "manual" ? "Press Ctrl+C to copy" : ""}
        </span>
      </div>
      {status === "closed" && (
        <p className="mt-1 text-xs text-muted">
          The study is closed: this link shows a “closed” message.
        </p>
      )}
    </div>
  );
}
