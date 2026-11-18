import { openDatabase, runMigrations, type DB } from "@/server/db/open";

/** Fresh, migrated in-memory SQLite database for a test. */
export function createTestDb(): DB {
  const { db } = openDatabase(":memory:");
  runMigrations(db);
  return db;
}
