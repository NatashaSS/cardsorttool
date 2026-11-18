import "server-only";
import { env } from "../env";
import { openDatabase, type DB } from "./open";

export type { DB } from "./open";

const globalForDb = globalThis as unknown as { __cardsortDb?: DB };

/** Process-wide database handle (survives dev hot reloads). Services receive it as a parameter. */
export function getDb(): DB {
  globalForDb.__cardsortDb ??= openDatabase(env.databasePath).db;
  return globalForDb.__cardsortDb;
}
