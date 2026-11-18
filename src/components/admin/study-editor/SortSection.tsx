"use client";
// STU-04/05/06 sort type, group mode and limits; STU-09 predefined groups.
import { useState, type FormEvent } from "react";
import { Button, Input, cn } from "@/components/ui";
import type { AdminGroupDTO } from "@/lib/api-types";
import { LIMITS } from "@/lib/types";
import { adminApi } from "./api";
import { arrayMove } from "./fields-model";
import { SORT_TYPE_LABELS } from "./labels";
import { SortTypeFields, fixedCountError, type SortTypeValue } from "./SortTypeFields";
import { SortableList } from "./SortableList";
import {
  ErrorNotice,
  LockedHint,
  SavedHint,
  Section,
  patchStudy,
  useAction,
  type SectionProps,
} from "./shared";

function maxGroupsError(enabled: boolean, text: string): string | null {
  if (!enabled) return null;
  const n = Number(text);
  if (!text.trim() || !Number.isInteger(n) || n < 1 || n > LIMITS.maxParticipantGroupsCap) {
    return `Enter a whole number from 1 to ${LIMITS.maxParticipantGroupsCap}`;
  }
  return null;
}

export function SortSection(props: SectionProps) {
  const { study, locked, onStudyChange } = props;
  const initial = (): SortTypeValue => ({
    sortType: study.sortType,
    groupMode: study.groupMode,
    fixedGroupCount: study.fixedGroupCount?.toString() ?? "4",
  });
  const [sort, setSort] = useState<SortTypeValue>(initial);
  const [limitOn, setLimitOn] = useState(study.maxParticipantGroups !== null);
  const [limit, setLimit] = useState(study.maxParticipantGroups?.toString() ?? "10");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  const isOpenFixed = sort.sortType === "open" && sort.groupMode === "fixed";
  const limitApplies = !isOpenFixed && sort.sortType !== "closed";
  const input = {
    sortType: sort.sortType,
    groupMode: isOpenFixed ? ("fixed" as const) : ("unbounded" as const),
    fixedGroupCount: isOpenFixed ? Number(sort.fixedGroupCount) : null,
    maxParticipantGroups: limitApplies && limitOn ? Number(limit) : null,
  };
  const dirty =
    input.sortType !== study.sortType ||
    input.groupMode !== study.groupMode ||
    input.fixedGroupCount !== study.fixedGroupCount ||
    input.maxParticipantGroups !== study.maxParticipantGroups;
  const invalid = Boolean(
    fixedCountError(sort) || (limitApplies && maxGroupsError(limitOn, limit)),
  );

  const openBlocked =
    study.sortType !== "open" && study.groups.length > 0
      ? "Remove the predefined groups first."
      : undefined;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    const updated = await run(() => patchStudy(study.id, input));
    if (updated) {
      onStudyChange(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Sort type" description="How groups work for participants.">
        {locked && <LockedHint />}
        <form onSubmit={save} className="flex flex-col gap-5" noValidate>
          <ErrorNotice error={error} />
          <SortTypeFields
            value={sort}
            onChange={setSort}
            disabled={locked}
            disabledTypes={openBlocked ? { open: openBlocked } : {}}
          />
          {limitApplies && (
            <fieldset disabled={locked} className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Participant-created groups</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={limitOn}
                  onChange={(e) => setLimitOn(e.target.checked)}
                  className="accent-accent"
                />
                Limit how many groups each participant can add
              </label>
              {limitOn && (
                <div className="ml-6 flex flex-col gap-1">
                  <label htmlFor="maxParticipantGroups" className="text-sm font-medium">
                    Maximum groups per participant
                  </label>
                  <Input
                    id="maxParticipantGroups"
                    type="number"
                    min={1}
                    max={LIMITS.maxParticipantGroupsCap}
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    className="w-28"
                  />
                  {maxGroupsError(limitOn, limit) && (
                    <p className="text-xs text-danger">{maxGroupsError(limitOn, limit)}</p>
                  )}
                </div>
              )}
            </fieldset>
          )}
          {!locked && (
            <div className="flex items-center justify-end gap-3">
              <SavedHint show={saved && !dirty} />
              {dirty && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSort(initial());
                    setLimitOn(study.maxParticipantGroups !== null);
                    setLimit(study.maxParticipantGroups?.toString() ?? "10");
                  }}
                >
                  Reset
                </Button>
              )}
              <Button type="submit" disabled={busy || !dirty || invalid}>
                Save sort type
              </Button>
            </div>
          )}
        </form>
      </Section>

      {study.sortType !== "open" ? (
        <GroupsEditor {...props} />
      ) : (
        <p className="text-sm text-muted">
          Open sorts have no predefined groups — participants create their own.
        </p>
      )}
    </div>
  );
}

