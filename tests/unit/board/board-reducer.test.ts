import { describe, expect, it } from "vitest";
import {
  applyBoardOp,
  locateCard,
  modelFromState,
  sortProgress,
  type BoardModel,
} from "@/components/board/board-reducer";
import { boardState, card, group } from "./fixtures";

/** Cards a..e predefined; tray shuffled as c, a, e; b in g1, d in g2. */
function sample(): BoardModel {
  return modelFromState(
    boardState({
      cards: [card("card-a"), card("card-b"), card("card-c"), card("card-d"), card("card-e")],
      groups: [
        group("group-1", ["card-b"], "predefined"),
        group("group-2", ["card-d"], "predefined"),
      ],
      unsortedCardIds: ["card-c", "card-a", "card-e"],
    }),
  );
}

describe("board reducer (SAVE-02 optimistic updates mirror the server)", () => {
  it("SAVE-02: modelFromState ranks unsorted cards first, then placed predefined, then participant cards", () => {
    const m = modelFromState(
      boardState({
        cards: [card("card-a"), card("card-b"), card("card-c"), card("own-x", "participant")],
        groups: [group("group-1", ["card-b"])],
        unsortedCardIds: ["card-c", "card-a", "own-x"],
      }),
    );
    expect(m.trayOrder).toEqual(["card-c", "card-a", "card-b", "own-x"]);
  });

  it("PERM-08: without randomisation the tray rank is the admin order", () => {
    const m = modelFromState(
      boardState({
        settings: { randomizeCardOrder: false },
        cards: [card("card-a"), card("card-b"), card("card-c")],
        groups: [group("group-1", ["card-b"])],
        unsortedCardIds: ["card-a", "card-c"],
      }),
    );
    expect(m.trayOrder).toEqual(["card-a", "card-b", "card-c"]);
    const back = applyBoardOp(m, {
      type: "moveCard",
      cardId: "card-b",
      toGroupId: null,
      toIndex: 5,
    });
    expect(back.unsortedCardIds).toEqual(["card-a", "card-b", "card-c"]);
  });

  it("does not mutate its input", () => {
    const m = sample();
    const copy = structuredClone(m);
    applyBoardOp(m, { type: "moveCard", cardId: "card-a", toGroupId: "group-1", toIndex: 0 });
    applyBoardOp(m, { type: "deleteGroup", groupId: "group-1" });
    expect(m).toEqual(copy);
  });

  describe("moveCard", () => {
    it("BRD-02: moves a card from the tray into a group at toIndex", () => {
      const m = applyBoardOp(sample(), {
        type: "moveCard",
        cardId: "card-a",
        toGroupId: "group-1",
        toIndex: 0,
      });
      expect(m.groups[0].cardIds).toEqual(["card-a", "card-b"]);
      expect(m.unsortedCardIds).toEqual(["card-c", "card-e"]);
    });

    it("BRD-02: clamps toIndex to the end of the list", () => {
      const m = applyBoardOp(sample(), {
        type: "moveCard",
        cardId: "card-a",
        toGroupId: "group-1",
        toIndex: 99,
      });
      expect(m.groups[0].cardIds).toEqual(["card-b", "card-a"]);
    });

    it("BRD-02: reorders within a group with arrayMove semantics (index after removal)", () => {
      let m = sample();
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-a", toGroupId: "group-1", toIndex: 1 });
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-c", toGroupId: "group-1", toIndex: 2 });
      expect(m.groups[0].cardIds).toEqual(["card-b", "card-a", "card-c"]);
      // b (index 0) to index 2: remove → [a, c], insert at 2 → [a, c, b]
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-b", toGroupId: "group-1", toIndex: 2 });
      expect(m.groups[0].cardIds).toEqual(["card-a", "card-c", "card-b"]);
      // c (index 1) to index 0
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-c", toGroupId: "group-1", toIndex: 0 });
      expect(m.groups[0].cardIds).toEqual(["card-c", "card-a", "card-b"]);
    });

    it("BRD-02: moves between groups and re-indexes the source", () => {
      const m = applyBoardOp(sample(), {
        type: "moveCard",
        cardId: "card-b",
        toGroupId: "group-2",
        toIndex: 0,
      });
      expect(m.groups[0].cardIds).toEqual([]);
      expect(m.groups[1].cardIds).toEqual(["card-b", "card-d"]);
    });

    it("BRD-02: moving back to the tray ignores toIndex and restores the tray rank", () => {
      let m = sample();
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-a", toGroupId: "group-1", toIndex: 0 });
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-a", toGroupId: null, toIndex: 0 });
      expect(m.unsortedCardIds).toEqual(["card-c", "card-a", "card-e"]);
      expect(m.groups[0].cardIds).toEqual(["card-b"]);
    });

    it("moving a tray card to the tray is a no-op", () => {
      const m = sample();
      expect(
        applyBoardOp(m, { type: "moveCard", cardId: "card-a", toGroupId: null, toIndex: 0 }),
      ).toBe(m);
    });

    it("SAVE-04: unknown cards or groups leave the board unchanged", () => {
      const m = sample();
      expect(
        applyBoardOp(m, {
          type: "moveCard",
          cardId: "nope-1234",
          toGroupId: "group-1",
          toIndex: 0,
        }),
      ).toBe(m);
      expect(
        applyBoardOp(m, { type: "moveCard", cardId: "card-a", toGroupId: "nope-1234", toIndex: 0 }),
      ).toBe(m);
    });
  });

  describe("groups", () => {
    it("BRD-05: addGroup appends a participant group with a trimmed name", () => {
      const m = applyBoardOp(sample(), {
        type: "addGroup",
        groupId: "group-new",
        name: "  Fruit ",
      });
      expect(m.groups.map((g) => g.id)).toEqual(["group-1", "group-2", "group-new"]);
      expect(m.groups[2]).toEqual({
        id: "group-new",
        name: "Fruit",
        kind: "participant",
        cardIds: [],
      });
    });

    it("BRD-07: addGroup withCardId puts that card first in the new group", () => {
      const m = applyBoardOp(sample(), {
        type: "addGroup",
        groupId: "group-new",
        name: "",
        withCardId: "card-b",
      });
      expect(m.groups[2].cardIds).toEqual(["card-b"]);
      expect(m.groups[0].cardIds).toEqual([]);
    });

    it("SAVE-04: addGroup rejects duplicate ids and unknown withCardId", () => {
      const m = sample();
      expect(applyBoardOp(m, { type: "addGroup", groupId: "group-1", name: "x" })).toBe(m);
      expect(applyBoardOp(m, { type: "addGroup", groupId: "card-a", name: "x" })).toBe(m);
      expect(
        applyBoardOp(m, {
          type: "addGroup",
          groupId: "group-new",
          name: "x",
          withCardId: "nope-1234",
        }),
      ).toBe(m);
    });

    it("PERM-03: renameGroup sets the trimmed name", () => {
      const m = applyBoardOp(sample(), {
        type: "renameGroup",
        groupId: "group-2",
        name: " Tools  ",
      });
      expect(m.groups[1].name).toBe("Tools");
    });

    it("PERM-04: deleteGroup returns its cards to the tray in tray order", () => {
      let m = sample();
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-e", toGroupId: "group-1", toIndex: 0 });
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-c", toGroupId: "group-1", toIndex: 0 });
      expect(m.groups[0].cardIds).toEqual(["card-c", "card-e", "card-b"]);
      m = applyBoardOp(m, { type: "deleteGroup", groupId: "group-1" });
      expect(m.groups.map((g) => g.id)).toEqual(["group-2"]);
      expect(m.unsortedCardIds).toEqual(["card-c", "card-a", "card-e", "card-b"]);
    });
  });

  describe("cards", () => {
    it("PERM-01: addCard appends a participant card to the end of the tray", () => {
      const m = applyBoardOp(sample(), {
        type: "addCard",
        cardId: "own-card1",
        label: " Mine ",
        description: "  ",
      });
      expect(m.cards.at(-1)).toEqual({
        id: "own-card1",
        label: "Mine",
        description: null,
        origin: "participant",
      });
      expect(m.unsortedCardIds).toEqual(["card-c", "card-a", "card-e", "own-card1"]);
      expect(m.trayOrder.at(-1)).toBe("own-card1");
    });

    it("PERM-01: participant cards return to the tray after predefined cards", () => {
      let m = applyBoardOp(sample(), { type: "addCard", cardId: "own-card1", label: "Mine" });
      m = applyBoardOp(m, {
        type: "moveCard",
        cardId: "own-card1",
        toGroupId: "group-1",
        toIndex: 0,
      });
      m = applyBoardOp(m, { type: "moveCard", cardId: "card-b", toGroupId: null, toIndex: 0 });
      m = applyBoardOp(m, { type: "moveCard", cardId: "own-card1", toGroupId: null, toIndex: 0 });
      expect(m.unsortedCardIds).toEqual(["card-c", "card-a", "card-e", "card-b", "own-card1"]);
    });

    it("PERM-02: editCard updates label and description", () => {
      let m = applyBoardOp(sample(), { type: "addCard", cardId: "own-card1", label: "Mine" });
      m = applyBoardOp(m, {
        type: "editCard",
        cardId: "own-card1",
        label: "Renamed",
        description: " Why ",
      });
      expect(m.cards.at(-1)).toMatchObject({ label: "Renamed", description: "Why" });
    });

    it("PERM-02: deleteCard removes the card everywhere", () => {
      let m = applyBoardOp(sample(), { type: "addCard", cardId: "own-card1", label: "Mine" });
      m = applyBoardOp(m, {
        type: "moveCard",
        cardId: "own-card1",
        toGroupId: "group-2",
        toIndex: 0,
      });
      m = applyBoardOp(m, { type: "deleteCard", cardId: "own-card1" });
      expect(m.cards.some((c) => c.id === "own-card1")).toBe(false);
      expect(m.groups[1].cardIds).toEqual(["card-d"]);
      expect(m.trayOrder).not.toContain("own-card1");
    });

    it("SAVE-04: addCard with an existing id is ignored", () => {
      const m = sample();
      expect(applyBoardOp(m, { type: "addCard", cardId: "card-a", label: "dup" })).toBe(m);
    });
  });

  it("BRD-08: progress counts sorted cards including participant-created cards", () => {
    let m = sample();
    expect(sortProgress(m)).toEqual({ sorted: 2, total: 5 });
    m = applyBoardOp(m, { type: "addCard", cardId: "own-card1", label: "Mine" });
    expect(sortProgress(m)).toEqual({ sorted: 2, total: 6 });
    m = applyBoardOp(m, {
      type: "moveCard",
      cardId: "own-card1",
      toGroupId: "group-1",
      toIndex: 0,
    });
    expect(sortProgress(m)).toEqual({ sorted: 3, total: 6 });
  });

  it("locateCard finds the tray, a group, or nothing", () => {
    const m = sample();
    expect(locateCard(m, "card-a")).toBeNull();
    expect(locateCard(m, "card-b")).toBe("group-1");
    expect(locateCard(m, "nope")).toBeUndefined();
  });
});
