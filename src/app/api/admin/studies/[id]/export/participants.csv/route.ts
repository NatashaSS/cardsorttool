// RES-05: participants CSV (one row per board).
import { getDb } from "@/server/db/client";
import { route } from "@/server/http";
import { csvFilename, participantsCsv } from "@/server/services/export";
import { requireAdmin } from "@/server/session";
import { csvResponse } from "../csv-response";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requireAdmin();
  const db = getDb();
  return csvResponse(participantsCsv(db, id), csvFilename(db, id, "participants"));
});
