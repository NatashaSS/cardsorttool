// Stream N: analysis filters by participant details end to end (ANL-09).
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { e2eDb, loginAsAdmin, makeBoard, makeCards, makeGroups, makeStudy, place } from "./helpers";

const unique = () => Math.random().toString(36).slice(2, 8);
const done = () => ({ status: "completed" as const, completedAt: new Date().toISOString() });

/**
 * Closed study, cards Apple / Banana, groups Fruit / Veg. Completed boards:
 *   senior · GB · Acme   → together      senior · FR · acme   → together
 *   junior · GB · Globex → apart          lead   · —  · —      → apart
 * plus an in-progress senior board (together) and an excluded senior board (apart).
 * Unfiltered: n = 4, Apple & Banana together 50 %. Seniority = Senior: n = 2, 100 %.
 */
function seed() {
  const db = e2eDb();
  const study = makeStudy(db, {
    sortType: "closed",
    title: `Filtered analysis ${unique()}`,
    participantFields: [
      { key: "seniority", mode: "optional" },
      { key: "country", mode: "optional" },
      { key: "organisation", mode: "optional" },
    ],
  });
  const [apple, banana] = makeCards(db, study.id, ["Apple", "Banana"]);
  const [fruit, veg] = makeGroups(db, study.id, ["Fruit", "Veg"]);
  const board = (
    participant: Record<string, string>,
    together: boolean,
    extra: Record<string, unknown> = done(),
  ) => {
    const b = makeBoard(db, study.id, { participant, ...extra });
    place(db, b.id, apple.id, fruit.id);
    place(db, b.id, banana.id, together ? fruit.id : veg.id);
  };
  board({ seniority: "senior", country: "GB", organisation: "Acme" }, true);
  board({ seniority: "senior", country: "FR", organisation: "acme" }, true);
  board({ seniority: "junior", country: "GB", organisation: "Globex" }, false);
  board({ seniority: "lead" }, false);
  board({ seniority: "senior", country: "GB", organisation: "Acme" }, true, {});
  board({ seniority: "senior", country: "GB", organisation: "Acme" }, false, {
    ...done(),
    excluded: true,
  });
  return study;
}

