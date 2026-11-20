// RES-03 exclude/include a board; RES-04 delete a board. Both → 204.
import { BoardExcludedInputSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody, route } from "@/server/http";
import { deleteBoard, setBoardExcluded } from "@/server/services/results";
import { requireAdmin } from "@/server/session";

type Params = { id: string; boardId: string };

export const PATCH = route<Params>(async (req, { id, boardId }) => {
  await requireAdmin();
  const { excluded } = await parseBody(req, BoardExcludedInputSchema);
  setBoardExcluded(getDb(), id, boardId, excluded);
});

export const DELETE = route<Params>(async (_req, { id, boardId }) => {
  await requireAdmin();
  deleteBoard(getDb(), id, boardId);
});
