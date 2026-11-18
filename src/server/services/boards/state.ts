// Stream D — loading boards and building BoardStateDTO (shared by reads, ops and completion).
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { RunResult } from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { BoardStateDTO, CardDTO, GroupDTO, StudyRulesConfig } from "@/lib/api-types";
import { ParticipantFieldsSchema, StudySettingsSchema, type ParticipantFieldConfig } from "@/lib/schemas";
import * as schema from "../../db/schema";
import { boards, cards, groups, placements, studies, type BoardRow, type StudyRow } from "../../db/schema";
import { notFound } from "../../errors";

/** Either the database handle or a transaction on it. */
export type Q = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;

/** Settings are JSON; fill defaults for keys added after the study was saved (DESIGN §4). */
export function rulesOf(study: StudyRow): StudyRulesConfig {
  return {
    status: study.status,
    sortType: study.sortType,
    groupMode: study.groupMode,
    fixedGroupCount: study.fixedGroupCount,
    maxParticipantGroups: study.maxParticipantGroups,
    settings: StudySettingsSchema.parse(study.settings ?? {}),
  };
}

export function participantFieldsOf(study: StudyRow): ParticipantFieldConfig[] {
  const parsed = ParticipantFieldsSchema.safeParse(study.participantFields);
  return parsed.success ? parsed.data : [];
}

export function findStudyBySlug(q: Q, slug: string): StudyRow {
  const study = q.select().from(studies).where(eq(studies.slug, slug)).get();
  if (!study) throw notFound("Study not found");
  return study;
}

export function findStudyById(q: Q, studyId: string): StudyRow {
  const study = q.select().from(studies).where(eq(studies.id, studyId)).get();
  if (!study) throw notFound("Study not found");
  return study;
}

export function findBoardByToken(q: Q, token: string): BoardRow {
  // Tokens are opaque; an empty/odd string simply finds nothing (PART-04).
  const board = q.select().from(boards).where(eq(boards.token, token)).get();
  if (!board) throw notFound("Board not found");
  return board;
}

export function findBoardById(q: Q, boardId: string): BoardRow {
  const board = q.select().from(boards).where(eq(boards.id, boardId)).get();
  if (!board) throw notFound("Board not found");
  return board;
}

/** Predefined cards of a study in admin order. */
export function predefinedCards(q: Q, studyId: string) {
  return q
    .select()
    .from(cards)
    .where(and(eq(cards.studyId, studyId), isNull(cards.boardId)))
    .orderBy(asc(cards.position), asc(cards.createdAt), asc(cards.id))
    .all();
}

/** Cards the participant created on this board, in creation order. */
export function boardCards(q: Q, boardId: string) {
  return q
    .select()
    .from(cards)
    .where(eq(cards.boardId, boardId))
    .orderBy(asc(cards.position), asc(cards.createdAt), asc(cards.id))
    .all();
}

export function predefinedGroups(q: Q, studyId: string) {
  return q
    .select()
    .from(groups)
    .where(and(eq(groups.studyId, studyId), isNull(groups.boardId)))
    .orderBy(asc(groups.position), asc(groups.id))
    .all();
}

/** Placeholder and participant groups of this board. */
export function boardGroups(q: Q, boardId: string) {
  return q
    .select()
    .from(groups)
    .where(eq(groups.boardId, boardId))
    .orderBy(asc(groups.position), asc(groups.id))
    .all();
}

export type BoardSnapshot = {
  study: StudyRow;
  rules: StudyRulesConfig;
  cards: CardDTO[];
  groups: GroupDTO[];
  unsortedCardIds: string[];
  trayOrder: string[];
};

/** Current cards/groups/tray of a board. */
export function snapshot(q: Q, board: BoardRow, study: StudyRow): BoardSnapshot {
  const predefCards = predefinedCards(q, study.id);
  const ownCards = boardCards(q, board.id);
  const groupRows = [...predefinedGroups(q, study.id), ...boardGroups(q, board.id)];
  const placementRows = q
    .select()
    .from(placements)
    .where(eq(placements.boardId, board.id))
    .orderBy(asc(placements.position), asc(placements.cardId))
    .all();

  const byGroup = new Map<string, string[]>(groupRows.map((g) => [g.id, []]));
  const placed = new Set<string>();
  for (const p of placementRows) {
    const list = byGroup.get(p.groupId);
    if (!list) continue; // defensive: placement into a group not on this board
    list.push(p.cardId);
    placed.add(p.cardId);
  }

  const cardDtos: CardDTO[] = [
    ...predefCards.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      origin: "predefined" as const,
    })),
    ...ownCards.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      origin: "participant" as const,
    })),
  ];

  // Tray order: the board's (possibly shuffled) card order (PERM-08), then any predefined card
  // missing from it (defensive), then participant cards by creation.
  const predefIds = new Set(predefCards.map((c) => c.id));
  const trayOrder: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      trayOrder.push(id);
    }
  };
  for (const id of board.cardOrder ?? []) if (predefIds.has(id)) push(id);
  for (const c of predefCards) push(c.id);
  for (const c of ownCards) push(c.id);

  return {
    study,
    rules: rulesOf(study),
    cards: cardDtos,
    groups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      cardIds: byGroup.get(g.id) ?? [],
    })),
    unsortedCardIds: trayOrder.filter((id) => !placed.has(id)),
    trayOrder,
  };
}

export function buildBoardState(q: Q, board: BoardRow): BoardStateDTO {
  const study = findStudyById(q, board.studyId);
  const snap = snapshot(q, board, study);
  return {
    board: {
      id: board.id,
      token: board.token,
      status: board.status,
      revision: board.revision,
      participant: board.participant ?? {},
      startedAt: board.startedAt,
      lastActivityAt: board.lastActivityAt,
      completedAt: board.completedAt,
    },
    study: {
      ...snap.rules,
      slug: study.slug,
      title: study.title,
      instructions: study.instructions,
      participantFields: participantFieldsOf(study),
    },
    cards: snap.cards,
    groups: snap.groups,
    unsortedCardIds: snap.unsortedCardIds,
    trayOrder: snap.trayOrder,
  };
}
