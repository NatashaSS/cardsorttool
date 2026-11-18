/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove this line when implementing */
// Stream I — loads boards from the DB into AnalysisInput and runs the analysis engine.
import "server-only";
import type { AnalysisInput, AnalysisResult } from "@/lib/api-types";
import type { DB } from "../db/client";
import { notImplemented } from "../not-implemented";

export type AnalysisOptions = { includeInProgress: boolean };

/** Completed, non-excluded boards by default (+ in-progress when requested). */
export function loadAnalysisInput(db: DB, studyId: string, opts: AnalysisOptions): AnalysisInput {
  return notImplemented("loadAnalysisInput");
}

export function getStudyAnalysis(db: DB, studyId: string, opts: AnalysisOptions): AnalysisResult {
  return notImplemented("getStudyAnalysis");
}
