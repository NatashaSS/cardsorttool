import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { boards, cards, placements } from "@/server/db/schema";
import { createTestDb } from "../helpers/db";
import { makeBoard, makeCards, makeGroups, makeStudy, place } from "../helpers/factories";

describe("database schema", () => {
  it("NFR-02: migrations create a working schema", () => {
    const db = createTestDb();
    const study = makeStudy(db);
    const [card] = makeCards(db, study.id, ["Apples"]);
    const [group] = makeGroups(db, study.id, ["Fruit"]);
    const board = makeBoard(db, study.id, { cardOrder: [card.id] });
    place(db, board.id, card.id, group.id);
    expect(db.select().from(placements).all()).toHaveLength(1);
    expect(db.select().from(boards).where(eq(boards.id, board.id)).get()?.cardOrder).toEqual([card.id]);
  });

  it("STU-01 / RES-04: deleting cascades to dependent rows", () => {
    const db = createTestDb();
    const study = makeStudy(db);
    const [card] = makeCards(db, study.id, ["Apples"]);
    const [group] = makeGroups(db, study.id, ["Fruit"]);
    const board = makeBoard(db, study.id);
    place(db, board.id, card.id, group.id);
    db.delete(boards).where(eq(boards.id, board.id)).run();
    expect(db.select().from(placements).all()).toHaveLength(0);
    expect(db.select().from(cards).all()).toHaveLength(1);
  });
});
