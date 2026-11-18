/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove this line when implementing */
// Stream D — participant boards (PART-*, SAVE-*, DONE-04/05). DESIGN §7–9.
import "server-only";
import type {
  BoardOpResponse,
  BoardStateDTO,
  CompleteBoardResponse,
  CreateBoardResponse,
  PublicStudyDTO,
} from "@/lib/api-types";
import type { BoardOpRequest } from "@/lib/schemas";
import type { DB } from "../db/client";
import { notImplemented } from "../not-implemented";

/** PART-01: intro page data. @throws not_found (also for unknown slugs). */
export function getPublicStudy(db: DB, slug: string): PublicStudyDTO {
  return notImplemented("getPublicStudy");
}

/**
 * PART-02: validate answers with buildParticipantSchema, create a board with a fresh
 * token, shuffled card order (PERM-08) and placeholder groups (fixed-mode open sorts).
 * @throws study_not_live, bad_request
 */
export function createBoard(
  db: DB,
  slug: string,
  participant: Record<string, string>,
): CreateBoardResponse {
  return notImplemented("createBoard");
}

/** @throws not_found for unknown tokens (PART-04). */
export function getBoardState(db: DB, token: string): BoardStateDTO {
  return notImplemented("getBoardState");
}

/** Same as getBoardState but by board id — for the admin read-only view (RES-02). */
export function getBoardStateById(db: DB, boardId: string): BoardStateDTO {
  return notImplemented("getBoardStateById");
}

/**
 * Apply one op in a transaction (SAVE-01/03/04/05).
 * @throws board_completed, study_not_live, stale_revision, forbidden, bad_request, not_found
 */
export function applyBoardOp(db: DB, token: string, request: BoardOpRequest): BoardOpResponse {
  return notImplemented("applyBoardOp");
}

/** DONE-04/05: idempotent; rejects with unprocessable when completion blockers exist. */
export function completeBoard(db: DB, token: string): CompleteBoardResponse {
  return notImplemented("completeBoard");
}
