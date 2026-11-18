"use client";
// The participant board (BRD-*, SAVE-02/03, DONE-01..03, PART-05/06, PERM-01..04/09).
// Also rendered read-only by the admin board view (stream H): <Board readOnly mode="admin" />.
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { BoardStateDTO, CardDTO, GroupDTO } from "@/lib/api-types";
import { getCompletionBlockers } from "@/lib/completion";
import {
  canDeleteGroup,
  canEditCard,
  canRenameGroup,
  getBoardCapabilities,
  type BoardContext,
} from "@/lib/permissions";
import { storeToken } from "@/lib/storage-keys";
import { LIMITS } from "@/lib/types";
import { Button, Notice } from "@/components/ui";
import { applyBoardOp, locateCard, sortProgress, type BoardModel } from "./board-reducer";
import { ParticipantNote, SaveIndicator, participantLines } from "./BoardHeader";
import { CardFace, type CardControls } from "./Card";
import { CompletionControl } from "./Completion";
import { CardFormDialog, ConfirmDialog, type CardFormValue, type ConfirmRequest } from "./dialogs";
import { GroupColumn } from "./GroupColumn";
import { NEW_GROUP_ID, NewGroupColumn, TRAY_ID, Tray } from "./Tray";
import { useBoard } from "./use-board";

export type BoardProps = {
  initialState: BoardStateDTO;
  /** Render without any controls or API calls (admin view, RES-02). */
  readOnly?: boolean;
  /** "admin" hides the completion button, participant banners and token storage. */
  mode?: "participant" | "admin";
};

/** Container of a droppable/sortable id: a group id, TRAY_ID, NEW_GROUP_ID or undefined. */
function containerOf(model: BoardModel, id: UniqueIdentifier): string | undefined {
  const key = String(id);
  if (key === TRAY_ID || key === NEW_GROUP_ID) return key;
  if (model.groups.some((g) => g.id === key)) return key;
  const loc = locateCard(model, key);
  return loc === undefined ? undefined : (loc ?? TRAY_ID);
}

function itemsOf(model: BoardModel, container: string): string[] {
  if (container === TRAY_ID) return model.unsortedCardIds;
  return model.groups.find((g) => g.id === container)?.cardIds ?? [];
}

