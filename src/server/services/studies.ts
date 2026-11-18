/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove this line when implementing */
// Stream C — study management (STU-*, PERM config, PFLD config). DESIGN §4–6.
// All functions are synchronous (better-sqlite3) and take the db handle first.
import "server-only";
import type {
  AdminCardDTO,
  AdminGroupDTO,
  BulkAddCardsResponse,
  StudyDetailDTO,
  StudySummaryDTO,
} from "@/lib/api-types";
import type { CardInput, CreateStudyInput, GroupInput, UpdateStudyInput } from "@/lib/schemas";
import type { StudyStatus } from "@/lib/types";
import type { DB } from "../db/client";
import { notImplemented } from "../not-implemented";

export function listStudies(db: DB): StudySummaryDTO[] {
  return notImplemented("listStudies");
}

/** @throws ServiceError not_found */
export function getStudy(db: DB, studyId: string): StudyDetailDTO {
  return notImplemented("getStudy");
}

/** New studies start as draft with DEFAULT_SETTINGS and DEFAULT_PARTICIPANT_FIELDS. */
export function createStudy(db: DB, input: CreateStudyInput): StudyDetailDTO {
  return notImplemented("createStudy");
}

/**
 * Title/description/instructions are always editable; everything else only in draft
 * (STU-03, throws study_locked). Validates sort type / group mode combinations.
 */
export function updateStudy(db: DB, studyId: string, input: UpdateStudyInput): StudyDetailDTO {
  return notImplemented("updateStudy");
}

export function deleteStudy(db: DB, studyId: string): void {
  return notImplemented("deleteStudy");
}

/** STU-03 transitions; publishing validates STU-09/STU-10 (throws unprocessable). */
export function setStudyStatus(db: DB, studyId: string, status: StudyStatus): StudyDetailDTO {
  return notImplemented("setStudyStatus");
}

/** STU-12: new draft copy with settings, cards, groups and fields; no boards. */
export function duplicateStudy(db: DB, studyId: string): StudyDetailDTO {
  return notImplemented("duplicateStudy");
}

// --- Predefined cards (STU-07, STU-08) -------------------------------------

export function addCard(db: DB, studyId: string, input: CardInput): AdminCardDTO {
  return notImplemented("addCard");
}

export function updateCard(db: DB, studyId: string, cardId: string, input: CardInput): AdminCardDTO {
  return notImplemented("updateCard");
}

export function deleteCard(db: DB, studyId: string, cardId: string): void {
  return notImplemented("deleteCard");
}

/** `ids` must be exactly the study's predefined card ids, in the new order. */
export function reorderCards(db: DB, studyId: string, ids: string[]): AdminCardDTO[] {
  return notImplemented("reorderCards");
}

/** One card per line; blank lines ignored; duplicates (case-insensitive) skipped. */
export function bulkAddCards(db: DB, studyId: string, text: string): BulkAddCardsResponse {
  return notImplemented("bulkAddCards");
}

// --- Predefined groups (STU-09) ---------------------------------------------

export function addGroup(db: DB, studyId: string, input: GroupInput): AdminGroupDTO {
  return notImplemented("addGroup");
}

export function updateGroup(db: DB, studyId: string, groupId: string, input: GroupInput): AdminGroupDTO {
  return notImplemented("updateGroup");
}

export function deleteGroup(db: DB, studyId: string, groupId: string): void {
  return notImplemented("deleteGroup");
}

export function reorderGroups(db: DB, studyId: string, ids: string[]): AdminGroupDTO[] {
  return notImplemented("reorderGroups");
}
