// STU-03 status transitions; publishing checks STU-09/STU-10.
import { StudyStatusInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { setStudyStatus } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin();
  const { status } = await parseBody(req, StudyStatusInputSchema);
  return setStudyStatus(getDb(), id, status);
});
