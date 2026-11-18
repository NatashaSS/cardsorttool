/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove this line when implementing */
// Stream H — CSV exports (RES-05). Must escape cells and neutralise formula injection.
import "server-only";
import type { DB } from "../db/client";
import { notImplemented } from "../not-implemented";

/** One row per board × card. */
export function placementsCsv(db: DB, studyId: string): string {
  return notImplemented("placementsCsv");
}

/** One row per board. */
export function participantsCsv(db: DB, studyId: string): string {
  return notImplemented("participantsCsv");
}
