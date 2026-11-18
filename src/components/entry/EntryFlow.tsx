"use client";
// Participant entry flow on /s/[slug] (PART-01/02/03, PFLD-05): resume prompt, "Start",
// details form, board creation and redirect to the board URL.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Notice, Spinner } from "@/components/ui";
import type { PublicStudyDTO } from "@/lib/api-types";
import { clearStoredToken, readStoredToken, storeToken } from "@/lib/storage-keys";
import type { ParticipantAnswers } from "@/lib/types";
import { DetailsForm } from "./DetailsForm";
import { boardPath, createBoardRequest, hasDetailsForm, type FieldErrors } from "./form-logic";

export type EntryFlowProps = {
  study: Pick<PublicStudyDTO, "slug" | "participantFields">;
};

type StoredBoard = { token: string; status: "unknown" | "in_progress" | "completed" | "missing" };

const noopSubscribe = () => () => {};

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function EntryFlow({ study }: EntryFlowProps) {
  const { slug, participantFields } = study;
  const router = useRouter();

  // Buttons stay disabled until hydration so early clicks are never swallowed.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  // PART-03: the token of this browser's most recent board for the study.
  const storedToken = useSyncExternalStore(
    subscribeStorage,
    () => readStoredToken(slug),
    () => null,
  );

  const [checked, setChecked] = useState<StoredBoard | null>(null);
  const [dismissedResume, setDismissedResume] = useState(false);
  const [phase, setPhase] = useState<"intro" | "form">("intro");
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  // Verify the stored token still points at a board; drop it if the board was deleted.
  useEffect(() => {
    if (!storedToken) return;
    let cancelled = false;
    fetch(`/api/boards/${encodeURIComponent(storedToken)}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          clearStoredToken(slug);
          setChecked({ token: storedToken, status: "missing" });
          return;
        }
        if (!res.ok) return; // keep offering resume on transient errors
        const body = (await res.json().catch(() => null)) as { board?: { status?: string } } | null;
        if (cancelled) return;
        setChecked({
          token: storedToken,
          status: body?.board?.status === "completed" ? "completed" : "in_progress",
        });
      })
      .catch(() => {
        // Network error: keep offering resume.
      });
    return () => {
      cancelled = true;
    };
  }, [storedToken, slug]);

  const stored: StoredBoard | null = storedToken
    ? checked?.token === storedToken
      ? checked
      : { token: storedToken, status: "unknown" }
    : null;
  const showResume = !dismissedResume && stored !== null && stored.status !== "missing";

  async function create(participant: ParticipantAnswers) {
    setSubmitting(true);
    setMessage(null);
    setServerErrors(undefined);
    const result = await createBoardRequest(slug, participant);
    if (result.ok) {
      storeToken(slug, result.token);
      router.push(boardPath(slug, result.token));
      return; // keep "submitting" until navigation replaces this page
    }
    setSubmitting(false);
    if (result.kind === "invalid") {
      setServerErrors(result.errors);
      setMessage(result.message ?? null);
      if (phase === "intro") setPhase("form");
    } else if (result.kind === "not_live" || result.kind === "not_found") {
      setClosed(true);
      setMessage(result.message);
    } else {
      setMessage(result.message);
    }
  }

  function start() {
    setDismissedResume(true);
    // PFLD-05: no enabled fields → straight to the board.
    if (hasDetailsForm(participantFields)) setPhase("form");
    else void create({});
  }

  if (closed) {
    return (
      <Notice tone="warning" title="This study is not currently accepting responses">
        {message ?? "Thank you for your interest."}
      </Notice>
    );
  }

  if (phase === "form") {
    return (
      <DetailsForm
        config={participantFields}
        serverErrors={serverErrors}
        formMessage={message}
        submitting={submitting}
        onSubmit={(answers) => void create(answers)}
        onBack={() => {
          setPhase("intro");
          setMessage(null);
          setServerErrors(undefined);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone="error">{message}</Notice>}
      {showResume ? (
        <div className="flex flex-col gap-4 rounded-md border border-line bg-canvas p-4">
          <p className="text-sm">
            {stored.status === "completed"
              ? "You have already completed this card sort in this browser."
              : "You have a card sort in progress in this browser."}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={boardPath(slug, stored.token)}
              className="inline-flex h-10 items-center justify-center rounded-md border border-transparent bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {stored.status === "completed" ? "View your completed sort" : "Continue where you left off"}
            </Link>
            <Button variant="secondary" onClick={start} disabled={!hydrated || submitting}>
              {submitting && <Spinner label="Starting" />}
              Start a new sort
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={start} disabled={!hydrated || submitting}>
            {submitting && <Spinner label="Starting" />}
            {submitting ? "Starting…" : "Start"}
          </Button>
        </div>
      )}
    </div>
  );
}
