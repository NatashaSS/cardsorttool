import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CreateStudyInputSchema,
  DEFAULT_PARTICIPANT_FIELDS,
  DEFAULT_SETTINGS,
  type CreateStudyInput,
  type StudySettings,
} from "@/lib/schemas";
import { LIMITS } from "@/lib/types";
import type { DB } from "@/server/db/open";
import { boards, cards, groups, placements, studies } from "@/server/db/schema";
import { ServiceError } from "@/server/errors";
import {
  addCard,
  addGroup,
  bulkAddCards,
  createStudy,
  deleteCard,
  deleteGroup,
  deleteStudy,
  duplicateStudy,
  getStudy,
  listStudies,
  reorderCards,
  reorderGroups,
  setStudyStatus,
  updateCard,
  updateGroup,
  updateStudy,
} from "@/server/services/studies";
import { createTestDb } from "../helpers/db";
import {
  makeBoard,
  makeCard,
  makeCards,
  makeGroup,
  makeGroups,
  makeStudy,
  place,
} from "../helpers/factories";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

const create = (input: Partial<CreateStudyInput> = {}) =>
  createStudy(
    db,
    CreateStudyInputSchema.parse({ title: "My study", sortType: "closed", ...input }),
  );

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe(code);
    return err as ServiceError;
  }
  throw new Error(`expected ServiceError ${code}`);
}

describe("studies: CRUD", () => {
  it("STU-01 / STU-02: creates a draft study with defaults and reads it back", () => {
    const s = create({ title: "  IA study  ", description: "notes", instructions: "Sort these" });
    expect(s.status).toBe("draft");
    expect(s.title).toBe("IA study");
    expect(s.description).toBe("notes");
    expect(s.instructions).toBe("Sort these");
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(s.participantFields).toEqual(DEFAULT_PARTICIPANT_FIELDS);
    expect(s.cards).toEqual([]);
    expect(s.groups).toEqual([]);
    expect(s.boardCounts).toEqual({ inProgress: 0, completed: 0 });
    expect(getStudy(db, s.id)).toEqual(s);
  });

  it("STU-11: share link uses an unguessable slug, not the internal id", () => {
    const s = create();
    expect(s.slug).toMatch(/^[a-z0-9]{12}$/);
    expect(s.slug).not.toBe(s.id);
    expect(s.shareUrl).toMatch(new RegExp(`/s/${s.slug}$`));
    expect(s.shareUrl).not.toContain(s.id);
    expect(create().slug).not.toBe(s.slug);
  });

  it("STU-01: lists studies with type, status, board counts and dates, newest first", () => {
    const a = makeStudy(db, {
      title: "A",
      createdAt: "2026-01-01T00:00:00.000Z",
      sortType: "open",
    });
    const b = makeStudy(db, { title: "B", createdAt: "2026-02-01T00:00:00.000Z" });
    makeBoard(db, a.id);
    makeBoard(db, a.id);
    makeBoard(db, a.id, { status: "completed", completedAt: "2026-01-02T00:00:00.000Z" });
    const list = listStudies(db);
    expect(list.map((s) => s.title)).toEqual(["B", "A"]);
    expect(list[1]).toMatchObject({
      id: a.id,
      sortType: "open",
      status: "live",
      createdAt: a.createdAt,
      boardCounts: { inProgress: 2, completed: 1 },
    });
    expect(list[0].boardCounts).toEqual({ inProgress: 0, completed: 0 });
    expect(getStudy(db, a.id).boardCounts).toEqual({ inProgress: 2, completed: 1 });
    expect(b.id).toBe(list[0].id);
  });

  it("STU-01: getStudy of an unknown id is not_found", () => {
    expectCode(() => getStudy(db, "nope-nope-nope"), "not_found");
  });

  it("STU-01: deleting a study removes its boards, cards, groups and placements", () => {
    const s = makeStudy(db);
    const [card] = makeCards(db, s.id, ["Apples"]);
    const [group] = makeGroups(db, s.id, ["Fruit"]);
    const board = makeBoard(db, s.id);
    place(db, board.id, card.id, group.id);
    const other = makeStudy(db);
    makeCards(db, other.id, ["Other"]);
    deleteStudy(db, s.id);
    expect(
      db
        .select()
        .from(studies)
        .all()
        .map((r) => r.id),
    ).toEqual([other.id]);
    expect(db.select().from(boards).all()).toHaveLength(0);
    expect(db.select().from(placements).all()).toHaveLength(0);
    expect(db.select().from(groups).all()).toHaveLength(0);
    expect(db.select().from(cards).all()).toHaveLength(1);
    expectCode(() => deleteStudy(db, s.id), "not_found");
  });

  it("STU-02: title, description and instructions can be edited", () => {
    const s = create();
    const u = updateStudy(db, s.id, { title: "New", description: "d", instructions: "i" });
    expect(u).toMatchObject({ title: "New", description: "d", instructions: "i" });
    expect(u.updatedAt >= s.updatedAt).toBe(true);
  });
});

