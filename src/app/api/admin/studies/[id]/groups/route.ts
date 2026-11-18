// STU-09: add a predefined group (closed / hybrid sorts).
import { GroupInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { addGroup } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin();
  const input = await parseBody(req, GroupInputSchema);
  return Response.json(addGroup(getDb(), id, input), { status: 201 });
});
