// The optimistic reducer must produce exactly what the server stores (SAVE-02): apply random
// op sequences to both the board service (in-memory SQLite, ops parsed like the route does)
// and the reducer, compare states.
import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  applyBoardOp as reduce,
  modelFromState,
  type BoardModel,
} from "@/components/board/board-reducer";
import { BoardOpSchema, type BoardOpInput } from "@/lib/schemas";
import { applyBoardOp, getBoardState } from "@/server/services/boards";
import { createTestDb } from "../../helpers/db";
import { makeBoard, makeCards, makeGroups, makeStudy } from "../../helpers/factories";

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const view = (m: BoardModel) => ({
  cards: m.cards,
  groups: m.groups,
  unsortedCardIds: m.unsortedCardIds,
});

function randomOp(m: BoardModel, r: () => number): BoardOpInput {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const own = m.groups.filter((g) => g.kind === "participant");
  const ownCards = m.cards.filter((c) => c.origin === "participant");
  const roll = r();
  if (roll < 0.55 && m.cards.length > 0) {
    const toTray = r() < 0.2 || m.groups.length === 0;
    return {
      type: "moveCard",
      cardId: pick(m.cards).id,
      toGroupId: toTray ? null : pick(m.groups).id,
      toIndex: Math.floor(r() * 5),
    };
  }
  if (roll < 0.65) {
    const withCard = r() < 0.5 && m.cards.length > 0 ? pick(m.cards).id : undefined;
    return {
      type: "addGroup",
      groupId: nanoid(),
      name: ` g${Math.floor(r() * 9)} `,
      ...(withCard ? { withCardId: withCard } : {}),
    };
  }
  if (roll < 0.72 && own.length > 0)
    return { type: "renameGroup", groupId: pick(own).id, name: `n${Math.floor(r() * 9)}` };
  if (roll < 0.8 && own.length > 0) return { type: "deleteGroup", groupId: pick(own).id };
  if (roll < 0.88)
    return {
      type: "addCard",
      cardId: nanoid(),
      label: `own ${Math.floor(r() * 99)}`,
      description: r() < 0.5 ? " d " : null,
    };
  if (roll < 0.94 && ownCards.length > 0)
    return { type: "editCard", cardId: pick(ownCards).id, label: "edited", description: "x" };
  if (ownCards.length > 0) return { type: "deleteCard", cardId: pick(ownCards).id };
  return { type: "addGroup", groupId: nanoid(), name: "fallback" };
}

describe("reducer ⇄ server parity", () => {
  for (const randomize of [false, true]) {
    for (const seed of [1, 2, 3, 4, 5]) {
      it(`SAVE-02: random op sequence ${seed} (randomizeCardOrder=${randomize}) matches the server`, () => {
        const db = createTestDb();
        const study = makeStudy(db, {
          sortType: "hybrid",
          settings: { allowParticipantCards: true, randomizeCardOrder: randomize },
        });
        const cards = makeCards(db, study.id, ["A", "B", "C", "D", "E", "F"]);
        makeGroups(db, study.id, ["P1", "P2"]);
        const order = randomize
          ? [cards[3], cards[0], cards[5], cards[1], cards[4], cards[2]]
          : cards;
        const board = makeBoard(db, study.id, { cardOrder: order.map((c) => c.id) });

        const r = rng(seed);
        let model = modelFromState(getBoardState(db, board.token));
        for (let step = 0; step < 60; step++) {
          const op = randomOp(model, r);
          const revision = getBoardState(db, board.token).board.revision;
          applyBoardOp(db, board.token, { revision, op: BoardOpSchema.parse(op) });
          model = reduce(model, op);
          expect(view(model), `step ${step}: ${JSON.stringify(op)}`).toEqual(
            view(modelFromState(getBoardState(db, board.token))),
          );
        }
      });
    }
  }

  it("SAVE-02: a card returned to the tray lands where the server puts it (admin order, model from a reload)", () => {
    const db = createTestDb();
    const study = makeStudy(db, { sortType: "hybrid", settings: { randomizeCardOrder: false } });
    const cards = makeCards(db, study.id, ["A", "B", "C"]);
    const [g] = makeGroups(db, study.id, ["P1"]);
    const board = makeBoard(db, study.id, { cardOrder: cards.map((c) => c.id) });
    applyBoardOp(db, board.token, {
      revision: 0,
      op: { type: "moveCard", cardId: cards[1].id, toGroupId: g.id, toIndex: 0 },
    });
    // Model built from a reload, where B's rank must be reconstructed.
    let model = modelFromState(getBoardState(db, board.token));
    const op: BoardOpInput = { type: "moveCard", cardId: cards[1].id, toGroupId: null, toIndex: 0 };
    applyBoardOp(db, board.token, { revision: 1, op: BoardOpSchema.parse(op) });
    model = reduce(model, op);
    expect(model.unsortedCardIds).toEqual(getBoardState(db, board.token).unsortedCardIds);
  });
});