describe("studies: sort type and group mode", () => {
  it("STU-04: stores the chosen sort type", () => {
    expect(create({ sortType: "open" }).sortType).toBe("open");
    expect(create({ sortType: "closed" }).sortType).toBe("closed");
    expect(create({ sortType: "hybrid" }).sortType).toBe("hybrid");
  });

  it("STU-05: open sorts can use a fixed number of groups (1..30)", () => {
    const s = create({ sortType: "open", groupMode: "fixed", fixedGroupCount: 5 });
    expect(s).toMatchObject({ groupMode: "fixed", fixedGroupCount: 5, maxParticipantGroups: null });
    expectCode(() => create({ sortType: "open", groupMode: "fixed" }), "unprocessable");
    expectCode(() => updateStudy(db, s.id, { fixedGroupCount: 31 }), "unprocessable");
    expectCode(() => updateStudy(db, s.id, { fixedGroupCount: null }), "unprocessable");
    expect(updateStudy(db, s.id, { fixedGroupCount: 30 }).fixedGroupCount).toBe(30);
  });

  it("STU-05: fixed group mode is rejected for closed and hybrid sorts", () => {
    expectCode(
      () => create({ sortType: "closed", groupMode: "fixed", fixedGroupCount: 3 }),
      "unprocessable",
    );
    const h = create({ sortType: "hybrid" });
    expectCode(
      () => updateStudy(db, h.id, { groupMode: "fixed", fixedGroupCount: 3 }),
      "unprocessable",
    );
  });

  it("STU-05: closed/hybrid store unbounded mode and no fixed count", () => {
    const s = create({ sortType: "closed", fixedGroupCount: 4 });
    expect(s).toMatchObject({ groupMode: "unbounded", fixedGroupCount: null });
    const o = create({ sortType: "open", groupMode: "fixed", fixedGroupCount: 4 });
    const c = updateStudy(db, o.id, { sortType: "hybrid" });
    expect(c).toMatchObject({ sortType: "hybrid", groupMode: "unbounded", fixedGroupCount: null });
    const u = updateStudy(
      db,
      create({ sortType: "open", groupMode: "fixed", fixedGroupCount: 2 }).id,
      {
        groupMode: "unbounded",
      },
    );
    expect(u).toMatchObject({ groupMode: "unbounded", fixedGroupCount: null });
  });

  it("STU-06: max participant groups is kept for open-unbounded and hybrid, cleared otherwise", () => {
    const o = create({ sortType: "open" });
    expect(updateStudy(db, o.id, { maxParticipantGroups: 8 }).maxParticipantGroups).toBe(8);
    const h = create({ sortType: "hybrid" });
    expect(updateStudy(db, h.id, { maxParticipantGroups: 3 }).maxParticipantGroups).toBe(3);
    expect(updateStudy(db, h.id, { maxParticipantGroups: null }).maxParticipantGroups).toBeNull();
    const c = create({ sortType: "closed" });
    expect(updateStudy(db, c.id, { maxParticipantGroups: 5 }).maxParticipantGroups).toBeNull();
    const f = updateStudy(db, o.id, { groupMode: "fixed", fixedGroupCount: 3 });
    expect(f.maxParticipantGroups).toBeNull();
    expectCode(() => updateStudy(db, h.id, { maxParticipantGroups: 0 }), "unprocessable");
  });

  it("STU-04: switching to an open sort is rejected while predefined groups exist", () => {
    const s = create({ sortType: "hybrid" });
    const g = addGroup(db, s.id, { name: "Fruit" });
    const err = expectCode(() => updateStudy(db, s.id, { sortType: "open" }), "unprocessable");
    expect(err.message).toMatch(/predefined groups/);
    expect(getStudy(db, s.id).sortType).toBe("hybrid");
    deleteGroup(db, s.id, g.id);
    expect(updateStudy(db, s.id, { sortType: "open" }).sortType).toBe("open");
  });
});

