"use client";
// Study editor shell: header, status bar and tabbed sections. Holds the study in local
// state; sections update it from API responses (no full page reload needed).
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/components/ui";
import type { StudyDetailDTO } from "@/lib/api-types";
import { CardsSection } from "./CardsSection";
import { DetailsSection } from "./DetailsSection";
import { FieldsSection } from "./FieldsSection";
import { SORT_TYPE_LABELS } from "./labels";
import { SettingsSection } from "./SettingsSection";
import { SortSection } from "./SortSection";
import { StatusBar } from "./StatusBar";

const TABS = [
  { id: "details", label: "Details" },
  { id: "sort", label: "Sort type & groups" },
  { id: "cards", label: "Cards" },
  { id: "fields", label: "Participant fields" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function StudyEditor({ initialStudy }: { initialStudy: StudyDetailDTO }) {
  const [study, setStudy] = useState(initialStudy);
  const [tab, setTab] = useState<TabId>("details");
  const locked = study.status !== "draft";
  const props = { study, locked, onStudyChange: setStudy };

  const tabCount = (id: TabId): string => {
    if (id === "cards") return ` (${study.cards.length})`;
    if (id === "sort" && study.sortType !== "open") return ` (${study.groups.length})`;
    return "";
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-muted hover:text-ink">
          ← Studies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold" data-testid="study-title">
          {study.title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {SORT_TYPE_LABELS[study.sortType]} sort
          {study.sortType === "open" &&
            (study.groupMode === "fixed"
              ? ` · ${study.fixedGroupCount} fixed groups`
              : " · participants add groups")}
        </p>
      </div>

      <StatusBar study={study} onStudyChange={setStudy} />

      <div role="tablist" aria-label="Study settings" className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.id
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            <span className="font-normal text-muted">{tabCount(t.id)}</span>
          </button>
        ))}
      </div>

      {/* Panels stay mounted so unsaved input survives switching tabs. */}
      <Panel id="details" active={tab}>
        <DetailsSection {...props} />
      </Panel>
      <Panel id="sort" active={tab}>
        <SortSection {...props} />
      </Panel>
      <Panel id="cards" active={tab}>
        <CardsSection {...props} />
      </Panel>
      <Panel id="fields" active={tab}>
        <FieldsSection {...props} />
      </Panel>
      <Panel id="settings" active={tab}>
        <SettingsSection {...props} />
      </Panel>
    </div>
  );
}

function Panel({ id, active, children }: { id: TabId; active: TabId; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={active !== id}>
      {children}
    </div>
  );
}