function GroupsEditor({ study, locked, onStudyChange }: SectionProps) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const { busy, error, setError, run } = useAction();
  const base = `/studies/${study.id}/groups`;
  const groups = study.groups;

  const setGroups = (next: AdminGroupDTO[]) => onStudyChange((prev) => ({ ...prev, groups: next }));

  async function add(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError({ message: "Enter a group name", lines: [] });
      return;
    }
    const group = await run(() =>
      adminApi<AdminGroupDTO>(base, { method: "POST", body: { name: trimmed } }),
    );
    if (group) {
      onStudyChange((prev) => ({ ...prev, groups: [...prev.groups, group] }));
      // Keep anything typed while the request was in flight.
      setName((current) => (current.trim() === trimmed ? "" : current));
    }
  }

  async function rename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) {
      setError({ message: "Enter a group name", lines: [] });
      return;
    }
    const group = await run(() =>
      adminApi<AdminGroupDTO>(`${base}/${id}`, { method: "PATCH", body: { name: trimmed } }),
    );
    if (group) {
      onStudyChange((prev) => ({
        ...prev,
        groups: prev.groups.map((g) => (g.id === id ? group : g)),
      }));
      setEditingId(null);
    }
  }

  async function remove(id: string) {
    const ok = await run(async () => {
      await adminApi(`${base}/${id}`, { method: "DELETE" });
      return true;
    });
    if (ok) onStudyChange((prev) => ({ ...prev, groups: prev.groups.filter((g) => g.id !== id) }));
  }

  async function move(from: number, to: number) {
    const previous = groups;
    const next = arrayMove(groups, from, to);
    setGroups(next);
    const result = await run(() =>
      adminApi<AdminGroupDTO[]>(`${base}/reorder`, {
        method: "POST",
        body: { ids: next.map((g) => g.id) },
      }),
    );
    setGroups(result ?? previous);
  }

  return (
    <Section
      title="Predefined groups"
      description={`The groups every participant sorts into (${SORT_TYPE_LABELS[study.sortType].toLowerCase()} sort). A ${study.sortType} study needs at least one group to go live.`}
      actions={
        <span className="text-sm text-muted tabular-nums">
          {groups.length} / {LIMITS.maxPredefinedGroups}
        </span>
      }
    >
      {locked && <LockedHint />}
      <ErrorNotice error={error} className="mb-4" />
      {groups.length === 0 ? (
        <p className="mb-4 rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          No groups yet.
        </p>
      ) : (
        <SortableList
          label="Groups"
          items={groups}
          itemName={(g) => g.name}
          onMove={move}
          disabled={locked || busy}
          className="mb-4"
          renderItem={(g) =>
            editingId === g.id ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(g.id);
                }}
              >
                <Input
                  aria-label={`Name for ${g.name}`}
                  value={editName}
                  maxLength={LIMITS.groupName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                  autoFocus
                  className="h-8"
                />
                <Button type="submit" size="sm" disabled={busy}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <span
                  className={cn("flex-1 py-1 text-sm", locked && "pl-1")}
                  data-testid="group-name"
                >
                  {g.name}
                </span>
                {!locked && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Rename ${g.name}`}
                      onClick={() => {
                        setEditingId(g.id);
                        setEditName(g.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      aria-label={`Delete ${g.name}`}
                      disabled={busy}
                      onClick={() => remove(g.id)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            )
          }
        />
      )}
      {!locked && (
        <form onSubmit={add} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="new-group" className="text-sm font-medium">
              New group
            </label>
            <Input
              id="new-group"
              value={name}
              maxLength={LIMITS.groupName}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Account settings"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={busy || groups.length >= LIMITS.maxPredefinedGroups}
          >
            Add group
          </Button>
        </form>
      )}
    </Section>
  );
}
