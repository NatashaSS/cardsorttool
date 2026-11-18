/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove this line when implementing */
// Stream H — admin results (RES-01..04). Read-only board view uses boards.getBoardStateById.
import "server-only";
import type { BoardSummaryDTO } from "@/lib/api-types";
import type { DB } from "../db/client";
import { notImplemented } from "../not-implemented";

export function listBoards(db: DB, studyId: string): BoardSummaryDTO[] {
  return notImplemented("listBoards");
}

export function setBoardExcluded(db: DB, studyId: string, boardId: string, excluded: boolean): void {
  return notImplemented("setBoardExcluded");
}

export function deleteBoard(db: DB, studyId: string, boardId: string): void {
  return notImplemented("deleteBoard");
}
