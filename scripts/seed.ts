// Seed sample studies for local development: npm run db:seed
import "./_env";
import { openDatabase, runMigrations } from "../src/server/db/open";
import { makeCards, makeGroups, makeStudy } from "../tests/helpers/factories";

const dbPath = process.env.DATABASE_PATH || "data/cardsort.db";
const { db, sqlite } = openDatabase(dbPath);
runMigrations(db);

const closed = makeStudy(db, {
  title: "Sample closed sort: online grocery",
  sortType: "closed",
  participantFields: [
    { key: "name", mode: "required" },
    { key: "role", mode: "optional" },
    { key: "organisation", mode: "optional" },
  ],
});
makeCards(db, closed.id, ["Apples", "Bread", "Milk", "Cheddar", "Sourdough", "Bananas", "Yoghurt"]);
makeGroups(db, closed.id, ["Fruit", "Bakery", "Dairy", "Other"]);

const open = makeStudy(db, {
  title: "Sample open sort: company intranet",
  sortType: "open",
  groupMode: "unbounded",
  settings: { allowParticipantCards: true },
});
makeCards(db, open.id, [
  "Holiday policy",
  "Payslips",
  "IT helpdesk",
  "Expense claims",
  "Office locations",
  "Team directory",
  "Training courses",
]);

sqlite.close();
console.log(`Seeded ${dbPath}`);
console.log(`  closed study: /s/${closed.slug}`);
console.log(`  open study:   /s/${open.slug}`);
