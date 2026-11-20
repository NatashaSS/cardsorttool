// Response of GET /api/admin/studies/[id]/analysis and props of the analysis page (stream I).
import type { AnalysisResult } from "@/lib/api-types";
import type { SortType, StudyStatus } from "@/lib/types";

export type AnalysisView = {
  study: { id: string; title: string; sortType: SortType; status: StudyStatus };
  includeInProgress: boolean;
  /** Board counts of the study: non-excluded completed / in progress, and excluded (any status). */
  boardCounts: { completed: number; inProgress: number; excluded: number };
  /** Predefined cards in admin order (labels for the matrices). */
  cards: { id: string; label: string }[];
  /** Predefined groups in admin order ([] for open sorts). */
  groups: { id: string; name: string }[];
  result: AnalysisResult;
};
