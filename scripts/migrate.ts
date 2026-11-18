import "./_env";
import { openDatabase, runMigrations } from "../src/server/db/open";

const dbPath = process.env.DATABASE_PATH || "data/cardsort.db";
const { db, sqlite } = openDatabase(dbPath);
runMigrations(db);
sqlite.close();
console.log(`Migrated ${dbPath}`);
