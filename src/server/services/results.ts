// Stream H — admin results (RES-01..04). Read-only board view uses boards.getBoardStateById.
import "server-only";
import { and, asc, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { BoardSummaryDTO } from "@/lib/api-types";
import type { DB } from "../db/client";
import { boards, cards, placements, type BoardRow } from "../db/schema";
import { notFound } from "../errors";
import { findStudyById, type Q } from "./boards/state";

function toSummary(
  row: BoardRow,
  predefinedCount: number,
  ownCards: Map<string, number>,
  sorted: Map<string, number>,
): BoardSummaryDTO {
  return {
    id: row.id,
    status: row.status,
    participant: row.participant ?? {},
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
    completedAt: row.completedAt,
    excluded: row.excluded,
    sortedCount: sorted.get(row.id) ?? 0,
    totalCount: predefinedCount + (ownCards.get(row.id) ?? 0),
  };
}

function predefinedCardCount(q: Q, studyId: string): number {
  return (
    q
      .select({ n: count() })
      .from(cards)
      .where(and(eq(cards.studyId, studyId), isNull(cards.boardId)))
      .get()?.n ?? 0
  );
}

/** Participant-created card counts per board of a study (one aggregate query). */
function ownCardCounts(q: Q, studyId: string, boardId?: string): Map<string, number> {
  const rows = q
    .select({ boardId: cards.boardId, n: count() })
    .from(cards)
    .where(
      and(
        eq(cards.studyId, studyId),
        boardId ? eq(cards.boardId, boardId) : isNotNull(cards.boardId),
      ),
    )
    .groupBy(cards.boardId)
    .all();
  return new Map(rows.map((r) => [r.boardId ?? "", r.n]));
}

/** Placement counts per board of a study (one aggregate query). */
function sortedCounts(q: Q, studyId: string, boardId?: string): Map<string, number> {
  const rows = q
    .select({ boardId: placements.boardId, n: count() })
    .from(placements)
    .innerJoin(boards, eq(boards.id, placements.boardId))
    .where(and(eq(boards.studyId, studyId), boardId ? eq(boards.id, boardId) : undefined))
    .groupBy(placements.boardId)
    .all();
  return new Map(rows.map((r) => [r.boardId, r.n]));
}

/**
 * RES-01: every board of a study, most recent activity first. Uses four queries regardless of
 * the number of boards.
 * @throws not_found for an unknown study
 */
export function listBoards(db: DB, studyId: string): BoardSummaryDTO[] {
  return db.transaction((tx) => {
    findStudyById(tx, studyId);
    const predefinedCount = predefinedCardCount(tx, studyId);
    const own = ownCardCounts(tx, studyId);
    const sorted = sortedCounts(tx, studyId);
    return tx
      .select()
      .from(boards)
      .where(eq(boards.studyId, studyId))
      .orderBy(desc(boards.lastActivityAt), asc(boards.id))
      .all()
      .map((row) => toSummary(row, predefinedCount, own, sorted));
  });
}

/**
 * One board's summary (RES-02 header).
 * @throws not_found unless the board belongs to the study
 */
export function getBoardSummary(db: DB, studyId: string, boardId: string): BoardSummaryDTO {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.studyId, studyId)))
      .get();
    if (!row) throw notFound("Board not found");
    return toSummary(
      row,
      predefinedCardCount(tx, studyId),
      ownCardCounts(tx, studyId, boardId),
      sortedCounts(tx, studyId, boardId),
    );
  });
}

/**
 * RES-03: exclude a board from analysis, or include it again.
 * @throws not_found unless the board belongs to the study
 */
export function setBoardExcluded(db: DB, studyId: string, boardId: string, excluded: boolean): void {
  const result = db
    .update(boards)
    .set({ excluded })
    .where(and(eq(boards.id, boardId), eq(boards.studyId, studyId)))
    .run();
  if (result.changes === 0) throw notFound("Board not found");
}

/**
 * RES-04: delete a board; its placements, participant cards and groups cascade.
 * @throws not_found unless the board belongs to the study
 */
export function deleteBoard(db: DB, studyId: string, boardId: string): void {
  const result = db
    .delete(boards)
    .where(and(eq(boards.id, boardId), eq(boards.studyId, studyId)))
    .run();
  if (result.changes === 0) throw notFound("Board not found");
}
