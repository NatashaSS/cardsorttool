// Stream D — participant boards (PART-*, SAVE-*, DONE-04/05). DESIGN §7–9.
import "server-only";
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import type {
  BoardOpResponse,
  BoardStateDTO,
  CompleteBoardResponse,
  CreateBoardResponse,
  PublicStudyDTO,
} from "@/lib/api-types";
import { getCompletionBlockers, placeholderGroupName } from "@/lib/completion";
import { buildParticipantSchema } from "@/lib/participant-fields";
import type { BoardOpRequest } from "@/lib/schemas";
import type { DB } from "../db/client";
import { boards, groups } from "../db/schema";
import { ServiceError } from "../errors";
import { parseWith } from "../http";
import { newBoardToken, newId, nowIso } from "../ids";
import { applyOp } from "./boards/ops";
import {
  buildBoardState,
  findBoardById,
  findBoardByToken,
  findStudyById,
  findStudyBySlug,
  participantFieldsOf,
  predefinedCards,
  rulesOf,
  snapshot,
} from "./boards/state";

const studyNotLive = () =>
  new ServiceError("study_not_live", "This study is not currently accepting responses");

/** Fisher–Yates with crypto randomness (PERM-08). Returns a new array. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** PART-01: intro page data. @throws not_found (also for unknown slugs). */
export function getPublicStudy(db: DB, slug: string): PublicStudyDTO {
  const study = findStudyBySlug(db, slug);
  return {
    slug: study.slug,
    title: study.title,
    instructions: study.instructions,
    status: study.status,
    participantFields: participantFieldsOf(study),
  };
}

/**
 * PART-02: validate answers with buildParticipantSchema, create a board with a fresh
 * token, shuffled card order (PERM-08) and placeholder groups (fixed-mode open sorts).
 * @throws not_found, study_not_live, bad_request
 */
export function createBoard(
  db: DB,
  slug: string,
  participant: Record<string, string>,
): CreateBoardResponse {
  return db.transaction((tx) => {
    const study = findStudyBySlug(tx, slug);
    if (study.status !== "live") throw studyNotLive();

    // PFLD-02 / PFLD-05: unknown keys are stripped; no fields → {}.
    const answers = parseWith(buildParticipantSchema(participantFieldsOf(study)), participant);
    const rules = rulesOf(study);

    const cardIds = predefinedCards(tx, study.id).map((c) => c.id);
    const cardOrder = rules.settings.randomizeCardOrder ? shuffle(cardIds) : cardIds;

    const now = nowIso();
    const boardId = newId();
    const token = newBoardToken();
    tx.insert(boards)
      .values({
        id: boardId,
        studyId: study.id,
        token,
        status: "in_progress",
        participant: answers,
        cardOrder,
        revision: 0,
        excluded: false,
        startedAt: now,
        lastActivityAt: now,
        completedAt: null,
      })
      .run();

    // STU-05: fixed-mode open sorts start with N placeholder groups.
    if (study.sortType === "open" && study.groupMode === "fixed") {
      const n = study.fixedGroupCount ?? 0;
      if (n > 0) {
        tx.insert(groups)
          .values(
            Array.from({ length: n }, (_, i) => ({
              id: newId(),
              studyId: study.id,
              boardId,
              kind: "placeholder" as const,
              name: placeholderGroupName(i),
              position: i,
            })),
          )
          .run();
      }
    }

    return { token };
  });
}

/** @throws not_found for unknown tokens (PART-04). */
export function getBoardState(db: DB, token: string): BoardStateDTO {
  return db.transaction((tx) => buildBoardState(tx, findBoardByToken(tx, token)));
}

/** Same as getBoardState but by board id — for the admin read-only view (RES-02). */
export function getBoardStateById(db: DB, boardId: string): BoardStateDTO {
  return db.transaction((tx) => buildBoardState(tx, findBoardById(tx, boardId)));
}

/**
 * Apply one op in a transaction (SAVE-01/03/04/05).
 * @throws not_found, board_completed, study_not_live, stale_revision, forbidden, conflict
 */
export function applyBoardOp(db: DB, token: string, request: BoardOpRequest): BoardOpResponse {
  return db.transaction((tx) => {
    const board = findBoardByToken(tx, token);
    if (board.status === "completed") {
      throw new ServiceError("board_completed", "This card sort has been completed and can't be changed");
    }
    const study = findStudyById(tx, board.studyId);
    if (study.status !== "live") throw studyNotLive();
    if (request.revision !== board.revision) {
      throw new ServiceError("stale_revision", "This board was changed elsewhere; reload to continue", {
        revision: board.revision,
      });
    }

    applyOp(tx, board, { study: rulesOf(study), boardStatus: board.status }, request.op);

    const revision = board.revision + 1;
    const lastActivityAt = nowIso();
    tx.update(boards).set({ revision, lastActivityAt }).where(eq(boards.id, board.id)).run();
    return { revision, lastActivityAt };
  });
}

/** DONE-04/05: idempotent; rejects with unprocessable when completion blockers exist. */
export function completeBoard(db: DB, token: string): CompleteBoardResponse {
  return db.transaction((tx) => {
    const board = findBoardByToken(tx, token);
    if (board.status === "completed" && board.completedAt) {
      return { status: "completed", completedAt: board.completedAt };
    }
    const study = findStudyById(tx, board.studyId);
    if (study.status !== "live") throw studyNotLive();

    const snap = snapshot(tx, board, study);
    const blockers = getCompletionBlockers({
      study: snap.rules,
      boardStatus: board.status,
      groups: snap.groups,
      unsortedCardIds: snap.unsortedCardIds,
    });
    if (blockers.length > 0) {
      throw new ServiceError("unprocessable", blockers.map((b) => b.message).join(" "), blockers);
    }

    const completedAt = nowIso();
    tx.update(boards)
      .set({ status: "completed", completedAt, lastActivityAt: completedAt })
      .where(eq(boards.id, board.id))
      .run();
    return { status: "completed", completedAt };
  });
}