describe("studies: settings and participant fields", () => {
  it("PERM-01..09: settings are persisted as a whole", () => {
    const s = create({ sortType: "open" });
    const settings = {
      allowParticipantCards: true,
      allowEditOwnCards: false,
      allowRenameGroups: false,
      allowDeleteGroups: false,
      requireAllSorted: true,
      requireGroupNames: false,
      allowEmptyGroups: false,
      randomizeCardOrder: false,
      showCardDescriptions: false,
    };
    expect(updateStudy(db, s.id, { settings }).settings).toEqual(settings);
    expect(getStudy(db, s.id).settings).toEqual(settings);
  });

  it("PERM-01: invalid settings are rejected by the service", () => {
    const s = create();
    // Deliberately invalid input, as a caller bypassing the route's zod parsing might send.
    const settings = {
      ...DEFAULT_SETTINGS,
      allowParticipantCards: "yes",
    } as unknown as StudySettings;
    expectCode(() => updateStudy(db, s.id, { settings }), "bad_request");
  });

  it("PFLD-01 / PFLD-03 / PFLD-04: participant fields are persisted in order, incl. custom questions", () => {
    const s = create();
    const fields = [
      { key: "custom_team" as const, label: "Which team are you on?", mode: "optional" as const },
      { key: "email" as const, mode: "required" as const },
      { key: "name" as const, mode: "optional" as const },
    ];
    expect(updateStudy(db, s.id, { participantFields: fields }).participantFields).toEqual(fields);
    const reordered = [fields[2], fields[0], fields[1]];
    expect(updateStudy(db, s.id, { participantFields: reordered }).participantFields).toEqual(
      reordered,
    );
    expect(updateStudy(db, s.id, { participantFields: [] }).participantFields).toEqual([]);
  });

  it("PFLD-01: duplicate or unknown participant fields are rejected", () => {
    const s = create();
    expectCode(
      () =>
        updateStudy(db, s.id, {
          participantFields: [
            { key: "name", mode: "required" },
            { key: "name", mode: "optional" },
          ],
        }),
      "bad_request",
    );
    expectCode(
      // @ts-expect-error -- deliberately invalid key
      () => updateStudy(db, s.id, { participantFields: [{ key: "shoeSize", mode: "required" }] }),
      "bad_request",
    );
  });
});

