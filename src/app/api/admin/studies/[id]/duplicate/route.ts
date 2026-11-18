// STU-12: duplicate a study as a new draft.
import { getDb } from "@/server/db/client";
import { route } from "@/server/http";
import { duplicateStudy } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

export const POST = route<{ id: string }>(async (_req, { id }) => {
  await requireAdmin();
  return Response.json(duplicateStudy(getDb(), id), { status: 201 });
});
