// Stream J: non-functional requirements that need the running app — SQLite as the only
// database (NFR-01) and the documented online backup (NFR-08).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../src/server/db/schema";
import type { StudyDetailDTO } from "../../src/lib/api-types";
import { E2E_DB } from "./fixtures";
import { loginAsAdmin } from "./helpers";
import { boardState, createLiveStudy, group, joinStudy, sortInto, unique } from "./journey-helpers";

const root = process.cwd();
const dbFile = path.resolve(root, E2E_DB);

test("NFR-01: the app keeps all its data in the single SQLite file at DATABASE_PATH", async ({
  page,
  browser,
}) => {
  // The web server was started with DATABASE_PATH=<E2E_DB> (playwright.config.ts) and nothing else.
  expect(fs.existsSync(dbFile)).toBe(true);

  await loginAsAdmin(page);
  const title = `SQLite only ${unique()}`;
  const study: StudyDetailDTO = await createLiveStudy(page.request, {
    title,
    sortType: "closed",
    cards: ["Apples", "Carrots"],
    groups: ["Fruit", "Vegetables"],
  });
  const { context, page: p, token } = await joinStudy(browser, study.shareUrl!, "Sqlite Sam");
  await sortInto(p, "Apples", group(p, "Fruit"));
  const boardId = (await boardState(p, token)).board.id;
  await context.close();

  // A separate, read-only connection to the file sees exactly what was created through the UI/API.
  const sqlite = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const [main] = sqlite.pragma("database_list") as { name: string; file: string }[];
    expect(path.resolve(main.file)).toBe(dbFile);
    const db = drizzle(sqlite, { schema });
    const studyRow = db.select().from(schema.studies).where(eq(schema.studies.title, title)).get();
    expect(studyRow).toMatchObject({ id: study.id, status: "live" });
    const board = db.select().from(schema.boards).where(eq(schema.boards.id, boardId)).get();
    expect(board).toMatchObject({ studyId: study.id, token, participant: { name: "Sqlite Sam" } });
    const placed = db
      .select({ card: schema.cards.label, group: schema.groups.name })
      .from(schema.placements)
      .innerJoin(schema.cards, eq(schema.cards.id, schema.placements.cardId))
      .innerJoin(schema.groups, eq(schema.groups.id, schema.placements.groupId))
      .where(eq(schema.placements.boardId, boardId))
      .all();
    expect(placed).toEqual([{ card: "Apples", group: "Fruit" }]);
  } finally {
    sqlite.close();
  }

  // No other database or external service is a dependency.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const deps = Object.keys(pkg.dependencies);
  expect(deps).toContain("better-sqlite3");
  const otherDatabases =
    /^(pg|postgres|mysql2?|mariadb|mongodb|mongoose|redis|ioredis|@prisma\/client|tedious|oracledb|@libsql\/client|@neondatabase\/.*|@planetscale\/.*)$/;
  expect(deps.filter((d) => otherDatabases.test(d))).toEqual([]);
  // The compose file runs a single service.
  const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
  const services = compose.split(/^services:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
  expect(services.match(/^ {2}[A-Za-z0-9_-]+:\s*$/gm)).toHaveLength(1);
});

test("NFR-08: the README's online backup (better-sqlite3 .backup()) yields a readable copy of the live database", async ({
  page,
}, testInfo) => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  expect(readme).toMatch(/\.backup\(/);

  await loginAsAdmin(page);
  const title = `Backup ${unique()}`;
  const created = await page.request.post("/api/admin/studies", {
    data: { title, sortType: "open" },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as StudyDetailDTO;

  // Same approach as the README, run against the database the server has open right now.
  const target = testInfo.outputPath("backup.db");
  fs.rmSync(target, { force: true });
  const live = new Database(dbFile, { fileMustExist: true });
  try {
    await live.backup(target);
  } finally {
    live.close();
  }

  // The server keeps working after the backup.
  const after = await page.request.get(`/api/admin/studies/${id}`);
  expect(after.ok()).toBe(true);

  const copy = new Database(target, { readonly: true, fileMustExist: true });
  try {
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    const db = drizzle(copy, { schema });
    expect(db.select().from(schema.studies).where(eq(schema.studies.id, id)).get()).toMatchObject({
      title,
    });
  } finally {
    copy.close();
  }
});
