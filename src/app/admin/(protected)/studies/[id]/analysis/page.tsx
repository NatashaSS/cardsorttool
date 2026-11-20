// Analysis (ANL-01..05, ANL-07). Initial data is loaded here; the client refetches on toggle.
import { notFound } from "next/navigation";
import { getAnalysisView } from "@/app/api/admin/studies/[id]/analysis/view";
import { AnalysisDashboard } from "@/components/admin/analysis/AnalysisDashboard";
import type { AnalysisView } from "@/components/admin/analysis/types";
import { getDb } from "@/server/db/client";
import { ServiceError } from "@/server/errors";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: PageProps<"/admin/studies/[id]/analysis">) {
  const { id } = await params;
  let view: AnalysisView;
  try {
    view = getAnalysisView(getDb(), id, { includeInProgress: false });
  } catch (err) {
    if (err instanceof ServiceError && err.code === "not_found") notFound();
    throw err;
  }
  return <AnalysisDashboard key={view.study.id} initialView={view} />;
}
