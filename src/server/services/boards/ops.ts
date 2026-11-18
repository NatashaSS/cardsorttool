// Stream D — applying one BoardOp (SAVE-01/04, PERM-01..04, STU-06). Runs inside the
// transaction opened by applyBoardOp(); every check throws before anything is written.
import "server-only";
import { and, asc, count, eq, max } from "drizzle-orm";
import type { BoardOp } from "@/lib/schemas";
import {
  canDeleteCard,
  canDeleteGroup,
  canEditCard,
  canRenameGroup,
  getBoardCapabilities,
  type BoardContext,
} from "@/lib/permissions";
import { LIMITS } from "@/lib/types";
import { cards, groups, placements, type BoardRow, type CardRow, type GroupRow } from "../../db/schema";
import { ServiceError, notFound } from "../../errors";
import { nowIso } from "../../ids";
import type { Q } from "./state";

const forbidden = (message: string) => new ServiceError("forbidden", message);

/** A predefined card of the board's study, or a participant card of THIS board (SAVE-04). */
function ownedCard(q: Q, board: BoardRow, cardId: string): CardRow {
  const card = q.select().from(cards).where(eq(cards.id, cardId)).get();
  if (!card || card.studyId !== board.studyId || (card.boardId !== null && card.boardId !== board.id)) {
    throw notFound("Card not found on this board");
  }
  return card;
}

/** A predefined group of the board's study, or a group of THIS board (SAVE-04). */
function ownedGroup(q: Q, board: BoardRow, groupId: string): GroupRow {
  const group = q.select().from(groups).where(eq(groups.id, groupId)).get();
  const ok =
    group &&
    group.studyId === board.studyId &&
    (group.boardId === null ? group.kind === "predefined" : group.boardId === board.id);
  if (!ok) throw notFound("Group not found on this board");
  return group;
}

/** Ordered card ids currently placed in a group on this board. */
function groupCardIds(q: Q, boardId: string, groupId: string): string[] {
  return q
    .select({ cardId: placements.cardId })
    .from(placements)
    .where(and(eq(placements.boardId, boardId), eq(placements.groupId, groupId)))
    .orderBy(asc(placements.position), asc(placements.cardId))
    .all()
    .map((r) => r.cardId);
}

/** Rewrite the positions of a group's placements to 0..n-1 in the given order. */
function writeOrder(q: Q, boardId: string, groupId: string, cardIds: string[]): void {
  cardIds.forEach((cardId, position) => {
    q.update(placements)
      .set({ groupId, position })
      .where(and(eq(placements.boardId, boardId), eq(placements.cardId, cardId)))
      .run();
  });
}

/**
 * Move a card into a group at `toIndex` (index in the resulting list, clamped), or to the tray
 * (toGroupId null). The tray order is fixed by board.cardOrder, so toIndex is ignored there.
 * Both source and target groups are re-indexed contiguously.
 */
function moveCard(q: Q, boardId: string, cardId: string, toGroupId: string | null, toIndex: number) {
  const current = q
    .select()
    .from(placements)
    .where(and(eq(placements.boardId, boardId), eq(placements.cardId, cardId)))
    .get();

  if (toGroupId === null) {
    if (!current) return;
    q.delete(placements)
      .where(and(eq(placements.boardId, boardId), eq(placements.cardId, cardId)))
      .run();
    writeOrder(q, boardId, current.groupId, groupCardIds(q, boardId, current.groupId));
    return;
  }

  const target = groupCardIds(q, boardId, toGroupId).filter((id) => id !== cardId);
  const index = Math.max(0, Math.min(toIndex, target.length));
  target.splice(index, 0, cardId);

  if (!current) {
    q.insert(placements).values({ boardId, cardId, groupId: toGroupId, position: index }).run();
  }
  writeOrder(q, boardId, toGroupId, target);
  if (current && current.groupId !== toGroupId) {
    writeOrder(q, boardId, current.groupId, groupCardIds(q, boardId, current.groupId));
  }
}

function participantGroupCount(q: Q, boardId: string): number {
  const row = q
    .select({ n: count() })
    .from(groups)
    .where(and(eq(groups.boardId, boardId), eq(groups.kind, "participant")))
    .get();
  return row?.n ?? 0;
}

function nextBoardGroupPosition(q: Q, boardId: string): number {
  const row = q.select({ p: max(groups.position) }).from(groups).where(eq(groups.boardId, boardId)).get();
  return row?.p === null || row?.p === undefined ? 0 : row.p + 1;
}

