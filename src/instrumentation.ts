// Runs once when the Next.js server starts. With AUTO_MIGRATE=1 (set in the Docker image) the
// database is created/upgraded before the first request, so no separate migrate step is needed.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.AUTO_MIGRATE !== "1") return;
  const { openDatabase, runMigrations } = await import("./server/db/open");
  const dbPath = process.env.DATABASE_PATH || "data/cardsort.db";
  const { db, sqlite } = openDatabase(dbPath);
  runMigrations(db);
  sqlite.close();
  console.log(`[cardsort] database ready at ${dbPath}`);
}
