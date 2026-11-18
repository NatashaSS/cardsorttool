"use client";
// "Complete card sort" button (DONE-01) + confirmation modal whose content changes to the
// thank-you note in place (DONE-02/03). DESIGN §9.
import { useId, useState } from "react";
import type { CompletionBlocker } from "@/lib/completion";
import { Button, Spinner } from "@/components/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/Dialog";
import { BoardApiError } from "./api-client";
import type { BoardController } from "./use-board";

type Phase =
  | { kind: "confirm" }
  | { kind: "working" }
  | { kind: "blocked"; blockers: string[] }
  | { kind: "error"; message: string }
  | { kind: "done" };

export function CompletionControl({
  blockers,
  controller,
  hideButton,
}: {
  blockers: CompletionBlocker[];
  /** The board is read-only: no button, but keep the dialog mounted to show the thank-you. */
  hideButton: boolean;
  controller: Pick<BoardController, "api" | "flush" | "reload" | "markCompleted">;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  const explainId = useId();
  const disabled = blockers.length > 0;
  const explanation = blockers.map((b) => b.message).join(" ");

  const complete = async () => {
    setPhase({ kind: "working" });
    const allSaved = await controller.flush();
    if (!allSaved) {
      setPhase({
        kind: "error",
        message:
          "Your board was reloaded with the latest saved version. Please check it before completing.",
      });
      return;
    }
    try {
      if (!controller.api) throw new Error("No API in read-only mode");
      const res = await controller.api.complete();
      controller.markCompleted(res.completedAt);
      setPhase({ kind: "done" });
    } catch (e) {
      if (e instanceof BoardApiError && e.status === 422) {
        const list = Array.isArray(e.details)
          ? (e.details as CompletionBlocker[]).map((b) => b.message)
          : [e.message];
        setPhase({ kind: "blocked", blockers: list });
      } else if (
        e instanceof BoardApiError &&
        (e.code === "study_not_live" || e.code === "board_completed")
      ) {
        void controller.reload();
        setPhase({
          kind: "error",
          message: e.code === "study_not_live" ? "This study has been closed." : e.message,
        });
      } else {
        setPhase({
          kind: "error",
          message: "Couldn't complete your card sort. Check your connection and try again.",
        });
      }
    }
  };

  const onOpenChange = (next: boolean) => {
    if (phase.kind === "working") return; // don't close mid-request
    setOpen(next);
    if (!next && phase.kind !== "done") setPhase({ kind: "confirm" });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      {!hideButton && (
        <>
          <span title={disabled ? explanation : undefined}>
            <Button
              onClick={() => {
                setPhase({ kind: "confirm" });
                setOpen(true);
              }}
              disabled={disabled}
              aria-describedby={disabled ? explainId : undefined}
            >
              Complete card sort
            </Button>
          </span>
          {disabled && (
            <ul
              id={explainId}
              className="max-w-md text-right text-sm text-muted"
              data-testid="completion-blockers"
            >
              {blockers.map((b) => (
                <li key={b.code}>{b.message}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          onEscapeKeyDown={(e) => phase.kind === "working" && e.preventDefault()}
          onPointerDownOutside={(e) => phase.kind === "working" && e.preventDefault()}
        >
          {phase.kind === "done" ? (
            <div data-testid="completion-thanks">
              <DialogTitle>Thank you!</DialogTitle>
              <DialogDescription>
                Your card sort is complete and your responses have been saved. You can close this
                page now.
              </DialogDescription>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <DialogTitle>Complete your card sort?</DialogTitle>
              <DialogDescription>
                You won&apos;t be able to make changes afterwards.
              </DialogDescription>
              {phase.kind === "blocked" && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
                >
                  <p className="font-medium">Your card sort can&apos;t be completed yet:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {phase.blockers.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {phase.kind === "error" && (
                <p
                  role="alert"
                  className="mt-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
                >
                  {phase.message}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => onOpenChange(false)}
                  disabled={phase.kind === "working"}
                >
                  Cancel
                </Button>
                <Button
                  onClick={complete}
                  disabled={phase.kind === "working" || phase.kind === "blocked"}
                >
                  {phase.kind === "working" && <Spinner className="size-3" label="Completing" />}
                  {phase.kind === "error" ? "Try again" : "Yes, complete"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
