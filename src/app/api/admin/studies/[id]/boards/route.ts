// RES-01, RES-06: list a study's boards (polled by the boards page).
import { getDb } from "@/server/db/client";
import { route } from "@/server/http";
import { listBoards } from "@/server/services/results";
import { requireAdmin } from "@/server/session";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  await requireAdmin();
  return listBoards(getDb(), id);
});
