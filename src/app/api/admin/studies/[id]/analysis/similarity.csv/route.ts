// ANL-07: similarity matrix as CSV (honours ?includeInProgress=1).
import { getDb } from "@/server/db/client";
import { route } from "@/server/http";
import { requireAdmin } from "@/server/session";
import { analysisOptions, matrixCsvResponse } from "../view";

export const GET = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin();
  return matrixCsvResponse(getDb(), id, analysisOptions(req), "similarity");
});
