// Stream I: builds the analysis page/API payload (ANL-01..05) and the CSV downloads (ANL-07).
// Stream N: participant-detail filters (ANL-09) on all of them.
import "server-only";
import { count, eq } from "drizzle-orm";
import { placementCsv, similarityCsv } from "@/components/admin/analysis/csv";
import {
  analysisQueryFromParams,
  describeFilter,
  isFilterActive,
} from "@/lib/analysis-filter";
import type { AnalysisView } from "@/components/admin/analysis/types";
import { computeAnalysis } from "@/server/analysis";
import type { DB } from "@/server/db/client";
import { boards, studies } from "@/server/db/schema";
import { notFound, ServiceError } from "@/server/errors";
import { loadAnalysisData, type AnalysisOptions } from "@/server/services/analysis-data";

/**
 * `?includeInProgress=1` (or `true`) → include in-progress boards; repeated
 * `filter=<fieldKey>:<value>` → participant filter (ANL-09).
 */
export function analysisOptions(req: Request): AnalysisOptions {
  return analysisQueryFromParams(new URL(req.url).searchParams);
}

/** @throws ServiceError not_found */
export function getAnalysisView(db: DB, studyId: string, opts: AnalysisOptions): AnalysisView {
  const study = db
    .select({
      id: studies.id,
      title: studies.title,
      sortType: studies.sortType,
      status: studies.status,
    })
    .from(studies)
    .where(eq(studies.id, studyId))
    .get();
  if (!study) throw notFound("Study not found");
  const { input, filter, filterOptions, unfilteredN } = loadAnalysisData(db, studyId, opts);

  const boardCounts = { completed: 0, inProgress: 0, excluded: 0 };
  const rows = db
    .select({ status: boards.status, excluded: boards.excluded, n: count() })
    .from(boards)
    .where(eq(boards.studyId, studyId))
    .groupBy(boards.status, boards.excluded)
    .all();
  for (const r of rows) {
    if (r.excluded) boardCounts.excluded += r.n;
    else if (r.status === "completed") boardCounts.completed += r.n;
    else boardCounts.inProgress += r.n;
  }

  return {
    study,
    includeInProgress: opts.includeInProgress,
    filter,
    filterOptions,
    unfilteredN,
    boardCounts,
    cards: input.cards,
    groups: input.groups,
    result: computeAnalysis(input, study.sortType),
  };
}

function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export type MatrixKind = "similarity" | "placement";

/** ANL-07. The placement matrix only exists for closed/hybrid sorts (422 for open). */
export function matrixCsvResponse(
  db: DB,
  studyId: string,
  opts: AnalysisOptions,
  kind: MatrixKind,
): Response {
  const view = getAnalysisView(db, studyId, opts);
  // ANL-09: a filtered export says so in its file name and in the header cell next to n.
  const filtered = isFilterActive(view.filter);
  const note = filtered ? describeFilter(view.filter, view.filterOptions) : undefined;
  const filename = `${kind}-matrix-${studyId}${filtered ? "-filtered" : ""}.csv`;
  if (kind === "similarity") {
    return csvResponse(similarityCsv(view.cards, view.result, note), filename);
  }
  const csv = placementCsv(view.cards, view.result, note);
  if (csv === null) {
    throw new ServiceError(
      "unprocessable",
      "The placement matrix is only available for closed and hybrid sorts.",
    );
  }
  return csvResponse(csv, filename);
}
