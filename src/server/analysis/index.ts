// Stream E — pure analysis functions (ANL-01..06). No DB, no I/O. See DESIGN §11.
// Must stay importable from plain Node (scripts/tests): no "server-only" here.
import type { AnalysisInput, AnalysisResult } from "@/lib/api-types";
import type { SortType } from "@/lib/types";
import { clusterAverageLinkage } from "./cluster";
import { groupNameStats, participantCardRows } from "./group-names";
import { placementMatrix } from "./placement";
import { similarityMatrix } from "./similarity";

export { similarityMatrix } from "./similarity";
export { placementMatrix } from "./placement";
export { clusterAverageLinkage } from "./cluster";
export { groupNameStats, normalizeGroupName, participantCardRows } from "./group-names";

/** All analyses for one study. placement: null for open sorts; groupNames: [] for closed. */
export function computeAnalysis(input: AnalysisInput, sortType: SortType): AnalysisResult {
  const similarity = similarityMatrix(input);
  return {
    n: input.boards.length,
    similarity,
    placement: sortType === "open" ? null : placementMatrix(input, sortType),
    dendrogram: clusterAverageLinkage(similarity),
    groupNames: sortType === "closed" ? [] : groupNameStats(input),
    participantCards: participantCardRows(input),
  };
}
