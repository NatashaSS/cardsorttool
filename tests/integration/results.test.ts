import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/open";
import { boards, cards, groups, placements } from "@/server/db/schema";
import { ServiceError } from "@/server/errors";
import { deleteBoard, getBoardSummary, listBoards, setBoardExcluded } from "@/server/services/results";
import {
  CSV_BOM,
  csvCell,
  csvFilename,
  participantsCsv,
  placementsCsv,
  toCsv,
} from "@/server/services/export";
import { createTestDb } from "../helpers/db";
import { makeBoard, makeCard, makeCards, makeGroup, makeGroups, makeStudy, place } from "../helpers/factories";

let db: DB;

beforeEach(() => {
  db = createTestDb();
});

const expectNotFound = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("not_found");
    return;
  }
  throw new Error("expected not_found");
};

/** Minimal RFC 4180 parser for assertions (handles quotes, CRLF). */
function parseCsv(text: string): string[][] {
  expect(text.startsWith(CSV_BOM)).toBe(true);
  const body = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && body[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  expect(cell).toBe("");
  expect(row).toEqual([]);
  return rows;
}

const asObjects = (rows: string[][]) =>
  rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])));

/** A closed study with 3 cards, 2 groups and two boards. */
function seed() {
  const study = makeStudy(db, {
    title: "Intranet: Navigation & Search!",
    participantFields: [
      { key: "name", mode: "required" },
      { key: "country", mode: "optional" },
      { key: "gender", mode: "optional" },
      { key: "custom_team", label: "Team", mode: "optional" },
    ],
  });
  const [billing, profile, security] = makeCards(db, study.id, ["Billing", "Profile", "Security"]);
  const [account, money] = makeGroups(db, study.id, ["Account", "Money"]);
  const older = makeBoard(db, study.id, {
    participant: { name: "Ada", country: "GB", gender: "self_describe", genderSelfDescribe: "Agender", custom_team: "Ops" },
    startedAt: "2026-01-01T10:00:00.000Z",
    lastActivityAt: "2026-01-01T10:30:00.000Z",
    status: "completed",
    completedAt: "2026-01-01T10:30:00.000Z",
  });
  const newer = makeBoard(db, study.id, {
    participant: { name: "Bob" },
    startedAt: "2026-01-02T10:00:00.000Z",
    lastActivityAt: "2026-01-03T09:00:00.000Z",
  });
  // older: all sorted, plus a participant group and card.
  const ownGroup = makeGroup(db, study.id, { boardId: older.id, kind: "participant", name: "Mine", position: 0 });
  const ownCard = makeCard(db, study.id, { boardId: older.id, label: "My idea" });
  place(db, older.id, profile.id, account.id, 0);
  place(db, older.id, security.id, account.id, 1);
  place(db, older.id, billing.id, money.id, 0);
  place(db, older.id, ownCard.id, ownGroup.id, 0);
  // newer: one card sorted.
  place(db, newer.id, billing.id, money.id, 5);
  return { study, billing, profile, security, account, money, older, newer, ownGroup, ownCard };
}

describe("listBoards", () => {
  it("RES-01: lists boards with sorted/total counts, newest activity first", () => {
    const { study, older, newer } = seed();
    const list = listBoards(db, study.id);
    expect(list.map((b) => b.id)).toEqual([newer.id, older.id]);
    expect(list[0]).toEqual({
      id: newer.id,
      status: "in_progress",
      participant: { name: "Bob" },
      startedAt: "2026-01-02T10:00:00.000Z",
      lastActivityAt: "2026-01-03T09:00:00.000Z",
      completedAt: null,
      excluded: false,
      sortedCount: 1,
      totalCount: 3,
    });
    expect(list[1]).toMatchObject({ status: "completed", sortedCount: 4, totalCount: 4 });
  });

  it("RES-01: only boards of the requested study; unknown study → not_found", () => {
    const { study } = seed();
    const other = makeStudy(db);
    makeCards(db, other.id, ["X"]);
    const otherBoard = makeBoard(db, other.id);
    expect(listBoards(db, other.id).map((b) => b.id)).toEqual([otherBoard.id]);
    expect(listBoards(db, study.id)).toHaveLength(2);
    expectNotFound(() => listBoards(db, "nope-nope-nope"));
  });

  it("RES-01: empty study returns []", () => {
    const study = makeStudy(db);
    expect(listBoards(db, study.id)).toEqual([]);
  });

  it("RES-01: scales to 1 000 boards with aggregate queries", () => {
    const study = makeStudy(db);
    const [card] = makeCards(db, study.id, ["A", "B"]);
    const [group] = makeGroups(db, study.id, ["G"]);
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        const b = makeBoard(db, study.id, { lastActivityAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
        if (i % 2 === 0) place(db, b.id, card.id, group.id);
      }
    });
    const started = performance.now();
    const list = listBoards(db, study.id);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(list).toHaveLength(1000);
    expect(list.filter((b) => b.sortedCount === 1)).toHaveLength(500);
    expect(list.every((b) => b.totalCount === 2)).toBe(true);
    expect(list[0].lastActivityAt > list[999].lastActivityAt).toBe(true);
  });

  it("RES-02: getBoardSummary checks the board belongs to the study", () => {
    const { study, older } = seed();
    const other = makeStudy(db);
    expect(getBoardSummary(db, study.id, older.id)).toMatchObject({ id: older.id, sortedCount: 4, totalCount: 4 });
    expectNotFound(() => getBoardSummary(db, other.id, older.id));
    expectNotFound(() => getBoardSummary(db, study.id, "missing-board"));
  });
});

