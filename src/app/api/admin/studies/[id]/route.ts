// STU-01/02/03/04/05/06, PERM-*, PFLD-*: view, edit and delete one study.
import { UpdateStudyInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { deleteStudy, getStudy, updateStudy } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

type Params = { id: string };

export const GET = route<Params>(async (_req, { id }) => {
  await requireAdmin();
  return getStudy(getDb(), id);
});

export const PATCH = route<Params>(async (req, { id }) => {
  await requireAdmin();
  const input = await parseBody(req, UpdateStudyInputSchema);
  return updateStudy(getDb(), id, input);
});

export const DELETE = route<Params>(async (_req, { id }) => {
  await requireAdmin();
  deleteStudy(getDb(), id);
});
