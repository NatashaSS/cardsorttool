import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { ErrorCode } from "@/lib/api-types";
import { CARD_IMAGE_MAX_BYTES } from "@/lib/card-images";
import type { DB } from "@/server/db/open";
import { cardImages, studies } from "@/server/db/schema";
import { ServiceError } from "@/server/errors";
import { createBoard, getBoardState } from "@/server/services/boards";
import { getCardImage, removeCardImage, setCardImage } from "@/server/services/card-images";
import {
  deleteCard,
  deleteStudy,
  duplicateStudy,
  getStudy,
  reorderCards,
  updateCard,
} from "@/server/services/studies";
import { createTestDb } from "../helpers/db";
import { makeBoard, makeCard, makeCardImage, makeCards, makeStudy } from "../helpers/factories";
import { GIF_BYTES, JPEG_BYTES, SVG_BYTES, WEBP_BYTES, makePng } from "../helpers/card-images";

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

function draftWithCards(db: DB, labels = ["Apples", "Bananas"]) {
  const study = makeStudy(db, { status: "draft", sortType: "open" });
  return { study, cards: makeCards(db, study.id, labels) };
}

const imageCount = (db: DB) => db.select().from(cardImages).all().length;

/** Record every SQL statement prepared while `fn` runs. */
function recordSql<T>(db: DB, fn: () => T): { result: T; sql: string[] } {
  // drizzle() attaches the better-sqlite3 handle as $client; the DB type doesn't declare it.
  const client = (db as unknown as { $client: Database.Database }).$client;
  const original = client.prepare.bind(client);
  const sql: string[] = [];
  client.prepare = ((source: string) => {
    sql.push(source);
    return original(source);
  }) as typeof client.prepare;
  try {
    return { result: fn(), sql };
  } finally {
    client.prepare = original;
  }
}