describe("setBoardExcluded / deleteBoard", () => {
  it("RES-03: excludes and re-includes a board", () => {
    const { study, older } = seed();
    setBoardExcluded(db, study.id, older.id, true);
    expect(listBoards(db, study.id).find((b) => b.id === older.id)?.excluded).toBe(true);
    setBoardExcluded(db, study.id, older.id, false);
    expect(listBoards(db, study.id).find((b) => b.id === older.id)?.excluded).toBe(false);
  });

  it("RES-03 RES-04: a board id of another study → not_found and nothing changes", () => {
    const { older } = seed();
    const other = makeStudy(db);
    expectNotFound(() => setBoardExcluded(db, other.id, older.id, true));
    expectNotFound(() => deleteBoard(db, other.id, older.id));
    const row = db.select().from(boards).where(eq(boards.id, older.id)).get();
    expect(row?.excluded).toBe(false);
  });

  it("RES-04: deleting a board cascades to placements and participant cards/groups", () => {
    const { study, older, newer, ownCard, ownGroup, billing } = seed();
    deleteBoard(db, study.id, older.id);
    expect(listBoards(db, study.id).map((b) => b.id)).toEqual([newer.id]);
    expect(db.select().from(placements).where(eq(placements.boardId, older.id)).all()).toEqual([]);
    expect(db.select().from(cards).where(eq(cards.id, ownCard.id)).get()).toBeUndefined();
    expect(db.select().from(groups).where(eq(groups.id, ownGroup.id)).get()).toBeUndefined();
    // Predefined data and the other board are untouched.
    expect(db.select().from(cards).where(eq(cards.id, billing.id)).get()).toBeDefined();
    expect(db.select().from(placements).where(eq(placements.boardId, newer.id)).all()).toHaveLength(1);
    expectNotFound(() => deleteBoard(db, study.id, older.id));
  });
});

describe("CSV encoding", () => {
  it("RES-05: RFC 4180 quoting", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(true)).toBe("true");
  });

  it("NFR-05 RES-05: neutralises formula injection", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe("\"'\rx\"");
    expect(csvCell('=HYPERLINK("http://x","a,b")')).toBe('"\'=HYPERLINK(""http://x"",""a,b"")"');
    expect(csvCell("a=b")).toBe("a=b");
  });

  it("RES-05: BOM and CRLF line endings", () => {
    expect(toCsv([["a", "b"], ["1", "2"]])).toBe("﻿a,b\r\n1,2\r\n");
  });
});

