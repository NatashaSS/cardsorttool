"use client";
// One group column: name (+ inline rename, PERM-03), card count (BRD-04), delete (PERM-04),
// droppable sortable list (BRD-02).
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useRef, useState } from "react";
import type { CardDTO, GroupDTO } from "@/lib/api-types";
import { LIMITS } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { SortableCard, StaticCard, type CardControls } from "./Card";

export type GroupColumnProps = {
  group: GroupDTO;
  cardsById: Map<string, CardDTO>;
  editable: boolean;
  canRename: boolean;
  canDelete: boolean;
  showDescriptions: boolean;
  /** Focus the name input once (BRD-05: new groups get focus on their name). */
  autoFocusName: boolean;
  onAutoFocused: () => void;
  onRename: (group: GroupDTO, name: string) => void;
  onDelete: (group: GroupDTO) => void;
  cardControls: (card: CardDTO) => CardControls;
};

export function GroupColumn(props: GroupColumnProps) {
  const { group, cardsById, editable, showDescriptions, cardControls } = props;
  const { setNodeRef, isOver, active } = useDroppable({
    id: group.id,
    data: { type: "group" },
    disabled: !editable,
  });
  const count = group.cardIds.length;
  const cards = group.cardIds.map((id) => cardsById.get(id)).filter((c): c is CardDTO => !!c);

  return (
    <section
      aria-label={`Group ${group.name || "(unnamed)"}`}
      data-group-id={group.id}
      className="flex w-60 shrink-0 flex-col"
    >
      <div className="mb-1.5 flex min-h-9 items-center gap-1.5">
        <GroupName {...props} />
        <span
          className="ml-auto shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-muted tabular-nums"
          aria-label={`${count} card${count === 1 ? "" : "s"}`}
        >
          {count}
        </span>
        {props.canDelete && (
          <button
            type="button"
            onClick={() => props.onDelete(group)}
            aria-label={`Delete group ${group.name || "(unnamed)"}`}
            title="Delete group"
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex max-h-[28rem] min-h-56 flex-col gap-2 overflow-y-auto rounded-md border-2 bg-surface p-2 transition-colors",
          isOver
            ? "border-accent bg-accent/5"
            : active
              ? "border-dashed border-accent/40"
              : "border-line",
        )}
      >
        {editable ? (
          <SortableContext
            id={group.id}
            items={group.cardIds}
            strategy={verticalListSortingStrategy}
          >
            {cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                containerId={group.id}
                variant="group"
                showDescription={showDescriptions}
                {...cardControls(card)}
              />
            ))}
          </SortableContext>
        ) : (
          cards.map((card) => (
            <StaticCard
              key={card.id}
              card={card}
              variant="group"
              showDescription={showDescriptions}
            />
          ))
        )}
        {count === 0 && (
          <p className="m-auto px-2 text-center text-xs text-muted">
            {editable ? "Drag cards here" : "No cards"}
          </p>
        )}
      </div>
    </section>
  );
}

function GroupName({ group, canRename, autoFocusName, onAutoFocused, onRename }: GroupColumnProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocusName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      onAutoFocused();
    }
  }, [autoFocusName, onAutoFocused]);

  if (!canRename) {
    return (
      <h3 className="min-w-0 truncate text-sm font-semibold text-ink" title={group.name}>
        {group.name || <span className="text-muted italic">Unnamed group</span>}
      </h3>
    );
  }

  const commit = () => {
    if (draft !== null && draft.trim() !== group.name) onRename(group, draft);
    setDraft(null);
  };

  return (
    <input
      ref={inputRef}
      value={draft ?? group.name}
      maxLength={LIMITS.groupName}
      placeholder="Name this group"
      aria-label="Group name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          // Blur after the reset so commit() sees no draft.
          requestAnimationFrame(() => inputRef.current?.blur());
        }
      }}
      className={cn(
        "h-8 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-sm font-semibold text-ink",
        "hover:border-line focus:border-accent focus:bg-surface focus:outline-none placeholder:font-normal placeholder:text-muted",
      )}
    />
  );
}
