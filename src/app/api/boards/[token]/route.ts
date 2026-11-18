// PART-03/04: full board state for the token holder.
import { getDb } from "@/server/db/client";
import { getBoardState } from "@/server/services/boards";
import { noStoreRoute } from "../_lib/no-store";

export const GET = noStoreRoute<{ token: string }>((_req, { token }) => getBoardState(getDb(), token));