const n = (page: Page) => page.getByTestId("analysis-n");
const cell = (page: Page) => page.getByTestId("similarity-matrix").locator("td[data-ri]");
const chips = (page: Page) => page.getByTestId("filter-chip");

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("ANL-09: filter by participant details — chips, URL state, reload, CSV, clear all", async ({
  page,
}) => {
  const study = seed();
  await page.goto(`/admin/studies/${study.id}/analysis`);
  await expect(n(page)).toHaveText("4");
  await expect(cell(page)).toHaveText("50");
  const filters = page.getByTestId("analysis-filters");
  await expect(filters.getByRole("button")).toHaveText([
    "Seniority",
    "Country of residence",
    "Organisation",
  ]);

  // Keyboard: open the Seniority filter, the first checkbox gets focus; pick "Senior".
  const seniority = filters.getByRole("button", { name: /^Seniority/ });
  await seniority.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("group", { name: "Filter by Seniority" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("checkbox")).toHaveCount(3); // Junior, Senior, Lead (no blanks)
  await expect(panel).toContainText("Senior2");
  await expect(panel.getByRole("checkbox").first()).toBeFocused();
  await panel.getByRole("checkbox", { name: /^Senior/ }).check();
  await expect(n(page)).toHaveText("2");
  await expect(cell(page)).toHaveText("100");
  await expect(page.getByTestId("analysis-filtered-from")).toHaveText("filtered from 4");
  await expect(chips(page)).toHaveText(["Seniority: Senior"]);
  await expect(page).toHaveURL(/[?&]filter=seniority%3Asenior(&|$)/);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(seniority).toBeFocused();

  // A second field (AND): Country = United Kingdom → only the Acme / GB board.
  await filters.getByRole("button", { name: /^Country of residence/ }).click();
  const country = page.getByRole("group", { name: "Filter by Country of residence" });
  await expect(country.getByRole("checkbox")).toHaveCount(3); // France, UK, (not answered)
  await country.getByRole("checkbox", { name: /^United Kingdom/ }).check();
  await expect(n(page)).toHaveText("1");
  await expect(chips(page)).toHaveText([
    "Seniority: Senior",
    "Country of residence: United Kingdom",
  ]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Remove filter Country of residence" }).click();
  await expect(n(page)).toHaveText("2");
  await expect(chips(page)).toHaveCount(1);

  // Combined with the include-in-progress toggle; excluded boards never count.
  await page.getByLabel("Include in-progress boards").check();
  await expect(n(page)).toHaveText("3");
  await expect(page).toHaveURL(/includeInProgress=1/);

  // Reload keeps the filters and the toggle.
  await page.reload();
  await expect(n(page)).toHaveText("3");
  await expect(chips(page)).toHaveText(["Seniority: Senior"]);
  await expect(page.getByLabel("Include in-progress boards")).toBeChecked();
  await page.getByLabel("Include in-progress boards").uncheck();
  await expect(n(page)).toHaveText("2");

  // The CSV export honours the filter.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^similarity-matrix-.+-filtered\.csv$/);
  const csv = fs.readFileSync(await download.path(), "utf8");
  expect(csv.replace(/^\uFEFF/, "")).toMatch(/^Similarity % \(n = 2; Seniority: Senior\),/);

  // Organisation is a text field: answers grouped case-insensitively.
  await filters.getByRole("button", { name: /^Organisation/ }).click();
  const org = page.getByRole("group", { name: "Filter by Organisation" });
  await expect(org.getByRole("checkbox", { name: /^Acme/ })).toBeVisible();
  await expect(org).toContainText("Acme2"); // "Acme" + "acme"
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(n(page)).toHaveText("4");
  await expect(chips(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/filter=/);
});

test("ANL-09: a filter matching no boards shows the empty state", async ({ page }) => {
  const study = seed();
  await page.goto(`/admin/studies/${study.id}/analysis?filter=seniority:executive`);
  await expect(n(page)).toHaveText("0");
  await expect(page.getByText("No boards match these filters")).toBeVisible();
  await expect(chips(page)).toHaveText(["Seniority: Executive"]);
  await page.getByRole("button", { name: "clear all filters" }).click();
  await expect(n(page)).toHaveText("4");
  await expect(page.getByTestId("similarity-matrix")).toBeVisible();
});

test("ANL-09: long text value lists have a search box", async ({ page }) => {
  const db = e2eDb();
  const study = makeStudy(db, {
    title: `Many orgs ${unique()}`,
    participantFields: [{ key: "organisation", mode: "optional" }],
  });
  makeCards(db, study.id, ["X", "Y"]);
  for (let i = 0; i < 12; i++) {
    makeBoard(db, study.id, { ...done(), participant: { organisation: `Company ${i + 1}` } });
  }
  await page.goto(`/admin/studies/${study.id}/analysis`);
  await page
    .getByTestId("analysis-filters")
    .getByRole("button", { name: /^Organisation/ })
    .click();
  const panel = page.getByRole("group", { name: "Filter by Organisation" });
  await expect(panel.getByRole("checkbox")).toHaveCount(12);
  const search = panel.getByRole("searchbox", { name: "Search Organisation" });
  await expect(search).toBeFocused();
  await search.fill("company 1");
  await expect(panel.getByRole("checkbox")).toHaveCount(4); // 1, 10, 11, 12
  await panel.getByRole("checkbox", { name: /^Company 11/ }).check();
  await expect(n(page)).toHaveText("1");
  await expect(chips(page)).toHaveText(["Organisation: Company 11"]);
});

test("ANL-09: no filter area when the study collects no participant details", async ({ page }) => {
  const db = e2eDb();
  const study = makeStudy(db, { title: `No fields ${unique()}`, participantFields: [] });
  makeCards(db, study.id, ["X", "Y"]);
  makeBoard(db, study.id, { ...done(), participant: {} });
  await page.goto(`/admin/studies/${study.id}/analysis`);
  await expect(n(page)).toHaveText("1");
  await expect(page.getByTestId("analysis-filters")).toHaveCount(0);
});

test("ANL-09: screenshot of the analysis page with an active filter", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await loginAsAdmin(page);
  const study = seed();
  await page.goto(
    `/admin/studies/${study.id}/analysis?filter=seniority:senior&filter=seniority:lead&filter=organisation:acme`,
  );
  await expect(n(page)).toHaveText("2");
  await page
    .getByTestId("analysis-filters")
    .getByRole("button", { name: /^Organisation/ })
    .click();
  await expect(page.getByRole("group", { name: "Filter by Organisation" })).toBeVisible();
  await page.screenshot({ path: "test-results/analysis-filter.png", caret: "initial" });
  await context.close();
});
