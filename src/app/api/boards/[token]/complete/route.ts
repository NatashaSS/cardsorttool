// DONE-03/04/05: complete and freeze the board.
import { getDb } from "@/server/db/client";
import { completeBoard } from "@/server/services/boards";
import { noStoreRoute } from "../../_lib/no-store";

export const POST = noStoreRoute<{ token: string }>((_req, { token }) => completeBoard(getDb(), token));
