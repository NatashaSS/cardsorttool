// PART-02: validate participant details and create a board.
import { CreateBoardRequestSchema } from "@/lib/schemas";
import { getDb } from "@/server/db/client";
import { parseBody } from "@/server/http";
import { createBoard } from "@/server/services/boards";
import { noStoreRoute } from "../../../boards/_lib/no-store";

export const POST = noStoreRoute<{ slug: string }>(async (req, { slug }) => {
  const { participant } = await parseBody(req, CreateBoardRequestSchema);
  return Response.json(createBoard(getDb(), slug, participant), { status: 201 });
});
