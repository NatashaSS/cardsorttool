// Stream M — card images (STU-13, BRD-09). DESIGN §11a.
// Synchronous (better-sqlite3), db first, throws ServiceError.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AdminCardDTO } from "@/lib/api-types";
import {
  CARD_IMAGE_MAX_BYTES,
  CARD_IMAGE_SIZE_MESSAGE,
  CARD_IMAGE_TYPE_MESSAGE,
  type CardImageType,
} from "@/lib/card-images";
import type { DB } from "../db/client";
import { cardImages, cards, studies, type CardRow } from "../db/schema";
import { ServiceError, notFound } from "../errors";

/** The db handle or a transaction on it. */
type Conn = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/**
 * Identify an image by its magic bytes; the declared type and file name are ignored.
 * Returns null for anything else (SVG, text, unknown formats).
 */
export function sniffImageType(bytes: Uint8Array): CardImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

/** Public, cache-busted URL of a card's image (the `v` changes on every replace). */
export function cardImageUrl(cardId: string, updatedAt: string): string {
  const ms = Date.parse(updatedAt);
  return `/api/images/cards/${encodeURIComponent(cardId)}?v=${Number.isNaN(ms) ? 0 : ms}`;
}

/** `imageUrl` for a card from the joined `card_image.updated_at` (null = no image). */
export const imageUrlOf = (cardId: string, imageUpdatedAt: string | null | undefined) =>
  imageUpdatedAt ? cardImageUrl(cardId, imageUpdatedAt) : null;

function loadDraftPredefinedCard(db: Conn, studyId: string, cardId: string): CardRow {
  const study = db
    .select({ status: studies.status })
    .from(studies)
    .where(eq(studies.id, studyId))
    .get();
  if (!study) throw notFound("Study not found");
  if (study.status !== "draft") {
    throw new ServiceError(
      "study_locked",
      `Card images can only be changed while the study is a draft (it is ${study.status}).`,
    );
  }
  const card = db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.studyId, studyId), isNull(cards.boardId)))
    .get();
  if (!card) throw notFound("Card not found");
  return card;
}

const toAdminCard = (c: CardRow, imageUpdatedAt: string | null): AdminCardDTO => ({
  id: c.id,
  label: c.label,
  description: c.description,
  position: c.position,
  imageUrl: imageUrlOf(c.id, imageUpdatedAt),
});

function touchStudy(db: Conn, studyId: string, now: string): void {
  db.update(studies).set({ updatedAt: now }).where(eq(studies.id, studyId)).run();
}

/**
 * STU-13: add or replace the image of a predefined card of a draft study.
 * @throws study_locked (not draft), not_found (study / card of this study), unprocessable
 *   (too large, or not a PNG/JPEG/WebP/GIF by content)
 */
export function setCardImage(
  db: DB,
  studyId: string,
  cardId: string,
  bytes: Uint8Array,
): AdminCardDTO {
  return db.transaction((tx) => {
    const card = loadDraftPredefinedCard(tx, studyId, cardId);
    if (bytes.byteLength === 0) {
      throw new ServiceError("unprocessable", `The file is empty. ${CARD_IMAGE_TYPE_MESSAGE}`);
    }
    if (bytes.byteLength > CARD_IMAGE_MAX_BYTES) {
      throw new ServiceError(
        "unprocessable",
        `${CARD_IMAGE_SIZE_MESSAGE} This file is ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB.`,
      );
    }
    const mimeType = sniffImageType(bytes);
    if (!mimeType) {
      throw new ServiceError(
        "unprocessable",
        `This file is not a supported image. ${CARD_IMAGE_TYPE_MESSAGE}`,
      );
    }
    const previous = tx
      .select({ updatedAt: cardImages.updatedAt })
      .from(cardImages)
      .where(eq(cardImages.cardId, cardId))
      .get();
    // The URL version must change on every replace, even within the same millisecond.
    let ms = Date.now();
    const prevMs = previous ? Date.parse(previous.updatedAt) : NaN;
    if (!Number.isNaN(prevMs) && ms <= prevMs) ms = prevMs + 1;
    const updatedAt = new Date(ms).toISOString();
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    tx.insert(cardImages)
      .values({ cardId, mimeType, data, byteSize: bytes.byteLength, updatedAt })
      .onConflictDoUpdate({
        target: cardImages.cardId,
        set: { mimeType, data, byteSize: bytes.byteLength, updatedAt },
      })
      .run();
    touchStudy(tx, studyId, new Date().toISOString());
    return toAdminCard(card, updatedAt);
  });
}

/** STU-13: remove a card's image (no-op if it has none). Same checks as setCardImage. */
export function removeCardImage(db: DB, studyId: string, cardId: string): AdminCardDTO {
  return db.transaction((tx) => {
    const card = loadDraftPredefinedCard(tx, studyId, cardId);
    const res = tx.delete(cardImages).where(eq(cardImages.cardId, cardId)).run();
    if (res.changes > 0) touchStudy(tx, studyId, new Date().toISOString());
    return toAdminCard(card, null);
  });
}

/** BRD-09: the stored image for serving, or null. */
export function getCardImage(
  db: DB,
  cardId: string,
): { mimeType: CardImageType; data: Buffer; updatedAt: string } | null {
  const row = db
    .select({
      mimeType: cardImages.mimeType,
      data: cardImages.data,
      updatedAt: cardImages.updatedAt,
    })
    .from(cardImages)
    .where(eq(cardImages.cardId, cardId))
    .get();
  return row ?? null;
}

/** STU-12: copy image rows from source cards to their copies (`idMap`: old id → new id). */
export function copyCardImages(db: Conn, idMap: Map<string, string>): void {
  // INSERT … SELECT keeps the BLOBs inside SQLite.
  for (const [fromId, toId] of idMap) {
    db.run(
      sql`INSERT INTO card_image (card_id, mime_type, data, byte_size, updated_at)
          SELECT ${toId}, mime_type, data, byte_size, updated_at FROM card_image
          WHERE card_id = ${fromId}`,
    );
  }
}
