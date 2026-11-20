// Stream H: admin boards list, read-only board view, exclusion, deletion, CSV, auto-refresh.
import { expect, test, type Page } from "@playwright/test";
import {
  e2eDb,
  loginAsAdmin,
  makeBoard,
  makeCard,
  makeCards,
  makeGroup,
  makeGroups,
  makeStudy,
  place,
} from "./helpers";

const unique = () => Math.random().toString(36).slice(2, 8);
const iso = (day: number, hour = 10) => new Date(Date.UTC(2026, 0, day, hour)).toISOString();

function seed() {
  const db = e2eDb();
  const study = makeStudy(db, {
    title: `Results ${unique()}`,
    participantFields: [
      { key: "name", mode: "required" },
      { key: "role", mode: "optional" },
      { key: "country", mode: "optional" },
    ],
  });
  const cards = makeCards(db, study.id, ["Billing", "Profile", "Security"]);
  const [account, money] = makeGroups(db, study.id, ["Account", "Money"]);
  const ada = makeBoard(db, study.id, {
    participant: { name: "Ada", role: "Engineer", country: "GB" },
    cardOrder: cards.map((c) => c.id),
    status: "completed",
    startedAt: iso(1),
    lastActivityAt: iso(2),
    completedAt: iso(2),
  });
  const own = makeGroup(db, study.id, { boardId: ada.id, kind: "participant", name: "Odds and ends" });
  const idea = makeCard(db, study.id, { boardId: ada.id, label: "My idea" });
  place(db, ada.id, cards[0].id, money.id, 0);
  place(db, ada.id, cards[1].id, account.id, 0);
  place(db, ada.id, cards[2].id, own.id, 0);
  place(db, ada.id, idea.id, own.id, 1);
  const bob = makeBoard(db, study.id, {
    participant: { name: "Bob", role: "Designer" },
    cardOrder: cards.map((c) => c.id),
    startedAt: iso(3),
    lastActivityAt: iso(5),
  });
  place(db, bob.id, cards[0].id, money.id, 0);
  const cy = makeBoard(db, study.id, {
    participant: { name: "Cy" },
    cardOrder: cards.map((c) => c.id),
    startedAt: iso(4),
    lastActivityAt: iso(4),
  });
  return { study, ada, bob, cy };
}

const rows = (page: Page) => page.getByTestId("board-row");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const names = async (page: Page) =>
  (await rows(page).locator("td:first-child").allInnerTexts()).map((t) => t.trim());

