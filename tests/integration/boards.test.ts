import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { BoardStateDTO, ErrorCode } from "@/lib/api-types";
import type { BoardOpInput } from "@/lib/schemas";
import { BoardOpSchema } from "@/lib/schemas";
import { LIMITS } from "@/lib/types";
import type { DB } from "@/server/db/open";
import { boards, cards, placements, studies } from "@/server/db/schema";
import { ServiceError } from "@/server/errors";
import {
  applyBoardOp,
  completeBoard,
  createBoard,
  getBoardState,
  getBoardStateById,
  getPublicStudy,
} from "@/server/services/boards";
import { createTestDb } from "../helpers/db";
import { makeCard, makeCards, makeGroup, makeGroups, makeStudy, type StudyOverrides } from "../helpers/factories";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function expectError(fn: () => unknown, code: ErrorCode): ServiceError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ServiceError ${code}`).toBeInstanceOf(ServiceError);
  expect((caught as ServiceError).code).toBe(code);
  return caught as ServiceError;
}

type Setup = {
  db: DB;
  study: ReturnType<typeof makeStudy>;
  cardIds: string[];
  groupIds: string[];
  token: string;
};

/** Create a study (+ cards/groups) and one board through the real createBoard path. */
function setup(
  overrides: StudyOverrides = {},
  opts: { cards?: string[]; groups?: string[]; db?: DB } = {},
): Setup {
  const db = opts.db ?? createTestDb();
  const study = makeStudy(db, { settings: { randomizeCardOrder: false }, ...overrides });
  const cardIds = makeCards(db, study.id, opts.cards ?? ["Apples", "Bananas", "Carrots", "Dates"]).map(
    (c) => c.id,
  );
  const groupIds = makeGroups(db, study.id, opts.groups ?? []).map((g) => g.id);
  const { token } = createBoard(db, study.slug, { name: "Ann" });
  return { db, study, cardIds, groupIds, token };
}

const closedSetup = (o: StudyOverrides = {}, opts: { db?: DB; cards?: string[] } = {}) =>
  setup({ sortType: "closed", ...o }, { groups: ["Fruit", "Veg"], ...opts });
const hybridSetup = (o: StudyOverrides = {}) =>
  setup({ sortType: "hybrid", ...o }, { groups: ["Fruit", "Veg"] });
const openFixedSetup = (o: StudyOverrides = {}) =>
  setup({ sortType: "open", groupMode: "fixed", fixedGroupCount: 3, ...o });
const openUnboundedSetup = (o: StudyOverrides = {}, opts: { db?: DB } = {}) =>
  setup({ sortType: "open", groupMode: "unbounded", ...o }, opts);

const state = (s: Pick<Setup, "db" | "token">) => getBoardState(s.db, s.token);

/** Apply an op at the board's current revision. */
function op(s: Pick<Setup, "db" | "token">, input: BoardOpInput) {
  return applyBoardOp(s.db, s.token, { revision: state(s).board.revision, op: BoardOpSchema.parse(input) });
}

const groupOf = (st: BoardStateDTO, groupId: string) => {
  const g = st.groups.find((x) => x.id === groupId);
  if (!g) throw new Error(`group ${groupId} not on board`);
  return g;
};

/** Run an op that must fail, and check the board is unchanged (SAVE-04). */
function expectRejected(s: Pick<Setup, "db" | "token">, input: BoardOpInput, code: ErrorCode) {
  const before = state(s);
  const err = expectError(() => op(s, input), code);
  expect(state(s)).toEqual(before);
  return err;
}

// ---------------------------------------------------------------------------
// getPublicStudy
// ---------------------------------------------------------------------------

describe("getPublicStudy", () => {
  it("PART-01: returns the intro data including status, for live and non-live studies", () => {
    const db = createTestDb();
    const live = makeStudy(db, { title: "Navigation", instructions: "Sort these" });
    expect(getPublicStudy(db, live.slug)).toEqual({
      slug: live.slug,
      title: "Navigation",
      instructions: "Sort these",
      status: "live",
      participantFields: [{ key: "name", mode: "required" }],
    });
    const draft = makeStudy(db, { status: "draft" });
    expect(getPublicStudy(db, draft.slug).status).toBe("draft");
    const dto = getPublicStudy(db, live.slug) as unknown as Record<string, unknown>;
    expect(dto.id).toBeUndefined();
    expect(dto.description).toBeUndefined();
  });

  it("PART-01: unknown slug is not_found", () => {
    expectError(() => getPublicStudy(createTestDb(), "nope"), "not_found");
  });
});

// ---------------------------------------------------------------------------
// createBoard
// ---------------------------------------------------------------------------

describe("createBoard", () => {
  it("PART-02: creates an in-progress board with an unguessable token and stores answers", () => {
    const s = closedSetup();
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{24,}$/); // 18 bytes = 144 bits
    const st = state(s);
    expect(st.board.status).toBe("in_progress");
    expect(st.board.revision).toBe(0);
    expect(st.board.participant).toEqual({ name: "Ann" });
    expect(st.board.completedAt).toBeNull();
    const other = createBoard(s.db, s.study.slug, { name: "Bob" });
    expect(other.token).not.toBe(s.token);
  });

  it("PART-02: rejects draft and closed studies with study_not_live, unknown slugs with not_found", () => {
    const db = createTestDb();
    for (const status of ["draft", "closed"] as const) {
      const study = makeStudy(db, { status });
      expectError(() => createBoard(db, study.slug, { name: "Ann" }), "study_not_live");
    }
    expectError(() => createBoard(db, "missing", { name: "Ann" }), "not_found");
    expect(db.select().from(boards).all()).toHaveLength(0);
  });

  it("PFLD-02: validates answers server-side (required, email, selects, self-described gender)", () => {
    const db = createTestDb();
    const study = makeStudy(db, {
      participantFields: [
        { key: "name", mode: "required" },
        { key: "email", mode: "optional" },
        { key: "seniority", mode: "optional" },
        { key: "country", mode: "optional" },
        { key: "gender", mode: "optional" },
      ],
    });
    const missing = expectError(() => createBoard(db, study.slug, {}), "bad_request");
    expect(missing.details).toMatchObject({ fieldErrors: { name: expect.any(Array) } });
    expectError(() => createBoard(db, study.slug, { name: "A", email: "not-an-email" }), "bad_request");
    expectError(() => createBoard(db, study.slug, { name: "A", seniority: "wizard" }), "bad_request");
    expectError(() => createBoard(db, study.slug, { name: "A", country: "XX" }), "bad_request");
    expectError(() => createBoard(db, study.slug, { name: "A", gender: "self_describe" }), "bad_request");
    expectError(() => createBoard(db, study.slug, { name: "x".repeat(201) }), "bad_request");
    expect(db.select().from(boards).all()).toHaveLength(0);

    const { token } = createBoard(db, study.slug, {
      name: "  Ann  ",
      email: "",
      seniority: "senior",
      country: "GB",
      gender: "self_describe",
      genderSelfDescribe: "Agender",
      sneaky: "dropped",
    });
    expect(getBoardState(db, token).board.participant).toEqual({
      name: "Ann",
      seniority: "senior",
      country: "GB",
      gender: "self_describe",
      genderSelfDescribe: "Agender",
    });
  });

  it("PFLD-05: a study with no participant fields accepts an empty details object", () => {
    const db = createTestDb();
    const study = makeStudy(db, { participantFields: [] });
    const { token } = createBoard(db, study.slug, { ignored: "x" });
    expect(getBoardState(db, token).board.participant).toEqual({});
  });

  it("STU-05: fixed-mode open sorts start with N placeholder groups named Group 1..N", () => {
    const s = openFixedSetup();
    const st = state(s);
    expect(st.groups.map((g) => [g.name, g.kind, g.cardIds.length])).toEqual([
      ["Group 1", "placeholder", 0],
      ["Group 2", "placeholder", 0],
      ["Group 3", "placeholder", 0],
    ]);
    // Each board gets its own placeholders.
    const other = createBoard(s.db, s.study.slug, { name: "Bob" });
    const otherIds = getBoardState(s.db, other.token).groups.map((g) => g.id);
    expect(otherIds.some((gid) => st.groups.some((g) => g.id === gid))).toBe(false);
  });

  it("STU-04: unbounded open sorts start with no groups; closed sorts show predefined groups", () => {
    expect(state(openUnboundedSetup()).groups).toEqual([]);
    const c = closedSetup();
    expect(state(c).groups.map((g) => [g.id, g.name, g.kind])).toEqual([
      [c.groupIds[0], "Fruit", "predefined"],
      [c.groupIds[1], "Veg", "predefined"],
    ]);
  });

  it("PERM-08: with randomisation off the tray uses the admin order", () => {
    const s = closedSetup({ settings: { randomizeCardOrder: false } });
    expect(state(s).unsortedCardIds).toEqual(s.cardIds);
  });

  it("PERM-08: with randomisation on each board gets a shuffled order that stays stable", () => {
    const db = createTestDb();
    const study = makeStudy(db, { settings: { randomizeCardOrder: true } });
    const labels = Array.from({ length: 20 }, (_, i) => `Card ${i}`);
    const ids = makeCards(db, study.id, labels).map((c) => c.id);
    const orders: string[][] = [];
    for (let i = 0; i < 5; i++) {
      const { token } = createBoard(db, study.slug, { name: `P${i}` });
      const first = getBoardState(db, token).unsortedCardIds;
      expect([...first].sort()).toEqual([...ids].sort());
      expect(getBoardState(db, token).unsortedCardIds).toEqual(first); // stable on reload
      orders.push(first);
    }
    // 5 boards × 20! permutations: the chance all equal the admin order is negligible.
    expect(orders.some((o) => o.join() !== ids.join())).toBe(true);
    expect(new Set(orders.map((o) => o.join())).size).toBeGreaterThan(1);
  });

  it("PERM-08: the shuffled tray order is kept after cards are sorted and unsorted", () => {
    const db = createTestDb();
    const study = makeStudy(db, { settings: { randomizeCardOrder: true } });
    makeCards(db, study.id, Array.from({ length: 10 }, (_, i) => `C${i}`));
    const [g] = makeGroups(db, study.id, ["G"]);
    const { token } = createBoard(db, study.slug, { name: "Ann" });
    const s = { db, token };
    const order = state(s).unsortedCardIds;
    op(s, { type: "moveCard", cardId: order[3], toGroupId: g.id, toIndex: 0 });
    expect(state(s).unsortedCardIds).toEqual(order.filter((c) => c !== order[3]));
    op(s, { type: "moveCard", cardId: order[3], toGroupId: null, toIndex: 0 });
    expect(state(s).unsortedCardIds).toEqual(order);
  });
});

// ---------------------------------------------------------------------------
// getBoardState
// ---------------------------------------------------------------------------

describe("getBoardState", () => {
  it("PART-04: unknown tokens and ids are not_found", () => {
    const s = closedSetup();
    expectError(() => getBoardState(s.db, "does-not-exist"), "not_found");
    expectError(() => getBoardState(s.db, ""), "not_found");
    expectError(() => getBoardStateById(s.db, "does-not-exist"), "not_found");
  });

  it("PART-04: one board's token shows none of another board's cards or groups", () => {
    const s = openUnboundedSetup({ settings: { allowParticipantCards: true, randomizeCardOrder: false } });
    const other = { db: s.db, token: createBoard(s.db, s.study.slug, { name: "Bob" }).token };
    op(other, { type: "addGroup", groupId: "otherGroup1", name: "Theirs" });
    op(other, { type: "addCard", cardId: "otherCard1", label: "Their card" });
    const mine = state(s);
    expect(mine.groups).toEqual([]);
    expect(mine.cards.map((c) => c.id)).toEqual(s.cardIds);
    expect(state(other).cards.map((c) => c.id)).toContain("otherCard1");
  });

  it("PART-03: returns the full state shape; getBoardStateById returns the same", () => {
    const s = hybridSetup({ settings: { allowParticipantCards: true, randomizeCardOrder: false } });
    op(s, { type: "addGroup", groupId: "myGroup01", name: "Mine" });
    op(s, { type: "addCard", cardId: "myCard001", label: "Extra", description: "desc" });
    op(s, { type: "moveCard", cardId: s.cardIds[1], toGroupId: s.groupIds[0], toIndex: 0 });
    op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 });
    op(s, { type: "moveCard", cardId: s.cardIds[2], toGroupId: "myGroup01", toIndex: 0 });
    const st = state(s);
    expect(st.study).toMatchObject({
      slug: s.study.slug,
      title: s.study.title,
      status: "live",
      sortType: "hybrid",
      participantFields: [{ key: "name", mode: "required" }],
    });
    expect(st.groups.map((g) => [g.name, g.kind, g.cardIds])).toEqual([
      ["Fruit", "predefined", [s.cardIds[0], s.cardIds[1]]],
      ["Veg", "predefined", []],
      ["Mine", "participant", [s.cardIds[2]]],
    ]);
    expect(st.unsortedCardIds).toEqual([s.cardIds[3], "myCard001"]);
    expect(st.cards.at(-1)).toEqual({ id: "myCard001", label: "Extra", description: "desc", origin: "participant" });
    expect(st.board.revision).toBe(5);
    expect(getBoardStateById(s.db, st.board.id)).toEqual(st);
  });
});

// ---------------------------------------------------------------------------
// applyBoardOp — common checks
// ---------------------------------------------------------------------------

describe("applyBoardOp: status, revision and activity", () => {
  it("SAVE-01: a move is persisted and visible on reload", () => {
    const s = closedSetup();
    op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 });
    // A fresh read (as after a page reload) shows the change.
    expect(getBoardState(s.db, s.token).groups[0].cardIds).toEqual([s.cardIds[0]]);
  });

  it("SAVE-03: increments the revision and rejects a stale revision with stale_revision", () => {
    const s = closedSetup();
    const r1 = applyBoardOp(s.db, s.token, {
      revision: 0,
      op: BoardOpSchema.parse({ type: "moveCard", cardId: s.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 }),
    });
    expect(r1.revision).toBe(1);
    const before = state(s);
    const err = expectError(
      () =>
        applyBoardOp(s.db, s.token, {
          revision: 0, // a second tab still on revision 0
          op: BoardOpSchema.parse({ type: "moveCard", cardId: s.cardIds[1], toGroupId: s.groupIds[1], toIndex: 0 }),
        }),
      "stale_revision",
    );
    expect(err.status).toBe(409);
    expect(state(s)).toEqual(before);
    expectError(
      () =>
        applyBoardOp(s.db, s.token, {
          revision: 7,
          op: BoardOpSchema.parse({ type: "moveCard", cardId: s.cardIds[1], toGroupId: null, toIndex: 0 }),
        }),
      "stale_revision",
    );
  });

  it("SAVE-05: every saved change updates lastActivityAt", async () => {
    const s = closedSetup();
    const before = state(s).board.lastActivityAt;
    await new Promise((r) => setTimeout(r, 5));
    const res = op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 });
    expect(res.lastActivityAt > before).toBe(true);
    expect(state(s).board.lastActivityAt).toBe(res.lastActivityAt);
  });

  it("DONE-04: rejects every op on a completed board with board_completed (409)", () => {
    const s = openUnboundedSetup({ settings: { allowParticipantCards: true } });
    completeBoard(s.db, s.token);
    const ops: BoardOpInput[] = [
      { type: "moveCard", cardId: s.cardIds[0], toGroupId: null, toIndex: 0 },
      { type: "addGroup", groupId: "newGroup01", name: "X" },
      { type: "addCard", cardId: "newCard001", label: "X" },
    ];
    for (const o of ops) {
      const err = expectRejected(s, o, "board_completed");
      expect(err.status).toBe(409);
    }
  });

  it("PART-06: rejects ops while the study is closed; reopening makes the board editable again", () => {
    const s = closedSetup();
    s.db.update(studies).set({ status: "closed" }).where(eq(studies.id, s.study.id)).run();
    expectRejected(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 }, "study_not_live");
    expectError(() => completeBoard(s.db, s.token), "study_not_live");
    expect(state(s).study.status).toBe("closed");
    s.db.update(studies).set({ status: "live" }).where(eq(studies.id, s.study.id)).run();
    expect(op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 }).revision).toBe(1);
  });

  it("PART-04: ops and completion with an unknown token are not_found", () => {
    const s = closedSetup();
    expectError(
      () =>
        applyBoardOp(s.db, "nope", {
          revision: 0,
          op: BoardOpSchema.parse({ type: "moveCard", cardId: s.cardIds[0], toGroupId: null, toIndex: 0 }),
        }),
      "not_found",
    );
    expectError(() => completeBoard(s.db, "nope"), "not_found");
  });
});

// ---------------------------------------------------------------------------
// moveCard
// ---------------------------------------------------------------------------

describe("applyBoardOp: moveCard", () => {
  it("SAVE-01: moves into a group at an index, reorders within it, and clamps the index", () => {
    const s = closedSetup();
    const [a, b, c, d] = s.cardIds;
    const [fruit] = s.groupIds;
    op(s, { type: "moveCard", cardId: a, toGroupId: fruit, toIndex: 0 });
    op(s, { type: "moveCard", cardId: b, toGroupId: fruit, toIndex: 99 }); // clamped → end
    op(s, { type: "moveCard", cardId: c, toGroupId: fruit, toIndex: 1 });
    expect(groupOf(state(s), fruit).cardIds).toEqual([a, c, b]);
    op(s, { type: "moveCard", cardId: a, toGroupId: fruit, toIndex: 2 }); // reorder within
    expect(groupOf(state(s), fruit).cardIds).toEqual([c, b, a]);
    op(s, { type: "moveCard", cardId: a, toGroupId: fruit, toIndex: 0 });
    expect(groupOf(state(s), fruit).cardIds).toEqual([a, c, b]);
    expect(state(s).unsortedCardIds).toEqual([d]);
  });

  it("SAVE-01: moving between groups re-indexes both groups contiguously", () => {
    const s = closedSetup();
    const [a, b, c, d] = s.cardIds;
    const [fruit, veg] = s.groupIds;
    for (const card of [a, b, c]) op(s, { type: "moveCard", cardId: card, toGroupId: fruit, toIndex: 99 });
    op(s, { type: "moveCard", cardId: d, toGroupId: veg, toIndex: 0 });
    op(s, { type: "moveCard", cardId: a, toGroupId: veg, toIndex: 1 });
    const st = state(s);
    expect(groupOf(st, fruit).cardIds).toEqual([b, c]);
    expect(groupOf(st, veg).cardIds).toEqual([d, a]);
    const rows = s.db.select().from(placements).where(eq(placements.boardId, st.board.id)).all();
    const positions = (gid: string) =>
      rows.filter((r) => r.groupId === gid).map((r) => r.position).sort();
    expect(positions(fruit)).toEqual([0, 1]);
    expect(positions(veg)).toEqual([0, 1]);
  });

  it("SAVE-01: moving to the tray (toGroupId null) unsorts the card and re-indexes its group", () => {
    const s = closedSetup();
    const [a, b, c] = s.cardIds;
    const [fruit] = s.groupIds;
    for (const card of [a, b, c]) op(s, { type: "moveCard", cardId: card, toGroupId: fruit, toIndex: 99 });
    op(s, { type: "moveCard", cardId: a, toGroupId: null, toIndex: 5 });
    const st = state(s);
    expect(groupOf(st, fruit).cardIds).toEqual([b, c]);
    // Tray order comes from cardOrder, toIndex is ignored.
    expect(st.unsortedCardIds).toEqual([a, s.cardIds[3]]);
    // Moving an unsorted card to the tray is a harmless no-op that still saves.
    expect(op(s, { type: "moveCard", cardId: a, toGroupId: null, toIndex: 0 }).revision).toBe(st.board.revision + 1);
  });

  it("SAVE-04: rejects unknown cards and groups and leaves the board unchanged", () => {
    const s = closedSetup();
    expectRejected(s, { type: "moveCard", cardId: "unknownCard", toGroupId: s.groupIds[0], toIndex: 0 }, "not_found");
    expectRejected(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: "unknownGroup", toIndex: 0 }, "not_found");
  });

  it("SAVE-04: rejects cards and groups from another study", () => {
    const db = createTestDb();
    const s = closedSetup({}, { db });
    const other = closedSetup({}, { db, cards: ["Other card"] });
    expectRejected(s, { type: "moveCard", cardId: other.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 }, "not_found");
    expectRejected(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: other.groupIds[0], toIndex: 0 }, "not_found");
  });

  it("SAVE-04: rejects participant cards and groups of another board of the same study", () => {
    const s = openUnboundedSetup({ settings: { allowParticipantCards: true } });
    const other = { db: s.db, token: createBoard(s.db, s.study.slug, { name: "Bob" }).token };
    op(other, { type: "addGroup", groupId: "theirGroup1", name: "Theirs" });
    op(other, { type: "addCard", cardId: "theirCard01", label: "Theirs" });
    op(s, { type: "addGroup", groupId: "myGroup0001", name: "Mine" });

    expectRejected(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: "theirGroup1", toIndex: 0 }, "not_found");
    expectRejected(s, { type: "moveCard", cardId: "theirCard01", toGroupId: "myGroup0001", toIndex: 0 }, "not_found");
    expectRejected(s, { type: "renameGroup", groupId: "theirGroup1", name: "Hijack" }, "not_found");
    expectRejected(s, { type: "deleteGroup", groupId: "theirGroup1" }, "not_found");
    expectRejected(s, { type: "editCard", cardId: "theirCard01", label: "Hijack" }, "not_found");
    expectRejected(s, { type: "deleteCard", cardId: "theirCard01" }, "not_found");
    expectRejected(s, { type: "addGroup", groupId: "myGroup0002", name: "X", withCardId: "theirCard01" }, "not_found");
    // The other board is untouched.
    expect(state(other).groups.map((g) => g.name)).toEqual(["Theirs"]);
    expect(state(other).cards.map((c) => c.label)).toContain("Theirs");
  });

  it("SAVE-04: rejects placeholder groups of another board in fixed mode", () => {
    const s = openFixedSetup();
    const other = { db: s.db, token: createBoard(s.db, s.study.slug, { name: "Bob" }).token };
    const theirGroup = state(other).groups[0].id;
    expectRejected(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: theirGroup, toIndex: 0 }, "not_found");
    expectRejected(s, { type: "renameGroup", groupId: theirGroup, name: "Hijack" }, "not_found");
  });
});

// ---------------------------------------------------------------------------
// Groups: permission matrix (DESIGN §5)
// ---------------------------------------------------------------------------

describe("applyBoardOp: groups in closed sorts", () => {
  it("PERM-03 / PERM-04 / STU-04: participants cannot add, rename or delete groups", () => {
    const s = closedSetup();
    expectRejected(s, { type: "addGroup", groupId: "newGroup01", name: "X" }, "forbidden");
    expectRejected(s, { type: "renameGroup", groupId: s.groupIds[0], name: "X" }, "forbidden");
    expectRejected(s, { type: "deleteGroup", groupId: s.groupIds[0] }, "forbidden");
  });
});

describe("applyBoardOp: groups in open fixed-mode sorts", () => {
  it("STU-05: participants cannot add or delete groups", () => {
    const s = openFixedSetup();
    const g = state(s).groups[0].id;
    expectRejected(s, { type: "addGroup", groupId: "newGroup01", name: "X" }, "forbidden");
    expectRejected(s, { type: "deleteGroup", groupId: g }, "forbidden");
  });

  it("PERM-03: placeholders can be renamed when allowed", () => {
    const s = openFixedSetup();
    const g = state(s).groups[1].id;
    op(s, { type: "renameGroup", groupId: g, name: "  Tools  " });
    expect(groupOf(state(s), g).name).toBe("Tools");
    op(s, { type: "renameGroup", groupId: g, name: "" }); // blank allowed while editing
    expect(groupOf(state(s), g).name).toBe("");
  });

  it("PERM-03: placeholders cannot be renamed when renaming is off", () => {
    const s = openFixedSetup({ settings: { allowRenameGroups: false, randomizeCardOrder: false } });
    expectRejected(s, { type: "renameGroup", groupId: state(s).groups[0].id, name: "X" }, "forbidden");
  });
});

describe("applyBoardOp: groups in open unbounded sorts", () => {
  it("BRD-05: adds participant groups, appended after existing ones", () => {
    const s = openUnboundedSetup();
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "First" });
    op(s, { type: "addGroup", groupId: "groupBBBB2", name: "" });
    expect(state(s).groups.map((g) => [g.id, g.name, g.kind])).toEqual([
      ["groupAAAA1", "First", "participant"],
      ["groupBBBB2", "", "participant"],
    ]);
  });

  it("BRD-07: addGroup with withCardId creates the group containing that card", () => {
    const s = openUnboundedSetup();
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "A" });
    op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: "groupAAAA1", toIndex: 0 });
    op(s, { type: "moveCard", cardId: s.cardIds[1], toGroupId: "groupAAAA1", toIndex: 1 });
    op(s, { type: "addGroup", groupId: "groupBBBB2", name: "B", withCardId: s.cardIds[0] });
    const st = state(s);
    expect(groupOf(st, "groupBBBB2").cardIds).toEqual([s.cardIds[0]]);
    expect(groupOf(st, "groupAAAA1").cardIds).toEqual([s.cardIds[1]]);
    op(s, { type: "addGroup", groupId: "groupCCCC3", name: "C", withCardId: s.cardIds[2] });
    expect(groupOf(state(s), "groupCCCC3").cardIds).toEqual([s.cardIds[2]]);
    expect(state(s).unsortedCardIds).toEqual([s.cardIds[3]]);
  });

  it("SAVE-04: addGroup with an id that already exists is a conflict", () => {
    const db = createTestDb();
    const s = openUnboundedSetup({}, { db });
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "A" });
    expectRejected(s, { type: "addGroup", groupId: "groupAAAA1", name: "Again" }, "conflict");
    const foreign = makeGroup(db, makeStudy(db).id, { name: "Elsewhere" });
    expectRejected(s, { type: "addGroup", groupId: foreign.id, name: "Clash" }, "conflict");
  });

  it("PERM-03: own groups can be renamed, unless renaming is off", () => {
    const s = openUnboundedSetup();
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "A" });
    op(s, { type: "renameGroup", groupId: "groupAAAA1", name: "Renamed" });
    expect(groupOf(state(s), "groupAAAA1").name).toBe("Renamed");
    const off = openUnboundedSetup({ settings: { allowRenameGroups: false } });
    op(off, { type: "addGroup", groupId: "groupAAAA1", name: "A" });
    expectRejected(off, { type: "renameGroup", groupId: "groupAAAA1", name: "X" }, "forbidden");
  });

  it("PERM-04: deleting an own group returns its cards to the tray", () => {
    const s = openUnboundedSetup();
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "A" });
    op(s, { type: "moveCard", cardId: s.cardIds[2], toGroupId: "groupAAAA1", toIndex: 0 });
    op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: "groupAAAA1", toIndex: 0 });
    op(s, { type: "deleteGroup", groupId: "groupAAAA1" });
    const st = state(s);
    expect(st.groups).toEqual([]);
    expect(st.unsortedCardIds).toEqual(s.cardIds);
    expect(s.db.select().from(placements).all()).toHaveLength(0);
  });

  it("PERM-04: own groups cannot be deleted when deleting is off", () => {
    const s = openUnboundedSetup({ settings: { allowDeleteGroups: false } });
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "A" });
    expectRejected(s, { type: "deleteGroup", groupId: "groupAAAA1" }, "forbidden");
  });

  it("STU-06: the server rejects groups beyond maxParticipantGroups", () => {
    const s = openUnboundedSetup({ maxParticipantGroups: 2 });
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "A" });
    op(s, { type: "addGroup", groupId: "groupBBBB2", name: "B" });
    expectRejected(s, { type: "addGroup", groupId: "groupCCCC3", name: "C" }, "forbidden");
    op(s, { type: "deleteGroup", groupId: "groupAAAA1" });
    op(s, { type: "addGroup", groupId: "groupCCCC3", name: "C" });
    expect(state(s).groups.map((g) => g.id)).toEqual(["groupBBBB2", "groupCCCC3"]);
  });
});

describe("applyBoardOp: groups in hybrid sorts", () => {
  it("STU-04 / PERM-03 / PERM-04: own groups can be added, renamed, deleted; predefined cannot", () => {
    const s = hybridSetup();
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "Mine" });
    op(s, { type: "renameGroup", groupId: "groupAAAA1", name: "Mine!" });
    expect(state(s).groups.map((g) => g.name)).toEqual(["Fruit", "Veg", "Mine!"]);
    expectRejected(s, { type: "renameGroup", groupId: s.groupIds[0], name: "X" }, "forbidden");
    expectRejected(s, { type: "deleteGroup", groupId: s.groupIds[0] }, "forbidden");
    op(s, { type: "deleteGroup", groupId: "groupAAAA1" });
    expect(state(s).groups.map((g) => g.name)).toEqual(["Fruit", "Veg"]);
  });

  it("STU-06: maxParticipantGroups counts only participant groups", () => {
    const s = hybridSetup({ maxParticipantGroups: 1 });
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "Mine" });
    expectRejected(s, { type: "addGroup", groupId: "groupBBBB2", name: "More" }, "forbidden");
  });
});

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

describe("applyBoardOp: participant cards", () => {
  it("PERM-01: card creation is rejected when participant cards are off", () => {
    const s = closedSetup();
    expectRejected(s, { type: "addCard", cardId: "newCard001", label: "Mine" }, "forbidden");
  });

  it("PERM-01: new cards start in the tray, are marked participant and stay on this board", () => {
    for (const s of [
      closedSetup({ settings: { allowParticipantCards: true, randomizeCardOrder: false } }),
      openFixedSetup({ settings: { allowParticipantCards: true, randomizeCardOrder: false } }),
      openUnboundedSetup({ settings: { allowParticipantCards: true, randomizeCardOrder: false } }),
      hybridSetup({ settings: { allowParticipantCards: true, randomizeCardOrder: false } }),
    ]) {
      op(s, { type: "addCard", cardId: "newCard001", label: " Mine ", description: "" });
      op(s, { type: "addCard", cardId: "newCard002", label: "Second", description: "Why" });
      const st = state(s);
      expect(st.unsortedCardIds).toEqual([...s.cardIds, "newCard001", "newCard002"]);
      expect(st.cards.slice(-2)).toEqual([
        { id: "newCard001", label: "Mine", description: null, origin: "participant" },
        { id: "newCard002", label: "Second", description: "Why", origin: "participant" },
      ]);
      const other = createBoard(s.db, s.study.slug, { name: "Bob" });
      expect(getBoardState(s.db, other.token).cards.map((c) => c.id)).toEqual(s.cardIds);
      const row = s.db.select().from(cards).where(eq(cards.id, "newCard001")).get();
      expect(row?.boardId).toBe(st.board.id);
    }
  });

  it("PERM-01: participant cards can be sorted like predefined ones", () => {
    const s = closedSetup({ settings: { allowParticipantCards: true } });
    op(s, { type: "addCard", cardId: "newCard001", label: "Mine" });
    op(s, { type: "moveCard", cardId: "newCard001", toGroupId: s.groupIds[1], toIndex: 0 });
    expect(groupOf(state(s), s.groupIds[1]).cardIds).toEqual(["newCard001"]);
  });

  it("PERM-01: addCard with an existing id is a conflict", () => {
    const s = closedSetup({ settings: { allowParticipantCards: true } });
    op(s, { type: "addCard", cardId: "newCard001", label: "Mine" });
    expectRejected(s, { type: "addCard", cardId: "newCard001", label: "Again" }, "conflict");
    expectRejected(s, { type: "addCard", cardId: s.cardIds[0], label: "Clash" }, "conflict");
  });

  it("PERM-01: at most LIMITS.maxParticipantCards cards per board", () => {
    const s = closedSetup({ settings: { allowParticipantCards: true } });
    const boardId = state(s).board.id;
    for (let i = 0; i < LIMITS.maxParticipantCards; i++) {
      makeCard(s.db, s.study.id, { boardId, label: `P${i}`, position: i });
    }
    expectRejected(s, { type: "addCard", cardId: "oneTooMany", label: "Over" }, "forbidden");
  });

  it("PERM-02: own cards can be edited and deleted (deleting re-indexes its group)", () => {
    const s = closedSetup({ settings: { allowParticipantCards: true } });
    op(s, { type: "addCard", cardId: "newCard001", label: "Mine" });
    op(s, { type: "editCard", cardId: "newCard001", label: "Edited", description: "Now with text" });
    expect(state(s).cards.find((c) => c.id === "newCard001")).toMatchObject({
      label: "Edited",
      description: "Now with text",
    });
    op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 });
    op(s, { type: "moveCard", cardId: "newCard001", toGroupId: s.groupIds[0], toIndex: 0 });
    op(s, { type: "moveCard", cardId: s.cardIds[1], toGroupId: s.groupIds[0], toIndex: 2 });
    op(s, { type: "deleteCard", cardId: "newCard001" });
    const st = state(s);
    expect(st.cards.map((c) => c.id)).toEqual(s.cardIds);
    expect(groupOf(st, s.groupIds[0]).cardIds).toEqual([s.cardIds[0], s.cardIds[1]]);
    const positions = s.db
      .select()
      .from(placements)
      .where(eq(placements.groupId, s.groupIds[0]))
      .all()
      .map((p) => p.position)
      .sort();
    expect(positions).toEqual([0, 1]);
  });

  it("PERM-02: predefined cards can never be edited or deleted", () => {
    const s = hybridSetup({ settings: { allowParticipantCards: true, allowEditOwnCards: true } });
    expectRejected(s, { type: "editCard", cardId: s.cardIds[0], label: "X" }, "forbidden");
    expectRejected(s, { type: "deleteCard", cardId: s.cardIds[0] }, "forbidden");
  });

  it("PERM-02: own cards cannot be edited or deleted when the setting is off", () => {
    const s = openUnboundedSetup({ settings: { allowParticipantCards: true, allowEditOwnCards: false } });
    op(s, { type: "addCard", cardId: "newCard001", label: "Mine" });
    expectRejected(s, { type: "editCard", cardId: "newCard001", label: "X" }, "forbidden");
    expectRejected(s, { type: "deleteCard", cardId: "newCard001" }, "forbidden");
  });

  it("SAVE-04: editing or deleting an unknown card is not_found", () => {
    const s = closedSetup({ settings: { allowParticipantCards: true } });
    expectRejected(s, { type: "editCard", cardId: "unknownCard", label: "X" }, "not_found");
    expectRejected(s, { type: "deleteCard", cardId: "unknownCard" }, "not_found");
    expectRejected(s, { type: "renameGroup", groupId: "unknownGroup", name: "X" }, "not_found");
    expectRejected(s, { type: "deleteGroup", groupId: "unknownGroup" }, "not_found");
  });
});

// ---------------------------------------------------------------------------
// completeBoard
// ---------------------------------------------------------------------------

describe("completeBoard", () => {
  it("DONE-04: completes and freezes the board; completion is idempotent", () => {
    const s = closedSetup();
    const first = completeBoard(s.db, s.token);
    expect(first.status).toBe("completed");
    const st = state(s);
    expect(st.board.status).toBe("completed");
    expect(st.board.completedAt).toBe(first.completedAt);
    expect(st.board.lastActivityAt).toBe(first.completedAt);
    expect(completeBoard(s.db, s.token)).toEqual(first);
    expectRejected(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: s.groupIds[0], toIndex: 0 }, "board_completed");
  });

  it("DONE-04: an already-completed board stays completed even after the study closes", () => {
    const s = closedSetup();
    const first = completeBoard(s.db, s.token);
    s.db.update(studies).set({ status: "closed" }).where(eq(studies.id, s.study.id)).run();
    expect(completeBoard(s.db, s.token)).toEqual(first);
  });

  it("DONE-05 / PERM-05: rejects completion with unsorted cards when all must be sorted (422)", () => {
    const s = closedSetup({ settings: { requireAllSorted: true } });
    for (const card of s.cardIds.slice(0, 3)) {
      op(s, { type: "moveCard", cardId: card, toGroupId: s.groupIds[0], toIndex: 0 });
    }
    const err = expectError(() => completeBoard(s.db, s.token), "unprocessable");
    expect(err.status).toBe(422);
    expect(err.details).toEqual([expect.objectContaining({ code: "unsorted_cards" })]);
    expect(state(s).board.status).toBe("in_progress");
    op(s, { type: "moveCard", cardId: s.cardIds[3], toGroupId: s.groupIds[1], toIndex: 0 });
    expect(completeBoard(s.db, s.token).status).toBe("completed");
  });

  it("DONE-05 / PERM-05: participant-created cards count as unsorted too", () => {
    const s = closedSetup({ settings: { requireAllSorted: true, allowParticipantCards: true } });
    for (const card of s.cardIds) op(s, { type: "moveCard", cardId: card, toGroupId: s.groupIds[0], toIndex: 0 });
    op(s, { type: "addCard", cardId: "newCard001", label: "Mine" });
    expectError(() => completeBoard(s.db, s.token), "unprocessable");
  });

  it("DONE-05: unsorted cards are fine when requireAllSorted is off", () => {
    const s = closedSetup({ settings: { requireAllSorted: false } });
    expect(completeBoard(s.db, s.token).status).toBe("completed");
  });

  it("DONE-05 / PERM-06: rejects non-empty unnamed participant groups in open sorts", () => {
    const s = openUnboundedSetup({ settings: { requireGroupNames: true } });
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "New group", withCardId: s.cardIds[0] });
    const err = expectError(() => completeBoard(s.db, s.token), "unprocessable");
    expect(err.details).toEqual([expect.objectContaining({ code: "unnamed_groups" })]);
    op(s, { type: "renameGroup", groupId: "groupAAAA1", name: "Fruit" });
    expect(completeBoard(s.db, s.token).status).toBe("completed");
  });

  it("DONE-05 / PERM-06: rejects non-empty placeholders still carrying their default name", () => {
    const s = openFixedSetup({ settings: { requireGroupNames: true } });
    const g = state(s).groups[0].id;
    op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: g, toIndex: 0 });
    expectError(() => completeBoard(s.db, s.token), "unprocessable");
    op(s, { type: "renameGroup", groupId: g, name: "Food" });
    expect(completeBoard(s.db, s.token).status).toBe("completed");
  });

  it("DONE-05 / PERM-06: unnamed groups are fine when names are not required", () => {
    const s = openUnboundedSetup({ settings: { requireGroupNames: false } });
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "", withCardId: s.cardIds[0] });
    expect(completeBoard(s.db, s.token).status).toBe("completed");
  });

  it("DONE-05 / PERM-07: rejects empty participant groups when empty groups are not allowed", () => {
    const s = hybridSetup({ settings: { allowEmptyGroups: false } });
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "Mine" });
    const err = expectError(() => completeBoard(s.db, s.token), "unprocessable");
    expect(err.details).toEqual([expect.objectContaining({ code: "empty_groups" })]);
    // Predefined groups may always be empty.
    op(s, { type: "moveCard", cardId: s.cardIds[0], toGroupId: "groupAAAA1", toIndex: 0 });
    expect(completeBoard(s.db, s.token).status).toBe("completed");
  });

  it("DONE-05 / PERM-07: empty placeholders block completion when empty groups are not allowed", () => {
    const s = openFixedSetup({ settings: { allowEmptyGroups: false } });
    expectError(() => completeBoard(s.db, s.token), "unprocessable");
  });

  it("DONE-05: reports every blocker at once", () => {
    const s = openUnboundedSetup({
      settings: { requireAllSorted: true, requireGroupNames: true, allowEmptyGroups: false },
    });
    op(s, { type: "addGroup", groupId: "groupAAAA1", name: "", withCardId: s.cardIds[0] });
    op(s, { type: "addGroup", groupId: "groupBBBB2", name: "Empty" });
    const err = expectError(() => completeBoard(s.db, s.token), "unprocessable");
    expect((err.details as { code: string }[]).map((b) => b.code)).toEqual([
      "unsorted_cards",
      "unnamed_groups",
      "empty_groups",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance", () => {
  it("NFR-03: a move on a board with 100 cards is saved in under 500 ms", () => {
    const db = createTestDb();
    const study = makeStudy(db, { sortType: "hybrid", settings: { randomizeCardOrder: true } });
    const cardIds = makeCards(
      db,
      study.id,
      Array.from({ length: 100 }, (_, i) => `Card ${i}`),
    ).map((c) => c.id);
    const groupIds = makeGroups(db, study.id, Array.from({ length: 10 }, (_, i) => `G${i}`)).map((g) => g.id);
    const { token } = createBoard(db, study.slug, { name: "Ann" });
    const s = { db, token };
    // Sort 90 cards so source and target groups are well populated.
    let revision = 0;
    for (let i = 0; i < 90; i++) {
      revision = applyBoardOp(db, token, {
        revision,
        op: { type: "moveCard", cardId: cardIds[i], toGroupId: groupIds[i % 10], toIndex: 0 },
      }).revision;
    }
    const started = performance.now();
    applyBoardOp(db, token, {
      revision,
      op: { type: "moveCard", cardId: cardIds[0], toGroupId: groupIds[5], toIndex: 3 },
    });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(500);
    expect(groupOf(state(s), groupIds[5]).cardIds[3]).toBe(cardIds[0]);
  });
});
