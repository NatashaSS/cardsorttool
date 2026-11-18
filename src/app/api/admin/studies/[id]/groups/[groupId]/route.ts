// STU-09: rename / remove a predefined group.
import { GroupInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { deleteGroup, updateGroup } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

type Params = { id: string; groupId: string };

export const PATCH = route<Params>(async (req, { id, groupId }) => {
  await requireAdmin();
  const input = await parseBody(req, GroupInputSchema);
  return updateGroup(getDb(), id, groupId, input);
});

export const DELETE = route<Params>(async (_req, { id, groupId }) => {
  await requireAdmin();
  deleteGroup(getDb(), id, groupId);
});
