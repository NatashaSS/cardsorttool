// STU-07: add a predefined card.
import { CardInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { addCard } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin();
  const input = await parseBody(req, CardInputSchema);
  return Response.json(addCard(getDb(), id, input), { status: 201 });
});