export function Board({ initialState, readOnly = false, mode = "participant" }: BoardProps) {
  const controller = useBoard(initialState, { readOnly });
  const { meta, model, save, notice, dispatch } = controller;
  const { study, board } = meta;

  useEffect(() => {
    if (mode === "participant" && !readOnly) storeToken(study.slug, board.token); // PART-03
  }, [mode, readOnly, study.slug, board.token]);

  // Marks the board as interactive (used by e2e tests before keyboard interaction).
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  // ---- permissions (PERM-01..04) ----------------------------------------------
  const ctx: BoardContext = {
    study,
    boardStatus: board.status,
    participantGroupCount: model.groups.filter((g) => g.kind === "participant").length,
  };
  const caps = getBoardCapabilities(ctx);
  const editable = !readOnly && caps.canEdit;
  const ownCardCount = model.cards.filter((c) => c.origin === "participant").length;
  const canAddCard = editable && caps.canAddCard && ownCardCount < LIMITS.maxParticipantCards;
  const canAddGroup = editable && caps.canAddGroup;
  const showDescriptions = study.settings.showCardDescriptions; // PERM-09

  // ---- drag state ---------------------------------------------------------------
  const [preview, setPreviewState] = useState<BoardModel | null>(null);
  const previewRef = useRef<BoardModel | null>(null);
  /** Last drag preview, kept after the drop so the drop announcement can describe it. */
  const lastPreviewRef = useRef<BoardModel | null>(null);
  const setPreview = (next: BoardModel | null) => {
    previewRef.current = next;
    if (next) lastPreviewRef.current = next;
    setPreviewState(next);
  };
  const [activeId, setActiveId] = useState<string | null>(null);
  const view = preview ?? model;

  const cardsById = useMemo(() => new Map(view.cards.map((c) => [c.id, c])), [view.cards]);
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  const clearFocusGroup = useCallback(() => setFocusGroupId(null), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Pointer first, then rectangle overlap; inside a non-empty container pick the closest card. */
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const current = previewRef.current;
    const pointer = pointerWithin(args);
    const hits = pointer.length > 0 ? pointer : rectIntersection(args);
    let overId = getFirstCollision(hits, "id");
    if (overId == null) return [];
    if (current) {
      const key = String(overId);
      const isContainer = key === TRAY_ID || current.groups.some((g) => g.id === key);
      if (isContainer) {
        const items = itemsOf(current, key);
        if (items.length > 0) {
          const closest = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((c) =>
              items.includes(String(c.id)),
            ),
          });
          overId = closest[0]?.id ?? overId;
        }
      }
    }
    return [{ id: overId }];
  }, []);

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setPreview(model);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const current = previewRef.current;
    if (!current || !over) return;
    const cardId = String(active.id);
    const from = containerOf(current, cardId);
    const to = containerOf(current, over.id);
    if (!from || !to || from === to || to === NEW_GROUP_ID) return;
    if (to === TRAY_ID) {
      setPreview(applyBoardOp(current, { type: "moveCard", cardId, toGroupId: null, toIndex: 0 }));
      return;
    }
    const items = itemsOf(current, to);
    const overIndex = items.indexOf(String(over.id));
    let toIndex = items.length;
    if (overIndex >= 0) {
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      toIndex = overIndex + (below ? 1 : 0);
    }
    setPreview(applyBoardOp(current, { type: "moveCard", cardId, toGroupId: to, toIndex }));
  };

  const endDrag = () => {
    setActiveId(null);
    setPreview(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const current = previewRef.current;
    endDrag();
    if (!current || !over) return;
    const cardId = String(active.id);

    if (over.id === NEW_GROUP_ID) {
      if (canAddGroup) addGroup(cardId); // BRD-07
      return;
    }
    const to = containerOf(current, over.id);
    if (!to) return;
    const original = containerOf(model, cardId);

    if (to === TRAY_ID) {
      if (original !== TRAY_ID) dispatch({ type: "moveCard", cardId, toGroupId: null, toIndex: 0 });
      return;
    }
    const items = itemsOf(current, to);
    const activeIndex = items.indexOf(cardId);
    const overIndex = items.indexOf(String(over.id));
    const toIndex = overIndex >= 0 ? overIndex : activeIndex >= 0 ? activeIndex : items.length;
    if (original === to && itemsOf(model, to).indexOf(cardId) === toIndex) return;
    dispatch({ type: "moveCard", cardId, toGroupId: to, toIndex });
  };

  // ---- group & card actions (BRD-05/06/07, PERM-01..04) -------------------------
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [cardForm, setCardForm] = useState<
    { mode: "add" } | { mode: "edit"; card: CardDTO } | null
  >(null);

  function addGroup(withCardId?: string) {
    const groupId = nanoid();
    const renamable = canRenameGroup(ctx, "participant");
    // Without rename permission the participant can't name it, so give it a numbered name.
    const name = renamable ? "" : `Group ${ctx.participantGroupCount + 1}`;
    dispatch({ type: "addGroup", groupId, name, ...(withCardId ? { withCardId } : {}) });
    if (renamable) setFocusGroupId(groupId);
  }

  const renameGroup = (group: GroupDTO, name: string) =>
    dispatch({ type: "renameGroup", groupId: group.id, name });

  const deleteGroup = (group: GroupDTO) => {
    const run = () => dispatch({ type: "deleteGroup", groupId: group.id });
    const n = group.cardIds.length;
    if (n === 0) return run();
    setConfirm({
      title: `Delete group${group.name ? ` “${group.name}”` : ""}?`,
      description: `Its ${n} card${n === 1 ? "" : "s"} will go back to the unsorted cards.`,
      confirmLabel: "Delete group",
      onConfirm: run,
    });
  };

  const submitCard = (value: CardFormValue) => {
    if (!cardForm) return;
    if (cardForm.mode === "add") dispatch({ type: "addCard", cardId: nanoid(), ...value });
    else dispatch({ type: "editCard", cardId: cardForm.card.id, ...value });
    setCardForm(null);
  };

  const cardControls = (card: CardDTO): CardControls =>
    editable && canEditCard(ctx, card.origin)
      ? {
          onEdit: (c) => setCardForm({ mode: "edit", card: c }),
          onDelete: (c) =>
            setConfirm({
              title: `Delete card “${c.label}”?`,
              description: "The card will be removed from your board.",
              confirmLabel: "Delete card",
              onConfirm: () => dispatch({ type: "deleteCard", cardId: c.id }),
            }),
        }
      : {};

  // ---- derived display ------------------------------------------------------------
  const progress = sortProgress(model);
  const blockers = getCompletionBlockers({
    study,
    boardStatus: board.status,
    groups: model.groups,
    unsortedCardIds: model.unsortedCardIds,
  });
  const trayCards = view.unsortedCardIds
    .map((id) => cardsById.get(id))
    .filter((c): c is CardDTO => !!c);
  const activeCard = activeId ? cardsById.get(activeId) : undefined;
  const lines = participantLines(study.participantFields, board.participant);
  const dndId = useId();

  const announcements = useMemo<Announcements>(() => {
    const label = (id: UniqueIdentifier) => cardsById.get(String(id))?.label ?? "card";
    const where = (id: UniqueIdentifier | undefined) => {
      const current = previewRef.current ?? lastPreviewRef.current ?? model;
      if (id === undefined) return "nowhere";
      const key = String(id);
      if (key === NEW_GROUP_ID) return "the new group area";
      const container = containerOf(current, key);
      const name =
        container === TRAY_ID
          ? "the unsorted cards"
          : `group ${current.groups.find((g) => g.id === container)?.name || "(unnamed)"}`;
      if (key === container) return name;
      const items = container ? itemsOf(current, container) : [];
      return `${name}, position ${items.indexOf(key) + 1} of ${items.length}`;
    };
    return {
      onDragStart: ({ active }) => `Picked up card ${label(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over
          ? `Card ${label(active.id)} is over ${where(over.id)}.`
          : `Card ${label(active.id)} is not over a group.`,
      onDragEnd: ({ active, over }) =>
        over
          ? `Card ${label(active.id)} was dropped in ${where(over.id)}.`
          : `Card ${label(active.id)} was dropped.`,
      onDragCancel: ({ active }) => `Moving was cancelled. Card ${label(active.id)} was returned.`,
    };
  }, [cardsById, model]);

  const readOnlyBanner =
    mode !== "participant"
      ? null
      : board.status === "completed"
        ? { tone: "success" as const, text: "You have completed this card sort — thank you." }
        : study.status === "closed"
          ? {
              tone: "warning" as const,
              text: "This study has been closed. Your board can no longer be changed.",
            }
          : study.status !== "live"
            ? { tone: "warning" as const, text: "This study is not currently accepting responses." }
            : null;

  return (
    <>
      <div
        className="flex flex-1 items-center justify-center p-8 lg:hidden"
        data-testid="small-screen-notice"
      >
        <Notice title="Please use a larger screen" className="max-w-sm">
          The card sort needs a screen at least 1024 pixels wide. Please open this link on a laptop
          or desktop computer.
        </Notice>
      </div>

      <main
        ref={mainRef}
        className="mx-auto hidden w-full max-w-[1680px] px-8 py-6 lg:block"
        data-testid="board"
      >
        <header className="grid grid-cols-[15rem_1fr_15rem] items-start gap-6">
          <div>
            <ParticipantNote lines={lines} />
          </div>
          <div className="pt-2 text-center">
            <h1 className="sr-only">{study.title}</h1>
            <p
              className="mx-auto max-w-2xl text-base whitespace-pre-line text-ink"
              data-testid="instructions"
            >
              {study.instructions.trim() || "Sort the cards into groups that make sense to you."}
            </p>
          </div>
          <div>{editable && <SaveIndicator save={save} onRetry={controller.retry} />}</div>
        </header>

        {readOnlyBanner && (
          <Notice tone={readOnlyBanner.tone} className="mx-auto mt-6 max-w-2xl text-center">
            <span data-testid="readonly-banner">{readOnlyBanner.text}</span>
          </Notice>
        )}
        {notice && !readOnlyBanner && (
          <div
            className="mx-auto mt-6 flex max-w-2xl items-center gap-3 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-3 text-sm"
            role="status"
            data-testid="board-notice"
          >
            <span className="flex-1">{notice.message}</span>
            <Button size="sm" variant="ghost" onClick={controller.dismissNotice}>
              Dismiss
            </Button>
          </div>
        )}

        <DndContext
          id={dndId}
          sensors={editable ? sensors : undefined}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={endDrag}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "To pick up a card, press Space or Enter. Use the arrow keys to move it between groups and the unsorted cards. Press Space or Enter again to drop it, or Escape to cancel.",
            },
          }}
        >
          <div className="mt-8 flex flex-wrap items-start gap-6" data-testid="groups">
            {view.groups.map((group) => (
              <GroupColumn
                key={group.id}
                group={group}
                cardsById={cardsById}
                editable={editable}
                canRename={editable && canRenameGroup(ctx, group.kind)}
                canDelete={editable && canDeleteGroup(ctx, group.kind)}
                showDescriptions={showDescriptions}
                autoFocusName={focusGroupId === group.id}
                onAutoFocused={clearFocusGroup}
                onRename={renameGroup}
                onDelete={deleteGroup}
                cardControls={cardControls}
              />
            ))}
            {editable && (
              <NewGroupColumn
                canAdd={canAddGroup}
                limitReached={caps.groupLimitReached}
                maxGroups={study.maxParticipantGroups}
                onAdd={() => addGroup()}
              />
            )}
            {view.groups.length === 0 && !editable && (
              <p className="text-sm text-muted">No groups.</p>
            )}
          </div>

          <Tray
            cards={trayCards}
            editable={editable}
            showDescriptions={showDescriptions}
            progress={progress}
            canAddCard={canAddCard}
            onAddCard={() => setCardForm({ mode: "add" })}
            cardControls={cardControls}
          />

          <DragOverlay>
            {activeCard ? <CardFace card={activeCard} variant="tray" lifted /> : null}
          </DragOverlay>
        </DndContext>

        {mode === "participant" && !readOnly && (
          <footer className="mt-8 flex justify-end border-t border-line pt-6">
            <CompletionControl blockers={blockers} controller={controller} hideButton={!editable} />
          </footer>
        )}
      </main>

      <CardFormDialog
        open={cardForm !== null}
        mode={cardForm?.mode ?? "add"}
        initial={
          cardForm?.mode === "edit"
            ? { label: cardForm.card.label, description: cardForm.card.description }
            : undefined
        }
        onOpenChange={(o) => !o && setCardForm(null)}
        onSubmit={submitCard}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