describe("placementsCsv", () => {
  it("RES-05: one row per board × card with groups, origins and positions", () => {
    const { study } = seed();
    const rows = parseCsv(placementsCsv(db, study.id));
    expect(rows[0]).toEqual([
      "board_id",
      "status",
      "excluded",
      "started_at",
      "last_activity_at",
      "completed_at",
      "Name",
      "Country of residence",
      "Gender",
      "Gender (self-described)",
      "Team",
      "card_label",
      "card_origin",
      "group_name",
      "group_origin",
      "position",
    ]);
    const data = asObjects(rows);
    // 4 cards on the older board + 3 on the newer one; boards in start order.
    expect(data).toHaveLength(7);
    expect(data.slice(0, 4).map((r) => [r.card_label, r.card_origin, r.group_name, r.group_origin, r.position])).toEqual([
      ["Billing", "predefined", "Money", "predefined", "1"],
      ["Profile", "predefined", "Account", "predefined", "1"],
      ["Security", "predefined", "Account", "predefined", "2"],
      ["My idea", "participant", "Mine", "participant", "1"],
    ]);
    expect(data[0]).toMatchObject({
      status: "completed",
      excluded: "false",
      Name: "Ada",
      "Country of residence": "United Kingdom",
      Gender: "Prefer to self-describe",
      "Gender (self-described)": "Agender",
      Team: "Ops",
      completed_at: "2026-01-01T10:30:00.000Z",
    });
    expect(data.slice(4).map((r) => [r.Name, r.card_label, r.group_name, r.group_origin, r.position])).toEqual([
      ["Bob", "Billing", "Money", "predefined", "1"],
      ["Bob", "Profile", "", "", ""],
      ["Bob", "Security", "", "", ""],
    ]);
    expect(data[4]).toMatchObject({ status: "in_progress", completed_at: "" });
  });

  it("RES-05: placeholder groups report their origin; excluded flag is exported", () => {
    const study = makeStudy(db, { sortType: "open", groupMode: "fixed", fixedGroupCount: 1 });
    const [card] = makeCards(db, study.id, ["A"]);
    const board = makeBoard(db, study.id, { excluded: true });
    const g = makeGroup(db, study.id, { boardId: board.id, kind: "placeholder", name: "Group 1" });
    place(db, board.id, card.id, g.id);
    const [row] = asObjects(parseCsv(placementsCsv(db, study.id)));
    expect(row).toMatchObject({ excluded: "true", group_name: "Group 1", group_origin: "placeholder", position: "1" });
  });

  it("NFR-05 RES-05: user text is quoted and formula-escaped", () => {
    const study = makeStudy(db);
    makeCards(db, study.id, ['=cmd|"/c calc"!A1', "Line\nbreak, comma"]);
    makeBoard(db, study.id, { participant: { name: "@evil" } });
    const csv = placementsCsv(db, study.id);
    expect(csv).toContain('"\'=cmd|""/c calc""!A1"');
    const data = asObjects(parseCsv(csv));
    expect(data.map((r) => r.card_label)).toEqual(["'=cmd|\"/c calc\"!A1", "Line\nbreak, comma"]);
    expect(data[0].Name).toBe("'@evil");
  });

  it("RES-05: participant columns follow the field config (none → no columns)", () => {
    const study = makeStudy(db, { participantFields: [] });
    makeCards(db, study.id, ["A"]);
    makeBoard(db, study.id, { participant: { name: "Hidden" } });
    const rows = parseCsv(placementsCsv(db, study.id));
    expect(rows[0]).not.toContain("Name");
    expect(rows[1]).not.toContain("Hidden");
    expect(rows[0].slice(6)).toEqual(["card_label", "card_origin", "group_name", "group_origin", "position"]);
  });

  it("RES-05: header only when there are no boards; unknown study → not_found", () => {
    const study = makeStudy(db);
    expect(parseCsv(placementsCsv(db, study.id))).toHaveLength(1);
    expectNotFound(() => placementsCsv(db, "missing-study"));
    expectNotFound(() => participantsCsv(db, "missing-study"));
  });
});

describe("participantsCsv", () => {
  it("RES-05: one row per board with counts and participant fields", () => {
    const { study, older, newer } = seed();
    const rows = parseCsv(participantsCsv(db, study.id));
    expect(rows[0]).toEqual([
      "board_id",
      "status",
      "excluded",
      "started_at",
      "last_activity_at",
      "completed_at",
      "sorted_count",
      "total_count",
      "Name",
      "Country of residence",
      "Gender",
      "Gender (self-described)",
      "Team",
    ]);
    const data = asObjects(rows);
    expect(data.map((r) => [r.board_id, r.status, r.sorted_count, r.total_count, r.Name])).toEqual([
      [older.id, "completed", "4", "4", "Ada"],
      [newer.id, "in_progress", "1", "3", "Bob"],
    ]);
  });

  it("RES-05: file name is a slug of the study title", () => {
    const { study } = seed();
    expect(csvFilename(db, study.id, "placements")).toBe("intranet-navigation-search-placements.csv");
    const blank = makeStudy(db, { title: "???" });
    expect(csvFilename(db, blank.id, "participants")).toBe("study-participants.csv");
    const accents = makeStudy(db, { title: "Café Études" });
    expect(csvFilename(db, accents.id, "participants")).toBe("cafe-etudes-participants.csv");
  });
});