describe("card images: service", () => {
  it("STU-13: accepts PNG, JPEG, WebP and GIF and stores the sniffed type", () => {
    const db = createTestDb();
    const { study, cards: cs } = draftWithCards(db, ["A", "B", "C", "D"]);
    const files: [Buffer, string][] = [
      [makePng(), "image/png"],
      [JPEG_BYTES, "image/jpeg"],
      [WEBP_BYTES, "image/webp"],
      [GIF_BYTES, "image/gif"],
    ];
    files.forEach(([bytes, type], i) => {
      const dto = setCardImage(db, study.id, cs[i].id, bytes);
      expect(dto).toMatchObject({ id: cs[i].id, label: cs[i].label });
      expect(dto.imageUrl).toMatch(new RegExp(`^/api/images/cards/${cs[i].id}\\?v=\\d+$`));
      const stored = getCardImage(db, cs[i].id);
      expect(stored?.mimeType).toBe(type);
      expect(Buffer.compare(stored!.data, bytes)).toBe(0);
    });
    const row = db.select().from(cardImages).where(eq(cardImages.cardId, cs[0].id)).get();
    expect(row?.byteSize).toBe(makePng().byteLength);
  });

  it("STU-13: rejects SVG, text, empty and too-large files with a clear message", () => {
    const db = createTestDb();
    const { study, cards: cs } = draftWithCards(db);
    expect(
      expectError(() => setCardImage(db, study.id, cs[0].id, SVG_BYTES), "unprocessable").message,
    ).toMatch(/PNG, JPEG, WebP or GIF/);
    expectError(
      () => setCardImage(db, study.id, cs[0].id, Buffer.from("just text")),
      "unprocessable",
    );
    expectError(() => setCardImage(db, study.id, cs[0].id, new Uint8Array(0)), "unprocessable");
    const big = Buffer.concat([makePng(), Buffer.alloc(CARD_IMAGE_MAX_BYTES)]);
    expect(
      expectError(() => setCardImage(db, study.id, cs[0].id, big), "unprocessable").message,
    ).toMatch(/at most 2 MB/);
    // Exactly at the limit is fine.
    const atLimit = Buffer.concat([
      makePng(),
      Buffer.alloc(CARD_IMAGE_MAX_BYTES - makePng().length),
    ]);
    expect(setCardImage(db, study.id, cs[0].id, atLimit).imageUrl).not.toBeNull();
    expect(imageCount(db)).toBe(1);
  });

  it("STU-13 / STU-03: images can only change while the study is a draft", () => {
    const db = createTestDb();
    const { study, cards: cs } = draftWithCards(db);
    setCardImage(db, study.id, cs[0].id, makePng());
    for (const status of ["live", "closed"] as const) {
      db.update(studies).set({ status }).where(eq(studies.id, study.id)).run();
      expectError(() => setCardImage(db, study.id, cs[1].id, makePng()), "study_locked");
      expectError(() => removeCardImage(db, study.id, cs[0].id), "study_locked");
    }
    expect(imageCount(db)).toBe(1);
  });

  it("STU-13: only predefined cards of that study (cross-study / participant cards → not_found)", () => {
    const db = createTestDb();
    const { study } = draftWithCards(db);
    const other = draftWithCards(db, ["Other"]);
    expectError(() => setCardImage(db, study.id, other.cards[0].id, makePng()), "not_found");
    expectError(() => setCardImage(db, study.id, "missing-card", makePng()), "not_found");
    expectError(() => setCardImage(db, "missing-study", other.cards[0].id, makePng()), "not_found");
    const board = makeBoard(db, study.id);
    const own = makeCard(db, study.id, { boardId: board.id, label: "Mine" });
    expectError(() => setCardImage(db, study.id, own.id, makePng()), "not_found");
    expectError(() => removeCardImage(db, study.id, own.id), "not_found");
    expect(imageCount(db)).toBe(0);
  });

  it("STU-13: replacing an image changes the URL version; removing clears it", () => {
    const db = createTestDb();
    const { study, cards: cs } = draftWithCards(db);
    const first = setCardImage(db, study.id, cs[0].id, makePng()).imageUrl;
    const second = setCardImage(db, study.id, cs[0].id, GIF_BYTES).imageUrl;
    expect(second).not.toBe(first);
    expect(getCardImage(db, cs[0].id)?.mimeType).toBe("image/gif");
    expect(imageCount(db)).toBe(1);
    expect(getStudy(db, study.id).cards[0].imageUrl).toBe(second);

    expect(removeCardImage(db, study.id, cs[0].id).imageUrl).toBeNull();
    expect(getCardImage(db, cs[0].id)).toBeNull();
    expect(getStudy(db, study.id).cards[0].imageUrl).toBeNull();
    // Removing again is a harmless no-op.
    expect(removeCardImage(db, study.id, cs[0].id).imageUrl).toBeNull();
  });

  it("STU-13: deleting a card or the study deletes its image", () => {
    const db = createTestDb();
    const { study, cards: cs } = draftWithCards(db);
    setCardImage(db, study.id, cs[0].id, makePng());
    setCardImage(db, study.id, cs[1].id, makePng());
    deleteCard(db, study.id, cs[0].id);
    expect(getCardImage(db, cs[0].id)).toBeNull();
    expect(imageCount(db)).toBe(1);
    deleteStudy(db, study.id);
    expect(imageCount(db)).toBe(0);
  });

  it("STU-12 / STU-13: duplicating a study copies its images to the new cards", () => {
    const db = createTestDb();
    const { study, cards: cs } = draftWithCards(db);
    setCardImage(db, study.id, cs[0].id, makePng());
    db.update(studies).set({ status: "live" }).where(eq(studies.id, study.id)).run();
    const copy = duplicateStudy(db, study.id);
    expect(copy.cards).toHaveLength(2);
    const [withImage, without] = copy.cards;
    expect(withImage.id).not.toBe(cs[0].id);
    expect(withImage.imageUrl).toMatch(new RegExp(`^/api/images/cards/${withImage.id}\\?v=`));
    expect(without.imageUrl).toBeNull();
    expect(Buffer.compare(getCardImage(db, withImage.id)!.data, makePng())).toBe(0);
    // The copy is independent: removing it there leaves the original alone.
    removeCardImage(db, copy.id, withImage.id);
    expect(getCardImage(db, cs[0].id)).not.toBeNull();
  });

  it("STU-13: card-returning study services include imageUrl", () => {
    const db = createTestDb();
    const { study, cards: cs } = draftWithCards(db);
    const url = setCardImage(db, study.id, cs[1].id, makePng()).imageUrl;
    expect(getStudy(db, study.id).cards.map((c) => c.imageUrl)).toEqual([null, url]);
    expect(
      updateCard(db, study.id, cs[1].id, { label: "Bananas!", description: null }).imageUrl,
    ).toBe(url);
    expect(reorderCards(db, study.id, [cs[1].id, cs[0].id]).map((c) => c.imageUrl)).toEqual([
      url,
      null,
    ]);
  });

  it("BRD-09: board state carries imageUrl for predefined cards (participant cards: null) without reading the BLOB", () => {
    const db = createTestDb();
    const study = makeStudy(db, { sortType: "open", settings: { randomizeCardOrder: false } });
    const [a, b] = makeCards(db, study.id, ["Apples", "Bananas"]);
    makeCardImage(db, a.id, { updatedAt: "2026-03-04T05:06:07.089Z" });
    const { token } = createBoard(db, study.slug, { name: "Ann" });
    const own = makeCard(db, study.id, {
      boardId: getBoardState(db, token).board.id,
      label: "Mine",
      position: 0,
    });
    makeCardImage(db, own.id); // even a stray row must not surface on a participant card

    const { result: state, sql } = recordSql(db, () => getBoardState(db, token));
    const byId = new Map(state.cards.map((c) => [c.id, c]));
    expect(byId.get(a.id)?.imageUrl).toBe(
      `/api/images/cards/${a.id}?v=${Date.parse("2026-03-04T05:06:07.089Z")}`,
    );
    expect(byId.get(b.id)?.imageUrl).toBeNull();
    expect(byId.get(own.id)?.imageUrl).toBeNull();
    expect(sql.some((s) => s.includes("card_image"))).toBe(true);
    expect(sql.filter((s) => /"card_image"\."data"|\bdata\b/.test(s))).toEqual([]);

    const admin = recordSql(db, () => getStudy(db, study.id));
    expect(admin.result.cards.find((c) => c.id === a.id)?.imageUrl).not.toBeNull();
    expect(admin.sql.filter((s) => /"card_image"\."data"|\bdata\b/.test(s))).toEqual([]);
  });
});
