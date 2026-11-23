// Stream I — loads boards from the DB into AnalysisInput and runs the analysis engine.
// Stream N — participant-detail filters (ANL-09) and the filter options with counts.
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  buildFilterOptions,
  filterFields,
  makeFilterMatcher,
  sanitizeFilter,
  type AnalysisFilter,
  type FilterFieldOptions,
} from "@/lib/analysis-filter";
import type { AnalysisBoard, AnalysisInput, AnalysisResult } from "@/lib/api-types";
import type { BoardStatus } from "@/lib/types";
import { computeAnalysis } from "../analysis";
import type { DB } from "../db/client";
import { boards, cards, groups, placements, studies } from "../db/schema";
import { notFound } from "../errors";

export type AnalysisOptions = {
  includeInProgress: boolean;
  /** ANL-09: participant-detail filter; unknown / disabled field keys are ignored. */
  filter?: AnalysisFilter;
};

export type AnalysisData = {
  input: AnalysisInput;
  /** The filter actually applied (sanitised against the study's enabled fields). */
  filter: AnalysisFilter;
  /** Per enabled participant field, the values with board counts before participant filters. */
  filterOptions: FilterFieldOptions[];
  /** Boards passing the status / exclusion rules, before participant filters. */
  unfilteredN: number;
};

/** Statuses of the boards analysed (RES-03: excluded boards are always left out). */
function analysedStatuses(opts: AnalysisOptions): BoardStatus[] {
  return opts.includeInProgress ? ["completed", "in_progress"] : ["completed"];
}

/**
 * Completed, non-excluded boards by default (+ in-progress when requested).
 *
 * A fixed number of set-based queries regardless of the board count (NFR-04): study, predefined
 * cards, predefined groups, boards, placements of predefined cards, participant cards.
 * Boards are ordered by start time (then id); participant cards by board, then position.
 * @throws ServiceError not_found
 */
export function loadAnalysisInput(db: DB, studyId: string, opts: AnalysisOptions): AnalysisInput {
  return loadAnalysisData(db, studyId, opts).input;
}

/**
 * loadAnalysisInput plus the filter metadata (ANL-09). The participant filter is applied in
 * memory to the board rows (their answers come with them); placements and participant cards
 * of boards filtered out are skipped, so the query count stays fixed (NFR-04).
 * @throws ServiceError not_found
 */
export function loadAnalysisData(db: DB, studyId: string, opts: AnalysisOptions): AnalysisData {
  const study = db
    .select({ id: studies.id, participantFields: studies.participantFields })
    .from(studies)
    .where(eq(studies.id, studyId))
    .get();
  if (!study) throw notFound("Study not found");
  const fields = filterFields(study.participantFields);
  const filter = sanitizeFilter(opts.filter ?? {}, fields);
  const matches = makeFilterMatcher(filter, fields);

  const cardRows = db
    .select({ id: cards.id, label: cards.label })
    .from(cards)
    .where(and(eq(cards.studyId, studyId), isNull(cards.boardId)))
    .orderBy(asc(cards.position), asc(cards.createdAt), asc(cards.id))
    .all();
  const groupRows = db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(and(eq(groups.studyId, studyId), isNull(groups.boardId), eq(groups.kind, "predefined")))
    .orderBy(asc(groups.position), asc(groups.id))
    .all();

  const boardFilter = and(
    eq(boards.studyId, studyId),
    eq(boards.excluded, false),
    inArray(boards.status, analysedStatuses(opts)),
  );
  const allBoardRows = db
    .select({ id: boards.id, participant: boards.participant })
    .from(boards)
    .where(boardFilter)
    .orderBy(asc(boards.startedAt), asc(boards.id))
    .all();
  const filterOptions = buildFilterOptions(
    fields,
    allBoardRows.map((b) => b.participant),
    filter,
  );
  const boardRows = allBoardRows.filter((b) => matches(b.participant));
  const meta = { filter, filterOptions, unfilteredN: allBoardRows.length };

  const emptyPlacements = Object.fromEntries(cardRows.map((c) => [c.id, null])) as Record<
    string,
    AnalysisBoard["placements"][string]
  >;
  const byId = new Map<string, AnalysisBoard>();
  const boardList: AnalysisBoard[] = boardRows.map((b) => {
    const board: AnalysisBoard = {
      id: b.id,
      placements: { ...emptyPlacements },
      participantCards: [],
    };
    byId.set(b.id, board);
    return board;
  });
  if (boardList.length === 0) {
    return { input: { cards: cardRows, groups: groupRows, boards: [] }, ...meta };
  }

  // Placements of predefined cards on the included boards (absent row = unsorted). Rows of
  // boards removed by the participant filter are skipped below (byId only holds kept boards).
  const placementRows = db
    .select({
      boardId: placements.boardId,
      cardId: placements.cardId,
      groupId: placements.groupId,
      groupKind: groups.kind,
      groupName: groups.name,
    })
    .from(placements)
    .innerJoin(boards, eq(boards.id, placements.boardId))
    .innerJoin(cards, eq(cards.id, placements.cardId))
    .innerJoin(groups, eq(groups.id, placements.groupId))
    .where(and(boardFilter, isNull(cards.boardId), eq(groups.studyId, studyId)))
    .all();
  for (const p of placementRows) {
    const board = byId.get(p.boardId);
    if (!board || !(p.cardId in board.placements)) continue;
    board.placements[p.cardId] = {
      groupId: p.groupId,
      groupKind: p.groupKind,
      groupName: p.groupName,
    };
  }

  // Participant-created cards (PERM-01 / ANL-05) with the name of the group they sit in.
  const participantRows = db
    .select({ boardId: cards.boardId, label: cards.label, groupName: groups.name })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .leftJoin(
      placements,
      and(eq(placements.cardId, cards.id), eq(placements.boardId, cards.boardId)),
    )
    .leftJoin(groups, eq(groups.id, placements.groupId))
    .where(and(eq(cards.studyId, studyId), boardFilter))
    .orderBy(asc(cards.position), asc(cards.createdAt), asc(cards.id))
    .all();
  for (const c of participantRows) {
    const board = c.boardId ? byId.get(c.boardId) : undefined;
    board?.participantCards.push({ label: c.label, groupName: c.groupName ?? null });
  }

  return { input: { cards: cardRows, groups: groupRows, boards: boardList }, ...meta };
}

/** @throws ServiceError not_found */
export function getStudyAnalysis(db: DB, studyId: string, opts: AnalysisOptions): AnalysisResult {
  const study = db
    .select({ sortType: studies.sortType })
    .from(studies)
    .where(eq(studies.id, studyId))
    .get();
  if (!study) throw notFound("Study not found");
  return computeAnalysis(loadAnalysisInput(db, studyId, opts), study.sortType);
}
