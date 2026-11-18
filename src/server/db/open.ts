// No "server-only" here: also used by scripts/ and tests/ running under plain Node.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

/** Open a SQLite database with the pragmas this app relies on. */
export function openDatabase(filePath: string): { db: DB; sqlite: Database.Database } {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const sqlite = new Database(filePath);
  if (filePath !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

export function runMigrations(db: DB, migrationsFolder = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
}
