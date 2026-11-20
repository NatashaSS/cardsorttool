// ANL-01..05: analysis of a study (completed, non-excluded boards; ?includeInProgress=1 adds
// in-progress boards). Returns AnalysisView: study header, card/group labels and AnalysisResult.
import { getDb } from "@/server/db/client";
import { route } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { analysisOptions, getAnalysisView } from "./view";

export const GET = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin();
  return getAnalysisView(getDb(), id, analysisOptions(req));
});
