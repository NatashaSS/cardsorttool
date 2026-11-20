// Stream H — CSV exports (RES-05). Must escape cells and neutralise formula injection (NFR-05).
import "server-only";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { BoardSummaryDTO } from "@/lib/api-types";
import {
  GENDER_SELF_DESCRIBE_KEY,
  formatAnswer,
  resolveFields,
} from "@/lib/participant-fields";
import type { ParticipantAnswers } from "@/lib/types";
import type { DB } from "../db/client";
import { boards, cards, groups, placements, type StudyRow } from "../db/schema";
import { findStudyById, participantFieldsOf, predefinedCards } from "./boards/state";
import { listBoards } from "./results";

// ---------------------------------------------------------------------------
// CSV encoding
// ---------------------------------------------------------------------------

/** UTF-8 byte order mark so Excel detects the encoding. */
export const CSV_BOM = "﻿";

/** Characters that make spreadsheet apps treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell: neutralise formulas by prefixing a single quote (OWASP), then quote per RFC 4180
 * when the value contains a quote, comma or line break.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 document: CRLF line endings (also after the last record), UTF-8 BOM. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(",") + "\r\n").join("");
}

// ---------------------------------------------------------------------------
// Participant columns (follow the study's field config, PFLD-03 order)
// ---------------------------------------------------------------------------

type ParticipantColumn = { header: string; value: (answers: ParticipantAnswers) => string };

function participantColumns(study: StudyRow): ParticipantColumn[] {
  return resolveFields(participantFieldsOf(study)).flatMap((field): ParticipantColumn[] => {
    const column: ParticipantColumn = {
      header: field.label,
      value: (a) => formatAnswer(field.key, a[field.key]),
    };
    if (field.key !== "gender") return [column];
    return [
      column,
      {
        header: `${field.label} (self-described)`,
        value: (a) => a[GENDER_SELF_DESCRIBE_KEY] ?? "",
      },
    ];
  });
}

const BOARD_HEADERS = ["board_id", "status", "excluded", "started_at", "last_activity_at", "completed_at"];

function boardCells(b: {
  id: string;
  status: string;
  excluded: boolean;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
}): (string | boolean)[] {
  return [b.id, b.status, b.excluded, b.startedAt, b.lastActivityAt, b.completedAt ?? ""];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * RES-05: one row per board × card. Boards in start order; per board, the predefined cards in
 * admin order, then the board's participant cards in creation order. `position` is the card's
 * 1-based rank within its group (empty when unsorted).
 * @throws not_found for an unknown study
 */
export function placementsCsv(db: DB, studyId: string): string {
  return db.transaction((tx) => {
    const study = findStudyById(tx, studyId);
    const columns = participantColumns(study);
    const boardRows = tx
      .select()
      .from(boards)
      .where(eq(boards.studyId, studyId))
      .orderBy(asc(boards.startedAt), asc(boards.id))
      .all();
    const predef = predefinedCards(tx, studyId);
    const ownCards = tx
      .select()
      .from(cards)
      .where(and(eq(cards.studyId, studyId), isNotNull(cards.boardId)))
      .orderBy(asc(cards.position), asc(cards.createdAt), asc(cards.id))
      .all();
    const groupById = new Map(
      tx
        .select({ id: groups.id, name: groups.name, kind: groups.kind })
        .from(groups)
        .where(eq(groups.studyId, studyId))
        .all()
        .map((g) => [g.id, g]),
    );
    const placementRows = tx
      .select({
        boardId: placements.boardId,
        cardId: placements.cardId,
        groupId: placements.groupId,
      })
      .from(placements)
      .innerJoin(boards, eq(boards.id, placements.boardId))
      .where(eq(boards.studyId, studyId))
      .orderBy(asc(placements.boardId), asc(placements.groupId), asc(placements.position), asc(placements.cardId))
      .all();

    // board → card → { groupId, rank }
    const placed = new Map<string, Map<string, { groupId: string; rank: number }>>();
    let prevKey = "";
    let rank = 0;
    for (const p of placementRows) {
      const key = `${p.boardId}\u0000${p.groupId}`;
      rank = key === prevKey ? rank + 1 : 1;
      prevKey = key;
      let byCard = placed.get(p.boardId);
      if (!byCard) placed.set(p.boardId, (byCard = new Map()));
      byCard.set(p.cardId, { groupId: p.groupId, rank });
    }

    const ownByBoard = new Map<string, typeof ownCards>();
    for (const c of ownCards) {
      const list = ownByBoard.get(c.boardId ?? "") ?? [];
      list.push(c);
      ownByBoard.set(c.boardId ?? "", list);
    }

    const rows: (string | number | boolean)[][] = [
      [
        ...BOARD_HEADERS,
        ...columns.map((c) => c.header),
        "card_label",
        "card_origin",
        "group_name",
        "group_origin",
        "position",
      ],
    ];
    for (const board of boardRows) {
      const answers = board.participant ?? {};
      const prefix = [...boardCells(board), ...columns.map((c) => c.value(answers))];
      const boardPlaced = placed.get(board.id);
      const boardCards = [
        ...predef.map((c) => ({ card: c, origin: "predefined" })),
        ...(ownByBoard.get(board.id) ?? []).map((c) => ({ card: c, origin: "participant" })),
      ];
      for (const { card, origin } of boardCards) {
        const placement = boardPlaced?.get(card.id);
        const group = placement ? groupById.get(placement.groupId) : undefined;
        rows.push([
          ...prefix,
          card.label,
          origin,
          group?.name ?? "",
          group?.kind ?? "",
          group && placement ? placement.rank : "",
        ]);
      }
    }
    return toCsv(rows);
  });
}

/**
 * RES-05: one row per board (start order) with counts and participant details.
 * @throws not_found for an unknown study
 */
export function participantsCsv(db: DB, studyId: string): string {
  const study = findStudyById(db, studyId);
  const columns = participantColumns(study);
  const summaries: BoardSummaryDTO[] = listBoards(db, studyId).sort(
    (a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
  );
  const rows: (string | number | boolean)[][] = [
    [...BOARD_HEADERS, "sorted_count", "total_count", ...columns.map((c) => c.header)],
  ];
  for (const b of summaries) {
    rows.push([
      ...boardCells(b),
      b.sortedCount,
      b.totalCount,
      ...columns.map((c) => c.value(b.participant)),
    ]);
  }
  return toCsv(rows);
}

/** Attachment file name: `<study-title-slug>-<kind>.csv`. */
export function csvFilename(db: DB, studyId: string, kind: "placements" | "participants"): string {
  const study = findStudyById(db, studyId);
  const slug =
    study.title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "study";
  return `${slug}-${kind}.csv`;
}
