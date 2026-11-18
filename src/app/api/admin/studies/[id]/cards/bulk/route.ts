// STU-08: bulk-add cards from pasted text, one per line.
import { BulkCardsInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { bulkAddCards } from "@/server/services/studies";
import { requireAdmin } from "@/server/session";

export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin();
  const { text } = await parseBody(req, BulkCardsInputSchema);
  return bulkAddCards(getDb(), id, text);
});