describe("studies: draft-only lock", () => {
  function liveStudy() {
    const s = create({ sortType: "hybrid" });
    const card = addCard(db, s.id, { label: "Apples", description: null });
    const group = addGroup(db, s.id, { name: "Fruit" });
    setStudyStatus(db, s.id, "live");
    return { s, card, group };
  }

  it("STU-03: rejects sort type, settings and participant field changes on a live study", () => {
    const { s } = liveStudy();
    expectCode(() => updateStudy(db, s.id, { sortType: "closed" }), "study_locked");
    expectCode(() => updateStudy(db, s.id, { maxParticipantGroups: 4 }), "study_locked");
    expectCode(
      () =>
        updateStudy(db, s.id, { settings: { ...DEFAULT_SETTINGS, allowParticipantCards: true } }),
      "study_locked",
    );
    expectCode(
      () => updateStudy(db, s.id, { participantFields: [{ key: "email", mode: "required" }] }),
      "study_locked",
    );
    // nothing changed, not even the title sent with a locked field
    expectCode(() => updateStudy(db, s.id, { title: "X", sortType: "open" }), "study_locked");
    expect(getStudy(db, s.id)).toMatchObject({ title: "My study", sortType: "hybrid" });
  });

  it("STU-03: title, description and instructions stay editable on live and closed studies", () => {
    const { s } = liveStudy();
    expect(updateStudy(db, s.id, { title: "Live title", instructions: "New" }).title).toBe(
      "Live title",
    );
    setStudyStatus(db, s.id, "closed");
    expect(updateStudy(db, s.id, { description: "closed notes" }).description).toBe("closed notes");
  });

  it("STU-03: resubmitting unchanged locked values is accepted (whole-form save)", () => {
    const { s } = liveStudy();
    const cur = getStudy(db, s.id);
    const u = updateStudy(db, s.id, {
      title: "Renamed",
      sortType: cur.sortType,
      groupMode: cur.groupMode,
      fixedGroupCount: cur.fixedGroupCount,
      maxParticipantGroups: cur.maxParticipantGroups,
      settings: cur.settings,
      participantFields: cur.participantFields,
    });
    expect(u.title).toBe("Renamed");
  });

  it("STU-03: rejects card edits on a live study", () => {
    const { s, card } = liveStudy();
    expectCode(() => addCard(db, s.id, { label: "Pears", description: null }), "study_locked");
    expectCode(
      () => updateCard(db, s.id, card.id, { label: "Pears", description: null }),
      "study_locked",
    );
    expectCode(() => deleteCard(db, s.id, card.id), "study_locked");
    expectCode(() => reorderCards(db, s.id, [card.id]), "study_locked");
    expectCode(() => bulkAddCards(db, s.id, "Pears"), "study_locked");
    expect(getStudy(db, s.id).cards.map((c) => c.label)).toEqual(["Apples"]);
  });

  it("STU-03: rejects group edits on a closed study", () => {
    const { s, group } = liveStudy();
    setStudyStatus(db, s.id, "closed");
    expectCode(() => addGroup(db, s.id, { name: "Veg" }), "study_locked");
    expectCode(() => updateGroup(db, s.id, group.id, { name: "Veg" }), "study_locked");
    expectCode(() => deleteGroup(db, s.id, group.id), "study_locked");
    expectCode(() => reorderGroups(db, s.id, [group.id]), "study_locked");
  });
});

describe("studies: status transitions", () => {
  it("STU-03: allows draft → live → closed → live", () => {
    const s = create();
    addCard(db, s.id, { label: "A", description: null });
    addGroup(db, s.id, { name: "G" });
    expect(setStudyStatus(db, s.id, "live").status).toBe("live");
    expect(setStudyStatus(db, s.id, "closed").status).toBe("closed");
    expect(setStudyStatus(db, s.id, "live").status).toBe("live");
  });

  it("STU-03: rejects other transitions with unprocessable", () => {
    const s = create();
    expectCode(() => setStudyStatus(db, s.id, "closed"), "unprocessable");
    expectCode(() => setStudyStatus(db, s.id, "draft"), "unprocessable");
    const live = makeStudy(db, { status: "live" });
    expectCode(() => setStudyStatus(db, live.id, "draft"), "unprocessable");
    expectCode(() => setStudyStatus(db, live.id, "live"), "unprocessable");
    expectCode(() => setStudyStatus(db, "missing-study-id", "live"), "not_found");
  });

  it("STU-10: a study cannot go live with zero cards", () => {
    const s = create({ sortType: "open" });
    const err = expectCode(() => setStudyStatus(db, s.id, "live"), "unprocessable");
    expect(err.message).toMatch(/at least one card/);
    expect(getStudy(db, s.id).status).toBe("draft");
    addCard(db, s.id, { label: "A", description: null });
    expect(setStudyStatus(db, s.id, "live").status).toBe("live");
  });

  it("STU-09: closed and hybrid studies cannot go live with zero groups", () => {
    for (const sortType of ["closed", "hybrid"] as const) {
      const s = create({ sortType });
      addCard(db, s.id, { label: "A", description: null });
      const err = expectCode(() => setStudyStatus(db, s.id, "live"), "unprocessable");
      expect(err.message).toMatch(/at least one group/);
      addGroup(db, s.id, { name: "G" });
      expect(setStudyStatus(db, s.id, "live").status).toBe("live");
    }
  });

  it("STU-09 / STU-10: reports both problems at once", () => {
    const s = create();
    const err = expectCode(() => setStudyStatus(db, s.id, "live"), "unprocessable");
    expect(err.details).toEqual({
      problems: [expect.stringMatching(/card/), expect.stringMatching(/group/)],
    });
  });
});

