// Analysis (ANL-01..05, ANL-07, ANL-09). Initial data is loaded here from the page URL
// (`?includeInProgress=1&filter=<fieldKey>:<value>…`); the client refetches on change and keeps
// the URL in sync, so a reload or shared link restores the same view.
import { notFound } from "next/navigation";
import { getAnalysisView } from "@/app/api/admin/studies/[id]/analysis/view";
import { AnalysisDashboard } from "@/components/admin/analysis/AnalysisDashboard";
import { analysisQueryFromParams } from "@/lib/analysis-filter";
import type { AnalysisView } from "@/components/admin/analysis/types";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/errors";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({
  params,
  searchParams,
}: PageProps<"/admin/studies/[id]/analysis">) {
  const { id } = await params;
  const query = analysisQueryFromParams(await searchParams);
  let view: AnalysisView;
  try {
    view = getAnalysisView(getDb(), id, query);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "not_found") notFound();
    throw err;
  }
  return <AnalysisDashboard key={view.study.id} initialView={view} />;
}
