// Response of GET /api/admin/studies/[id]/analysis and props of the analysis page (stream I).
import type { AnalysisResult } from "@/lib/api-types";
import type { AnalysisFilter, FilterFieldOptions } from "./filter";
import type { SortType, StudyStatus } from "@/lib/types";

export type AnalysisView = {
  study: { id: string; title: string; sortType: SortType; status: StudyStatus };
  includeInProgress: boolean;
  /** ANL-09: the participant filter applied (only enabled fields; {} = none). */
  filter: AnalysisFilter;
  /** ANL-09: per enabled participant field (configured order), values with board counts. */
  filterOptions: FilterFieldOptions[];
  /** Boards passing the status / exclusion rules before participant filters (= n unfiltered). */
  unfilteredN: number;
  /** Board counts of the study: non-excluded completed / in progress, and excluded (any status). */
  boardCounts: { completed: number; inProgress: number; excluded: number };
  /** Predefined cards in admin order (labels for the matrices). */
  cards: { id: string; label: string }[];
  /** Predefined groups in admin order ([] for open sorts). */
  groups: { id: string; name: string }[];
  result: AnalysisResult;
};