describe("studies: predefined cards", () => {
  it("STU-07: adds, edits and removes cards with contiguous positions", () => {
    const s = create();
    const a = addCard(db, s.id, { label: " Apples ", description: " Red fruit " });
    const b = addCard(db, s.id, { label: "Bananas", description: "" });
    const c = addCard(db, s.id, { label: "Cherries", description: null });
    expect(a).toMatchObject({ label: "Apples", description: "Red fruit", position: 0 });
    expect(b).toMatchObject({ description: null, position: 1 });
    expect(c.position).toBe(2);
    expect(updateCard(db, s.id, b.id, { label: "Blueberries", description: "Blue" })).toMatchObject(
      {
        id: b.id,
        label: "Blueberries",
        description: "Blue",
        position: 1,
      },
    );
    deleteCard(db, s.id, a.id);
    expect(getStudy(db, s.id).cards).toEqual([
      { id: b.id, label: "Blueberries", description: "Blue", position: 0, imageUrl: null },
      { id: c.id, label: "Cherries", description: null, position: 1, imageUrl: null },
    ]);
  });

  it("STU-07: labels are unique within a study, case-insensitive", () => {
    const s = create();
    const a = addCard(db, s.id, { label: "Apples", description: null });
    const b = addCard(db, s.id, { label: "Pears", description: null });
    expectCode(() => addCard(db, s.id, { label: "APPLES", description: null }), "conflict");
    expectCode(
      () => updateCard(db, s.id, b.id, { label: "apples ", description: null }),
      "conflict",
    );
    // re-saving a card with its own label (different case) is fine
    expect(updateCard(db, s.id, a.id, { label: "apples", description: null }).label).toBe("apples");
    // the same label in another study is fine
    expect(addCard(db, create().id, { label: "Apples", description: null }).label).toBe("Apples");
  });

  it("STU-07: participant-created cards are not managed (or counted) here", () => {
    const s = create();
    const board = makeBoard(db, s.id);
    const pc = makeCard(db, s.id, { boardId: board.id, label: "Apples" });
    expect(addCard(db, s.id, { label: "Apples", description: null }).position).toBe(0);
    expect(getStudy(db, s.id).cards).toHaveLength(1);
    expectCode(() => updateCard(db, s.id, pc.id, { label: "X", description: null }), "not_found");
    expectCode(() => deleteCard(db, s.id, pc.id), "not_found");
  });

  it("STU-07: cards of another study are not found", () => {
    const s = create();
    const other = create();
    const card = addCard(db, other.id, { label: "Theirs", description: null });
    expectCode(
      () => updateCard(db, s.id, card.id, { label: "Mine", description: null }),
      "not_found",
    );
    expectCode(() => deleteCard(db, s.id, card.id), "not_found");
  });

  it("STU-07: validates label and description length", () => {
    const s = create();
    expectCode(() => addCard(db, s.id, { label: "   ", description: null }), "bad_request");
    expectCode(
      () => addCard(db, s.id, { label: "x".repeat(201), description: null }),
      "bad_request",
    );
    expectCode(
      () => addCard(db, s.id, { label: "ok", description: "x".repeat(1001) }),
      "bad_request",
    );
  });

  it("STU-07: reorders cards; ids must be exactly the study's cards", () => {
    const s = create();
    const [a, b, c] = ["A", "B", "C"].map((label) =>
      addCard(db, s.id, { label, description: null }),
    );
    expect(reorderCards(db, s.id, [c.id, a.id, b.id]).map((x) => [x.label, x.position])).toEqual([
      ["C", 0],
      ["A", 1],
      ["B", 2],
    ]);
    expectCode(() => reorderCards(db, s.id, [a.id, b.id]), "bad_request");
    expectCode(() => reorderCards(db, s.id, [a.id, b.id, b.id]), "bad_request");
    expectCode(() => reorderCards(db, s.id, [a.id, b.id, c.id, "someone-elses"]), "bad_request");
    expectCode(() => reorderCards(db, s.id, [a.id, b.id, "someone-elses"]), "bad_request");
    expect(getStudy(db, s.id).cards.map((x) => x.label)).toEqual(["C", "A", "B"]);
  });

  it("STU-07: enforces the maximum number of cards", () => {
    const s = create();
    bulkAddCards(
      db,
      s.id,
      Array.from({ length: LIMITS.maxCards }, (_, i) => `Card ${i}`).join("\n"),
    );
    expectCode(
      () => addCard(db, s.id, { label: "One too many", description: null }),
      "unprocessable",
    );
  });
});

