// STU-09: reorder predefined groups.
import { ReorderInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { reorderGroups } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin();
  const { ids } = await parseBody(req, ReorderInputSchema);
  return reorderGroups(getDb(), id, ids);
});
