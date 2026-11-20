// RES-05: placements CSV (one row per board × card).
import { getDb } from "@/server/db/client";
import { route } from "@/server/http";
import { csvFilename, placementsCsv } from "@/server/services/export";
import { requireAdmin } from "@/server/session";
import { csvResponse } from "../csv-response";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requireAdmin();
  const db = getDb();
  return csvResponse(placementsCsv(db, id), csvFilename(db, id, "placements"));
});