describe("studies: bulk add", () => {
  it("STU-08: one card per line; blank lines ignored; duplicates reported and skipped", () => {
    const s = create();
    addCard(db, s.id, { label: "Apples", description: null });
    const res = bulkAddCards(db, s.id, "Bananas\r\n\n   \n  Cherries  \napples\nBANANAS\nDates\n");
    expect(res.added.map((c) => [c.label, c.position])).toEqual([
      ["Bananas", 1],
      ["Cherries", 2],
      ["Dates", 3],
    ]);
    expect(res.skipped).toEqual(["apples", "BANANAS"]);
    expect(getStudy(db, s.id).cards.map((c) => c.label)).toEqual([
      "Apples",
      "Bananas",
      "Cherries",
      "Dates",
    ]);
  });

  it("STU-08: empty paste adds nothing", () => {
    const s = create();
    expect(bulkAddCards(db, s.id, "\n \n")).toEqual({ added: [], skipped: [] });
  });

  it("STU-08: rejects the whole paste if it would exceed the card limit or a line is too long", () => {
    const s = create();
    const lines = Array.from({ length: LIMITS.maxCards + 1 }, (_, i) => `Card ${i}`).join("\n");
    expectCode(() => bulkAddCards(db, s.id, lines), "unprocessable");
    expectCode(() => bulkAddCards(db, s.id, `ok\n${"x".repeat(201)}`), "bad_request");
    expect(getStudy(db, s.id).cards).toHaveLength(0);
  });
});

describe("studies: predefined groups", () => {
  it("STU-09: adds, renames and removes groups with contiguous positions", () => {
    const s = create({ sortType: "closed" });
    const [a, b, c] = ["Fruit", "Veg", "Dairy"].map((name) => addGroup(db, s.id, { name }));
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
    expect(updateGroup(db, s.id, b.id, { name: " Vegetables " })).toEqual({
      id: b.id,
      name: "Vegetables",
      position: 1,
    });
    deleteGroup(db, s.id, a.id);
    expect(getStudy(db, s.id).groups).toEqual([
      { id: b.id, name: "Vegetables", position: 0 },
      { id: c.id, name: "Dairy", position: 1 },
    ]);
  });

  it("STU-09: group names are required, ≤ 100 chars and unique (case-insensitive)", () => {
    const s = create({ sortType: "hybrid" });
    const a = addGroup(db, s.id, { name: "Fruit" });
    const b = addGroup(db, s.id, { name: "Veg" });
    expectCode(() => addGroup(db, s.id, { name: "fruit" }), "conflict");
    expectCode(() => updateGroup(db, s.id, b.id, { name: "FRUIT" }), "conflict");
    expect(updateGroup(db, s.id, a.id, { name: "FRUIT" }).name).toBe("FRUIT");
    expectCode(() => addGroup(db, s.id, { name: "  " }), "bad_request");
    expectCode(() => addGroup(db, s.id, { name: "x".repeat(101) }), "bad_request");
  });

  it("STU-09: open sorts have no predefined groups", () => {
    const s = create({ sortType: "open" });
    expectCode(() => addGroup(db, s.id, { name: "Fruit" }), "unprocessable");
    expectCode(() => reorderGroups(db, s.id, []), "unprocessable");
  });

  it("STU-09: enforces the maximum number of predefined groups", () => {
    const s = create();
    for (let i = 0; i < LIMITS.maxPredefinedGroups; i++) addGroup(db, s.id, { name: `G${i}` });
    expectCode(() => addGroup(db, s.id, { name: "One too many" }), "unprocessable");
  });

  it("STU-09: reorders groups; ids must be exactly the study's predefined groups", () => {
    const s = create();
    const [a, b] = ["A", "B"].map((name) => addGroup(db, s.id, { name }));
    const board = makeBoard(db, s.id);
    const own = makeGroup(db, s.id, { boardId: board.id, kind: "participant", name: "Mine" });
    expect(reorderGroups(db, s.id, [b.id, a.id]).map((g) => g.name)).toEqual(["B", "A"]);
    expectCode(() => reorderGroups(db, s.id, [b.id, a.id, own.id]), "bad_request");
    expectCode(() => reorderGroups(db, s.id, [a.id]), "bad_request");
    expectCode(() => updateGroup(db, s.id, own.id, { name: "X" }), "not_found");
    expectCode(() => deleteGroup(db, s.id, own.id), "not_found");
    expect(getStudy(db, s.id).groups.map((g) => g.name)).toEqual(["B", "A"]);
  });
});

