// Pure client-side board model + reducer (SAVE-02 optimistic updates). Applies a BoardOp
// exactly like the server does (src/server/services/boards/ops.ts, DESIGN §8 "Board service
// details"), so the optimistic state matches what a reload would show.
import type { BoardStateDTO, CardDTO, GroupDTO } from "@/lib/api-types";
import type { BoardOpInput } from "@/lib/schemas";

export type BoardModel = {
  /** Predefined cards (admin order), then participant cards by creation. */
  cards: CardDTO[];
  /** Predefined/placeholder groups, then participant groups (appended). */
  groups: GroupDTO[];
  /** Cards in the unsorted tray, in tray order. */
  unsortedCardIds: string[];
  /**
   * Canonical tray ranking of every card on the board. A card returning to the tray is put at
   * its rank (the server ignores `toIndex` for the tray): board.cardOrder, then predefined cards
   * missing from it, then participant cards by creation.
   */
  trayOrder: string[];
};

/** Build the client model from the server state (trayOrder is the server's fixed tray ranking). */
export function modelFromState(
  state: Pick<BoardStateDTO, "cards" | "groups" | "unsortedCardIds" | "trayOrder">,
): BoardModel {
  const ids = new Set(state.cards.map((c) => c.id));
  const ranked = state.trayOrder.filter((id) => ids.has(id));
  const seen = new Set(ranked);
  // Defensive: any card missing from trayOrder goes last, in DTO order.
  for (const c of state.cards) if (!seen.has(c.id)) ranked.push(c.id);
  return {
    cards: state.cards.map((c) => ({ ...c })),
    groups: state.groups.map((g) => ({ ...g, cardIds: [...g.cardIds] })),
    unsortedCardIds: [...state.unsortedCardIds],
    trayOrder: ranked,
  };
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

/** Tray contents for a set of ids, in canonical tray order. */
function trayFor(model: BoardModel, ids: Set<string>): string[] {
  return model.trayOrder.filter((id) => ids.has(id));
}

/** Remove a card from every group and the tray. */
function detach(model: BoardModel, cardId: string): BoardModel {
  return {
    ...model,
    groups: model.groups.map((g) =>
      g.cardIds.includes(cardId) ? { ...g, cardIds: g.cardIds.filter((id) => id !== cardId) } : g,
    ),
    unsortedCardIds: model.unsortedCardIds.filter((id) => id !== cardId),
  };
}

function moveCard(
  model: BoardModel,
  cardId: string,
  toGroupId: string | null,
  toIndex: number,
): BoardModel {
  if (!model.cards.some((c) => c.id === cardId)) return model;
  if (toGroupId === null) {
    if (model.unsortedCardIds.includes(cardId)) return model; // already in the tray: no-op
    const detached = detach(model, cardId);
    const tray = new Set([...detached.unsortedCardIds, cardId]);
    return { ...detached, unsortedCardIds: trayFor(detached, tray) };
  }
  if (!model.groups.some((g) => g.id === toGroupId)) return model;
  const detached = detach(model, cardId);
  return {
    ...detached,
    groups: detached.groups.map((g) => {
      if (g.id !== toGroupId) return g;
      const cardIds = [...g.cardIds];
      cardIds.splice(clamp(toIndex, 0, cardIds.length), 0, cardId);
      return { ...g, cardIds };
    }),
  };
}

const hasId = (model: BoardModel, id: string) =>
  model.cards.some((c) => c.id === id) || model.groups.some((g) => g.id === id);

/**
 * Apply one op. Ops the server would reject (unknown ids, duplicate ids) leave the model
 * unchanged; permission checks are the caller's job (controls are hidden) and the server's.
 */
export function applyBoardOp(model: BoardModel, op: BoardOpInput): BoardModel {
  switch (op.type) {
    case "moveCard":
      return moveCard(model, op.cardId, op.toGroupId, op.toIndex);

    case "addGroup": {
      if (hasId(model, op.groupId)) return model;
      if (op.withCardId !== undefined && !model.cards.some((c) => c.id === op.withCardId))
        return model;
      const added: BoardModel = {
        ...model,
        groups: [
          ...model.groups,
          { id: op.groupId, name: op.name.trim(), kind: "participant", cardIds: [] },
        ],
      };
      return op.withCardId !== undefined ? moveCard(added, op.withCardId, op.groupId, 0) : added;
    }

    case "renameGroup":
      if (!model.groups.some((g) => g.id === op.groupId)) return model;
      return {
        ...model,
        groups: model.groups.map((g) => (g.id === op.groupId ? { ...g, name: op.name.trim() } : g)),
      };

    case "deleteGroup": {
      const group = model.groups.find((g) => g.id === op.groupId);
      if (!group) return model;
      const remaining = { ...model, groups: model.groups.filter((g) => g.id !== op.groupId) };
      const tray = new Set([...model.unsortedCardIds, ...group.cardIds]);
      return { ...remaining, unsortedCardIds: trayFor(remaining, tray) };
    }

    case "addCard": {
      if (hasId(model, op.cardId)) return model;
      const card: CardDTO = {
        id: op.cardId,
        label: op.label.trim(),
        description: op.description?.trim() || null,
        origin: "participant",
        imageUrl: null,
      };
      const next = {
        ...model,
        cards: [...model.cards, card],
        trayOrder: [...model.trayOrder, card.id],
      };
      return {
        ...next,
        unsortedCardIds: trayFor(next, new Set([...model.unsortedCardIds, card.id])),
      };
    }

    case "editCard":
      if (!model.cards.some((c) => c.id === op.cardId)) return model;
      return {
        ...model,
        cards: model.cards.map((c) =>
          c.id === op.cardId
            ? { ...c, label: op.label.trim(), description: op.description?.trim() || null }
            : c,
        ),
      };

    case "deleteCard": {
      if (!model.cards.some((c) => c.id === op.cardId)) return model;
      const detached = detach(model, op.cardId);
      return {
        ...detached,
        cards: detached.cards.filter((c) => c.id !== op.cardId),
        trayOrder: detached.trayOrder.filter((id) => id !== op.cardId),
      };
    }

    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

/** Where a card currently is: a group id, null for the tray, undefined if unknown. */
export function locateCard(model: BoardModel, cardId: string): string | null | undefined {
  if (model.unsortedCardIds.includes(cardId)) return null;
  return model.groups.find((g) => g.cardIds.includes(cardId))?.id;
}

/** BRD-08: "X of Y cards sorted" — Y includes participant-created cards. */
export function sortProgress(model: BoardModel): { sorted: number; total: number } {
  const total = model.cards.length;
  return { sorted: total - model.unsortedCardIds.length, total };
}
