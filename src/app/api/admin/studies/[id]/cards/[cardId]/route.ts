// STU-07: edit / remove a predefined card. PATCH takes a full CardInput.
import { CardInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { deleteCard, updateCard } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

type Params = { id: string; cardId: string };

export const PATCH = route<Params>(async (req, { id, cardId }) => {
  await requireAdmin();
  const input = await parseBody(req, CardInputSchema);
  return updateCard(getDb(), id, cardId, input);
});

export const DELETE = route<Params>(async (_req, { id, cardId }) => {
  await requireAdmin();
  deleteCard(getDb(), id, cardId);
});