describe("studies: duplicate", () => {
  it("STU-12: copies settings, fields, cards and groups into a new draft without boards", () => {
    const s = create({ sortType: "hybrid", title: "Original" });
    updateStudy(db, s.id, {
      description: "notes",
      instructions: "Do it",
      maxParticipantGroups: 5,
      settings: { ...DEFAULT_SETTINGS, allowParticipantCards: true, randomizeCardOrder: false },
      participantFields: [
        { key: "email", mode: "required" },
        { key: "custom_q", label: "Q?", mode: "optional" },
      ],
    });
    addCard(db, s.id, { label: "A", description: "desc" });
    addCard(db, s.id, { label: "B", description: null });
    addGroup(db, s.id, { name: "G1" });
    addGroup(db, s.id, { name: "G2" });
    setStudyStatus(db, s.id, "live");
    const board = makeBoard(db, s.id);
    makeCard(db, s.id, { boardId: board.id, label: "Participant card" });
    makeGroup(db, s.id, { boardId: board.id, kind: "participant", name: "Participant group" });

    const orig = getStudy(db, s.id);
    const copy = duplicateStudy(db, s.id);
    expect(copy.id).not.toBe(orig.id);
    expect(copy.slug).not.toBe(orig.slug);
    expect(copy.title).toBe("Copy of Original");
    expect(copy.status).toBe("draft");
    expect(copy.boardCounts).toEqual({ inProgress: 0, completed: 0 });
    for (const key of [
      "description",
      "instructions",
      "sortType",
      "groupMode",
      "fixedGroupCount",
      "maxParticipantGroups",
      "settings",
      "participantFields",
    ] as const) {
      expect(copy[key]).toEqual(orig[key]);
    }
    const strip = <T extends { id: string }>(xs: T[]) => xs.map((x) => ({ ...x, id: undefined }));
    expect(strip(copy.cards)).toEqual(strip(orig.cards));
    expect(strip(copy.groups)).toEqual(strip(orig.groups));
    expect(copy.cards.map((c) => c.id)).not.toContain(orig.cards[0].id);
    expect(db.select().from(boards).where(eq(boards.studyId, copy.id)).all()).toHaveLength(0);
    // copy is independently editable
    expect(addCard(db, copy.id, { label: "C", description: null }).position).toBe(2);
    expect(getStudy(db, s.id).cards).toHaveLength(2);
  });

  it("STU-12: duplicate title stays within the length limit", () => {
    const s = create({ title: "x".repeat(LIMITS.studyTitle) });
    expect(duplicateStudy(db, s.id).title).toHaveLength(LIMITS.studyTitle);
    expectCode(() => duplicateStudy(db, "missing-study-id"), "not_found");
  });
});
