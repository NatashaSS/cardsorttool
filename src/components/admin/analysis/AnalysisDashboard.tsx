"use client";
// Analysis page shell (ANL-01..05, ANL-07): header, n + include-in-progress toggle, tabs.
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn, Notice, Spinner } from "@/components/ui";
import { adminApi, errorMessage } from "@/components/admin/study-editor/api";
import { SORT_TYPE_LABELS } from "@/components/admin/study-editor/labels";
import { StatusBadge } from "@/components/admin/study-editor/StatusBadge";
import { DendrogramView } from "./DendrogramView";
import { DOWNLOAD_LINK_CLASS } from "./grid";
import { PlacementMatrix } from "./PlacementMatrix";
import { SimilarityMatrix } from "./SimilarityMatrix";
import { GroupNamesTable, ParticipantCardsTable } from "./Tables";
import type { AnalysisView } from "./types";

type TabId = "similarity" | "dendrogram" | "placement" | "groups" | "participantCards";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AnalysisDashboard({ initialView }: { initialView: AnalysisView }) {
  const [view, setView] = useState(initialView);
  const [loading, setLoading] = useState(false);
  /** The toggle reflects the request immediately; the data follows when the refetch returns. */
  const [requested, setRequested] = useState(initialView.includeInProgress);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("similarity");

  const { study, result, boardCounts, includeInProgress } = view;
  const labels = useMemo(() => new Map(view.cards.map((c) => [c.id, c.label])), [view.cards]);
  const base = `/api/admin/studies/${study.id}/analysis`;
  const query = includeInProgress ? "?includeInProgress=1" : "";

  async function toggle(next: boolean) {
    setRequested(next);
    setLoading(true);
    setError(null);
    try {
      setView(
        await adminApi<AnalysisView>(
          `/studies/${study.id}/analysis${next ? "?includeInProgress=1" : ""}`,
        ),
      );
    } catch (err) {
      setRequested(!next);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "similarity", label: "Similarity matrix" },
    { id: "dendrogram", label: "Dendrogram" },
  ];
  if (result.placement) tabs.push({ id: "placement", label: "Placement matrix" });
  if (study.sortType !== "closed") tabs.push({ id: "groups", label: "Group names" });
  if (result.participantCards.length > 0) {
    tabs.push({
      id: "participantCards",
      label: `Participant cards (${result.participantCards.length})`,
    });
  }
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "similarity";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/studies/${study.id}`} className="text-sm text-muted hover:text-ink">
          ← {study.title}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="analysis-title">
            Analysis: {study.title}
          </h1>
          <StatusBadge status={study.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted">
          <span>{SORT_TYPE_LABELS[study.sortType]} sort</span>
          <span aria-hidden>·</span>
          <nav aria-label="Study" className="flex items-center gap-1">
            <Link
              href={`/admin/studies/${study.id}`}
              className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-accent/5"
            >
              Edit study
            </Link>
            <Link
              href={`/admin/studies/${study.id}/boards`}
              className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-accent/5"
            >
              Boards
            </Link>
          </nav>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3">
        <p className="text-sm" aria-live="polite">
          Based on{" "}
          <strong className="text-base tabular-nums" data-testid="analysis-n">
            {result.n}
          </strong>{" "}
          {result.n === 1 ? "board" : "boards"}
          <span className="text-muted">
            {" "}
            ({boardCounts.completed} completed
            {includeInProgress && `, ${boardCounts.inProgress} in progress`})
          </span>
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={requested}
            disabled={loading}
            onChange={(e) => toggle(e.target.checked)}
          />
          Include in-progress boards
          <span className="text-muted">({boardCounts.inProgress})</span>
        </label>
        {loading && <Spinner label="Updating analysis" className="text-accent" />}
        {boardCounts.excluded > 0 && (
          <span className="text-sm text-muted">
            {plural(boardCounts.excluded, "excluded board")} not counted
          </span>
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {result.n === 0 ? (
        <Notice tone="info" title="No boards to analyse yet">
          {includeInProgress || boardCounts.inProgress === 0
            ? "Results appear here once participants have sorted cards."
            : `Analysis uses completed boards. ${plural(boardCounts.inProgress, "board is", "boards are")} still in progress — tick “Include in-progress boards” to include them.`}
        </Notice>
      ) : view.cards.length === 0 ? (
        <Notice tone="info" title="This study has no cards" />
      ) : (
        <div className={cn("flex flex-col gap-4", loading && "opacity-60")} aria-busy={loading}>
          <div
            role="tablist"
            aria-label="Analysis sections"
            className="flex gap-1 border-b border-line"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={activeTab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                  activeTab === t.id
                    ? "border-accent text-ink"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
            {activeTab === "similarity" && (
              <Section
                title="Similarity matrix"
                description="How often each pair of cards was placed in the same group."
                download={{ href: `${base}/similarity.csv${query}`, label: "Download CSV" }}
              >
                <SimilarityMatrix
                  similarity={result.similarity}
                  leafOrder={result.dendrogram.leafOrder}
                  labels={labels}
                />
              </Section>
            )}
            {activeTab === "dendrogram" && (
              <Section
                title="Dendrogram"
                description="Hierarchical clustering of the cards (average linkage on 1 − similarity)."
              >
                <DendrogramView dendrogram={result.dendrogram} labels={labels} />
              </Section>
            )}
            {activeTab === "placement" && result.placement && (
              <Section
                title="Placement matrix"
                description="How often each card was placed in each predefined group."
                download={{ href: `${base}/placement.csv${query}`, label: "Download CSV" }}
              >
                <PlacementMatrix placement={result.placement} labels={labels} />
              </Section>
            )}
            {activeTab === "groups" && (
              <Section
                title="Group names"
                description="Names participants gave their groups (case and spacing ignored)."
              >
                <GroupNamesTable stats={result.groupNames} n={result.n} labels={labels} />
              </Section>
            )}
            {activeTab === "participantCards" && (
              <Section
                title="Participant-created cards"
                description="Cards participants added themselves. They are not part of the matrices."
              >
                <ParticipantCardsTable studyId={study.id} rows={result.participantCards} />
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  download,
  children,
}: {
  title: string;
  description: string;
  download?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted">{description}</p>
        </div>
        {download && (
          <a href={download.href} download className={DOWNLOAD_LINK_CLASS}>
            {download.label}
          </a>
        )}
      </div>
      {children}
    </section>
  );
}
