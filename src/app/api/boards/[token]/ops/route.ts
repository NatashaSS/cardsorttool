// SAVE-01/03/04/05: apply one board operation.
import { BoardOpRequestSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody } from "@/server/http";
import { applyBoardOp } from "@/server/services/boards";
import { noStoreRoute } from "../../_lib/no-store";

export const POST = noStoreRoute<{ token: string }>(async (req, { token }) => {
  const request = await parseBody(req, BoardOpRequestSchema);
  return applyBoardOp(getDb(), token, request);
});