function nextBoardCardPosition(q: Q, boardId: string): { next: number; total: number } {
  const row = q
    .select({ p: max(cards.position), n: count() })
    .from(cards)
    .where(eq(cards.boardId, boardId))
    .get();
  const p = row?.p;
  return { next: p === null || p === undefined ? 0 : p + 1, total: row?.n ?? 0 };
}

function assertNewGroupId(q: Q, groupId: string) {
  if (q.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).get()) {
    throw new ServiceError("conflict", "A group with this id already exists");
  }
}

function assertNewCardId(q: Q, cardId: string) {
  if (q.select({ id: cards.id }).from(cards).where(eq(cards.id, cardId)).get()) {
    throw new ServiceError("conflict", "A card with this id already exists");
  }
}

/** Validate and apply one op. The caller has already checked status and revision. */
export function applyOp(q: Q, board: BoardRow, ctxBase: Omit<BoardContext, "participantGroupCount">, op: BoardOp) {
  const ctx: BoardContext = { ...ctxBase, participantGroupCount: participantGroupCount(q, board.id) };
  const caps = getBoardCapabilities(ctx);

  switch (op.type) {
    case "moveCard": {
      if (!caps.canMoveCards) throw forbidden("Cards cannot be moved on this board");
      ownedCard(q, board, op.cardId);
      if (op.toGroupId !== null) ownedGroup(q, board, op.toGroupId);
      moveCard(q, board.id, op.cardId, op.toGroupId, op.toIndex);
      return;
    }

    case "addGroup": {
      if (!caps.canAddGroup) {
        throw forbidden(
          caps.groupLimitReached
            ? "The maximum number of groups has been reached"
            : "Groups cannot be added in this study",
        );
      }
      if (op.withCardId !== undefined) ownedCard(q, board, op.withCardId);
      assertNewGroupId(q, op.groupId);
      q.insert(groups)
        .values({
          id: op.groupId,
          studyId: board.studyId,
          boardId: board.id,
          kind: "participant",
          name: op.name,
          position: nextBoardGroupPosition(q, board.id),
        })
        .run();
      if (op.withCardId !== undefined) moveCard(q, board.id, op.withCardId, op.groupId, 0);
      return;
    }

    case "renameGroup": {
      const group = ownedGroup(q, board, op.groupId);
      if (!canRenameGroup(ctx, group.kind)) throw forbidden("This group cannot be renamed");
      q.update(groups).set({ name: op.name }).where(eq(groups.id, group.id)).run();
      return;
    }

    case "deleteGroup": {
      const group = ownedGroup(q, board, op.groupId);
      if (!canDeleteGroup(ctx, group.kind)) throw forbidden("This group cannot be deleted");
      // PERM-04: its cards go back to the tray.
      q.delete(placements)
        .where(and(eq(placements.boardId, board.id), eq(placements.groupId, group.id)))
        .run();
      q.delete(groups).where(eq(groups.id, group.id)).run();
      return;
    }

    case "addCard": {
      if (!caps.canAddCard) throw forbidden("Participants cannot add cards in this study");
      const { next, total } = nextBoardCardPosition(q, board.id);
      if (total >= LIMITS.maxParticipantCards) {
        throw forbidden(`You can add at most ${LIMITS.maxParticipantCards} cards`);
      }
      assertNewCardId(q, op.cardId);
      q.insert(cards)
        .values({
          id: op.cardId,
          studyId: board.studyId,
          boardId: board.id,
          label: op.label,
          description: op.description || null,
          position: next,
          createdAt: nowIso(),
        })
        .run();
      return;
    }

    case "editCard": {
      const card = ownedCard(q, board, op.cardId);
      if (!canEditCard(ctx, card.boardId === null ? "predefined" : "participant")) {
        throw forbidden("This card cannot be edited");
      }
      q.update(cards)
        .set({ label: op.label, description: op.description || null })
        .where(eq(cards.id, card.id))
        .run();
      return;
    }

    case "deleteCard": {
      const card = ownedCard(q, board, op.cardId);
      if (!canDeleteCard(ctx, card.boardId === null ? "predefined" : "participant")) {
        throw forbidden("This card cannot be deleted");
      }
      moveCard(q, board.id, card.id, null, 0); // removes the placement and re-indexes its group
      q.delete(cards).where(eq(cards.id, card.id)).run();
      return;
    }

    default: {
      const exhaustive: never = op;
      throw new ServiceError("bad_request", `Unknown op ${String((exhaustive as { type?: unknown }).type)}`);
    }
  }
}