async function openList(page: Page, studyId: string) {
  await page.goto(`/admin/studies/${studyId}/boards`);
  await expect(page.getByTestId("boards-table")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("RES-01: lists boards with participant columns, status, dates and progress; filter and sort", async ({ page }) => {
  const { study } = seed();
  await openList(page, study.id);
  await expect(page.getByTestId("study-title")).toHaveText(study.title);
  await expect(page.getByRole("link", { name: "Analysis" })).toHaveAttribute(
    "href",
    `/admin/studies/${study.id}/analysis`,
  );
  const headers = page.getByTestId("boards-table").locator("thead th");
  await expect(headers).toHaveText([
    "Name",
    "Role / job title",
    "Country of residence",
    "Status",
    /Started/,
    /Last activity/,
    /Completed/,
    "Cards sorted",
    "Actions",
  ]);
  await expect(page.getByTestId("board-counts")).toContainText("Boards3");
  // Default: last activity, newest first.
  expect(await names(page)).toEqual(["Bob", "Cy", "Ada"]);
  await expect(row(page, "Ada")).toContainText("United Kingdom");
  await expect(row(page, "Ada").getByTestId("board-status")).toHaveText("Completed");
  await expect(row(page, "Ada").getByTestId("sorted-count")).toHaveText("4 / 4 sorted");
  await expect(row(page, "Bob").getByTestId("board-status")).toHaveText("In progress");
  await expect(row(page, "Bob").getByTestId("sorted-count")).toHaveText("1 / 3 sorted");
  await expect(row(page, "Cy").getByTestId("sorted-count")).toHaveText("0 / 3 sorted");
  await expect(row(page, "Ada").locator("time").first()).toHaveAttribute("datetime", iso(1));

  // Filter by status.
  const filters = page.getByRole("group", { name: "Filter by status" });
  await filters.getByRole("button", { name: /^Completed/ }).click();
  expect(await names(page)).toEqual(["Ada"]);
  await filters.getByRole("button", { name: /^In progress/ }).click();
  expect(await names(page)).toEqual(["Bob", "Cy"]);
  await filters.getByRole("button", { name: /^All/ }).click();

  // Sort by a date column (desc first, then asc).
  const started = page.getByRole("button", { name: "Started" });
  await started.click();
  expect(await names(page)).toEqual(["Cy", "Bob", "Ada"]);
  await started.click();
  expect(await names(page)).toEqual(["Ada", "Bob", "Cy"]);
  await page.getByTestId("boards-table").getByRole("button", { name: "Completed", exact: true }).click();
  expect((await names(page))[0]).toBe("Ada"); // boards without completion date last
});

test("RES-03 RES-04: exclude/include and delete a board (with confirmation)", async ({ page }) => {
  const { study } = seed();
  await openList(page, study.id);
  await page.getByRole("button", { name: "Exclude board of Bob" }).click();
  await expect(row(page, "Bob")).toHaveAttribute("data-excluded", "true");
  await expect(row(page, "Bob").getByTestId("excluded-tag")).toBeVisible();
  await page.reload();
  await expect(row(page, "Bob").getByTestId("excluded-tag")).toBeVisible();
  await page.getByRole("button", { name: "Include board of Bob" }).click();
  await expect(row(page, "Bob").getByTestId("excluded-tag")).toHaveCount(0);

  // Cancel keeps the board.
  await page.getByRole("button", { name: "Delete board of Cy" }).click();
  await expect(page.getByRole("dialog")).toContainText("Delete this board?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(row(page, "Cy")).toHaveCount(1);
  // Confirm deletes it.
  await page.getByRole("button", { name: "Delete board of Cy" }).click();
  await page.getByRole("button", { name: "Delete board", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Cy")).toHaveCount(0);
  await page.reload();
  expect(await names(page)).toEqual(["Bob", "Ada"]);
});

test("RES-02 PART-05: read-only board view with participant details and marked participant groups", async ({ page }) => {
  const { study, ada } = seed();
  await openList(page, study.id);
  await page.getByRole("link", { name: "View board of Ada" }).click();
  await expect(page).toHaveURL(`/admin/studies/${study.id}/boards/${ada.id}`);
  await expect(page.getByTestId("board")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByTestId("board-details")).toContainText("Engineer");
  await expect(page.getByTestId("board-details")).toContainText("United Kingdom");
  await expect(page.getByTestId("participant-additions")).toContainText("1 group");
  const ownGroup = page.getByRole("region", { name: "Group Odds and ends" });
  await expect(ownGroup).toContainText("My idea");
  await expect(ownGroup).toContainText("Added by participant");
  await expect(ownGroup).toContainText("Participant card");
  await expect(page.getByRole("region", { name: "Group Money" })).not.toContainText(
    "Added by participant",
  );
  // No nested <main> landmarks inside the admin layout.
  await expect(page.locator("main main")).toHaveCount(0);
  // No editing controls.
  await expect(page.getByRole("button", { name: /New group/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add card/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Complete card sort/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Delete group/ })).toHaveCount(0);

  // Exclude toggle from the board page.
  await page.getByRole("button", { name: "Exclude from analysis" }).click();
  await expect(page.getByRole("button", { name: "Include in analysis" })).toBeVisible();
  await page.getByRole("link", { name: "Boards", exact: true }).click();
  await expect(row(page, "Ada").getByTestId("excluded-tag")).toBeVisible();

  // A board of another study is a 404.
  const other = makeStudy(e2eDb());
  const res = await page.goto(`/admin/studies/${other.id}/boards/${ada.id}`);
  expect(res?.status()).toBe(404);
});

test("RES-05: CSV downloads", async ({ page }) => {
  const { study } = seed();
  await openList(page, study.id);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export placements CSV" }).click(),
  ]);
  const slug = study.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  expect(download.suggestedFilename()).toBe(`${slug}-placements.csv`);
  const res = await page.request.get(`/api/admin/studies/${study.id}/export/participants.csv`);
  expect(res.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  const text = (await res.body()).toString("utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text.split("\r\n")).toHaveLength(5); // header + 3 boards + trailing CRLF
});

test("RES-06: the list refreshes every 15 s and shows when it was last updated", async ({ page }) => {
  await page.clock.install();
  const { study } = seed();
  await openList(page, study.id);
  await expect(page.getByTestId("last-updated")).toContainText("Last updated");
  makeBoard(e2eDb(), study.id, { participant: { name: "Newcomer" } });
  await page.clock.runFor(14_000);
  await expect(row(page, "Newcomer")).toHaveCount(0);
  await page.clock.runFor(1_500);
  await expect(row(page, "Newcomer")).toHaveCount(1);
  await expect(page.getByTestId("board-counts")).toContainText("Boards4");
});

test("RES-01: empty state shows the participant link", async ({ page }) => {
  const study = makeStudy(e2eDb(), { title: `Empty ${unique()}` });
  await page.goto(`/admin/studies/${study.id}/boards`);
  await expect(page.getByTestId("boards-empty")).toContainText("No boards yet");
  await expect(page.getByTestId("boards-empty")).toContainText(`/s/${study.slug}`);
});
