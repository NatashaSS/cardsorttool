/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove this line when implementing */
// Stream E — pure analysis functions (ANL-01..06). No DB, no I/O. See DESIGN §11.
import type {
  AnalysisInput,
  AnalysisResult,
  Dendrogram,
  GroupNameStat,
  ParticipantCardRow,
  PlacementMatrix,
  SimilarityMatrix,
} from "@/lib/api-types";
import type { SortType } from "@/lib/types";
import { notImplemented } from "../not-implemented";

/** ANL-01: cardIds in input.cards order. */
export function similarityMatrix(input: AnalysisInput): SimilarityMatrix {
  return notImplemented("similarityMatrix");
}

/** ANL-02: closed/hybrid only. Columns: predefined groups, "Other" (hybrid), "Unsorted". */
export function placementMatrix(input: AnalysisInput, sortType: SortType): PlacementMatrix {
  return notImplemented("placementMatrix");
}

/** ANL-03: average linkage on distance = 1 − ratio (null ratio → distance 1). Deterministic. */
export function clusterAverageLinkage(similarity: SimilarityMatrix): Dendrogram {
  return notImplemented("clusterAverageLinkage");
}

/** ANL-04: participant-created (and placeholder) group names, normalised. */
export function groupNameStats(input: AnalysisInput): GroupNameStat[] {
  return notImplemented("groupNameStats");
}

/** ANL-05 */
export function participantCardRows(input: AnalysisInput): ParticipantCardRow[] {
  return notImplemented("participantCardRows");
}

export function computeAnalysis(input: AnalysisInput, sortType: SortType): AnalysisResult {
  return notImplemented("computeAnalysis");
}
