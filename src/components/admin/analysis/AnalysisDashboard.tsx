"use client";
// Analysis page shell (ANL-01..05, ANL-07, ANL-09): header, n + include-in-progress toggle,
// participant filters (kept in the page URL), tabs.
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { cn, Notice, Spinner } from "@/components/ui";
import { adminApi, errorMessage } from "@/components/admin/study-editor/api";
import { SORT_TYPE_LABELS } from "@/components/admin/study-editor/labels";
import { StatusBadge } from "@/components/admin/study-editor/StatusBadge";
import { DendrogramView } from "./DendrogramView";
import { analysisQueryString, isFilterActive, type AnalysisFilter } from "@/lib/analysis-filter";
import { FilterBar } from "./FilterBar";
import { DOWNLOAD_LINK_CLASS } from "./grid";
import { PlacementMatrix } from "./PlacementMatrix";
import { SimilarityMatrix } from "./SimilarityMatrix";
import { GroupNamesTable, ParticipantCardsTable } from "./Tables";
import type { AnalysisView } from "./types";

type TabId = "similarity" | "dendrogram" | "placement" | "groups" | "participantCards";
type Query = { includeInProgress: boolean; filter: AnalysisFilter };

/** Keep the page URL in step with the view (no navigation, no server round trip). */
function syncUrl(query: Query) {
  const url = `${window.location.pathname}${analysisQueryString(query)}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AnalysisDashboard({ initialView }: { initialView: AnalysisView }) {
  const [view, setView] = useState(initialView);
  const [loading, setLoading] = useState(false);
  /** Controls reflect the request immediately; the data follows when the refetch returns. */
  const [requested, setRequested] = useState<Query>({
    includeInProgress: initialView.includeInProgress,
    filter: initialView.filter,
  });
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("similarity");
  /** Only the latest request may update the view (filters can change quickly). */
  const seq = useRef(0);

  const { study, result, boardCounts, includeInProgress, filterOptions, unfilteredN } = view;
  const labels = useMemo(() => new Map(view.cards.map((c) => [c.id, c.label])), [view.cards]);
  const base = `/api/admin/studies/${study.id}/analysis`;
  const query = analysisQueryString({ includeInProgress, filter: view.filter });
  const filtered = isFilterActive(view.filter);

  async function load(next: Query) {
    const id = ++seq.current;
    setRequested(next);
    syncUrl(next);
    setLoading(true);
    setError(null);
    try {
      const fresh = await adminApi<AnalysisView>(
        `/studies/${study.id}/analysis${analysisQueryString(next)}`,
      );
      if (id !== seq.current) return;
      setView(fresh);
      const applied = { includeInProgress: fresh.includeInProgress, filter: fresh.filter };
      setRequested(applied);
      syncUrl(applied);
    } catch (err) {
      if (id !== seq.current) return;
      const previous = { includeInProgress: view.includeInProgress, filter: view.filter };
      setRequested(previous);
      syncUrl(previous);
      setError(errorMessage(err));
    } finally {
      if (id === seq.current) setLoading(false);
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

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="text-sm" aria-live="polite">
            Based on{" "}
            <strong className="text-base tabular-nums" data-testid="analysis-n">
              {result.n}
            </strong>{" "}
            {result.n === 1 ? "board" : "boards"}
            <span className="text-muted">
              {" "}
              ({boardCounts.completed} completed
              {includeInProgress && `, ${boardCounts.inProgress} in progress`}
              {filtered && (
                <>
                  {"; "}
                  <span data-testid="analysis-filtered-from">filtered from {unfilteredN}</span>
                </>
              )}
              )
            </span>
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={requested.includeInProgress}
              onChange={(e) => load({ ...requested, includeInProgress: e.target.checked })}
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
        {filterOptions.length > 0 && (
          <div className="border-t border-line pt-3">
            <FilterBar
              options={filterOptions}
              filter={requested.filter}
              onChange={(filter) => load({ ...requested, filter })}
            />
          </div>
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {result.n === 0 && filtered ? (
        <Notice tone="info" title="No boards match these filters">
          {unfilteredN === 0
            ? "There are no boards to analyse yet."
            : `None of the ${plural(unfilteredN, "analysed board")} match the participant filters. Remove a filter or `}
          {unfilteredN > 0 && (
            <button
              type="button"
              className="font-medium text-accent underline underline-offset-2"
              onClick={() => load({ ...requested, filter: {} })}
            >
              clear all filters
            </button>
          )}
          {unfilteredN > 0 && "."}
        </Notice>
      ) : result.n === 0 ? (
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
