"use client";
// Unsorted tray (BRD-01/02), progress (BRD-08), "+ Add card" (PERM-01); "+ New group" column
// with a drop zone that creates a group containing the dropped card (BRD-05/07).
import { useDroppable } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import type { CardDTO } from "@/lib/api-types";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui";
import { SortableCard, StaticCard, type CardControls } from "./Card";

export const TRAY_ID = "__tray__";
export const NEW_GROUP_ID = "__new_group__";

/** The tray order is fixed by the server, so cards don't shift while hovering it. */
const noShift = () => null;

export function Tray({
  cards,
  editable,
  showDescriptions,
  progress,
  canAddCard,
  onAddCard,
  cardControls,
}: {
  cards: CardDTO[];
  editable: boolean;
  showDescriptions: boolean;
  progress: { sorted: number; total: number };
  canAddCard: boolean;
  onAddCard: () => void;
  cardControls: (card: CardDTO) => CardControls;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: TRAY_ID,
    data: { type: "tray" },
    disabled: !editable,
  });
  return (
    <section aria-labelledby="tray-heading" className="mt-8">
      <div className="mb-2 flex items-center gap-4">
        <h2 id="tray-heading" className="text-base font-semibold">
          Unsorted cards
        </h2>
        <p className="text-sm text-muted" data-testid="progress" aria-live="polite">
          {progress.sorted} of {progress.total} cards sorted
        </p>
        {canAddCard && (
          <Button variant="secondary" size="sm" className="ml-auto" onClick={onAddCard}>
            + Add card
          </Button>
        )}
      </div>
      <div
        ref={setNodeRef}
        data-testid="tray"
        className={cn(
          "flex min-h-32 flex-wrap content-start gap-4 rounded-md border-2 p-4 transition-colors",
          isOver
            ? "border-accent bg-accent/5"
            : active
              ? "border-dashed border-accent/40"
              : "border-transparent",
        )}
      >
        {editable ? (
          <SortableContext id={TRAY_ID} items={cards.map((c) => c.id)} strategy={noShift}>
            {cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                containerId={TRAY_ID}
                variant="tray"
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
              variant="tray"
              showDescription={showDescriptions}
            />
          ))
        )}
        {cards.length === 0 && (
          <p className="m-auto text-sm text-muted">
            {progress.total === 0 ? "There are no cards on this board." : "All cards are sorted."}
          </p>
        )}
      </div>
    </section>
  );
}

export function NewGroupColumn({
  onAdd,
  limitReached,
  maxGroups,
  canAdd,
}: {
  onAdd: () => void;
  limitReached: boolean;
  maxGroups: number | null;
  canAdd: boolean;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: NEW_GROUP_ID,
    data: { type: "new-group" },
    disabled: !canAdd,
  });
  if (!canAdd) {
    return limitReached ? (
      <div className="flex w-60 shrink-0 flex-col">
        <div className="mb-1.5 min-h-9" />
        <p className="flex min-h-56 items-center justify-center rounded-md border-2 border-dashed border-line p-4 text-center text-sm text-muted">
          You&apos;ve reached the maximum of {maxGroups} group{maxGroups === 1 ? "" : "s"}.
        </p>
      </div>
    ) : null;
  }
  return (
    <div className="flex w-60 shrink-0 flex-col">
      <div className="mb-1.5 flex min-h-9 items-center">
        <Button variant="ghost" size="sm" onClick={onAdd} className="-ml-2 text-accent">
          + New group
        </Button>
      </div>
      <div
        ref={setNodeRef}
        data-testid="new-group-drop"
        className={cn(
          "flex min-h-56 items-center justify-center rounded-md border-2 border-dashed p-4 text-center text-sm transition-colors",
          isOver
            ? "border-accent bg-accent/5 text-accent"
            : active
              ? "border-accent/50 text-muted"
              : "border-line text-muted",
        )}
      >
        Drop a card here to create a new group
      </div>
    </div>
  );
}
