// Stream I: analysis page end to end (ANL-01..05, ANL-07, RES-03).
import fs from "node:fs";
import { expect, test } from "@playwright/test";
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
const done = () => ({ status: "completed" as const, completedAt: new Date().toISOString() });

function seedClosed() {
  const db = e2eDb();
  const study = makeStudy(db, { sortType: "closed", title: `Closed analysis ${unique()}` });
  const [apple, banana, carrot] = makeCards(db, study.id, ["Apple", "Banana", "Carrot"]);
  const [fruit, veg] = makeGroups(db, study.id, ["Fruit", "Vegetables"]);
  // 3 completed boards: Apple+Banana always together; Carrot in Vegetables on 2 of 3.
  for (const carrotGroup of [veg, veg, fruit]) {
    const b = makeBoard(db, study.id, done());
    place(db, b.id, apple.id, fruit.id);
    place(db, b.id, banana.id, fruit.id);
    place(db, b.id, carrot.id, carrotGroup.id);
  }
  // In-progress board: only Apple sorted, with Carrot elsewhere.
  const wip = makeBoard(db, study.id);
  place(db, wip.id, apple.id, veg.id);
  place(db, wip.id, carrot.id, veg.id);
  // Excluded completed board (RES-03) must never be counted.
  const excluded = makeBoard(db, study.id, { ...done(), excluded: true });
  place(db, excluded.id, apple.id, veg.id);
  return study;
}

function seedOpen() {
  const db = e2eDb();
  const study = makeStudy(db, {
    sortType: "open",
    title: `Open analysis ${unique()}`,
    settings: { allowParticipantCards: true },
  });
  const [a, b] = makeCards(db, study.id, ["Login", "Logout"]);
  const boardIds: string[] = [];
  for (const name of ["Account", "  account "]) {
    const board = makeBoard(db, study.id, done());
    boardIds.push(board.id);
    const g = makeGroup(db, study.id, { boardId: board.id, kind: "participant", name });
    place(db, board.id, a.id, g.id);
    place(db, board.id, b.id, g.id);
    if (boardIds.length === 1) {
      const extra = makeCard(db, study.id, { boardId: board.id, label: "Reset password" });
      place(db, board.id, extra.id, g.id, 2);
    }
  }
  return { study, boardIds };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("ANL-01 ANL-02 ANL-03 ANL-07 RES-03: closed study shows n, matrices, dendrogram, toggle and CSV", async ({
  page,
}) => {
  const study = seedClosed();
  await page.goto(`/admin/studies/${study.id}/analysis`);
  await expect(page.getByTestId("analysis-title")).toContainText(study.title);
  // Excluded board ignored, in-progress not yet included.
  await expect(page.getByTestId("analysis-n")).toHaveText("3");
  await expect(page.getByText("1 excluded board not counted")).toBeVisible();

  // ANL-01: Apple & Banana are together on 3 of 3 boards.
  const matrix = page.getByTestId("similarity-matrix");
  await expect(matrix).toBeVisible();
  await expect(matrix.getByRole("rowheader")).toHaveCount(2);
  await expect(matrix.locator("td").filter({ hasText: "100" })).toHaveCount(1);
  await matrix.locator("td").filter({ hasText: "100" }).hover();
  await expect(page.getByTestId("cell-tooltip")).toHaveText(
    /^(Apple & Banana|Banana & Apple): together in 3 of 3 boards \(100%\)$/,
  );
  // Keyboard: the first cell is the tab stop, and focus shows the tooltip.
  await matrix.locator('td[tabindex="0"]').focus();
  await expect(page.getByTestId("cell-tooltip")).toBeVisible();

  // ANL-07: CSV download.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^similarity-matrix-.+\.csv$/);
  const csv = fs.readFileSync(await download.path(), "utf8");
  expect(csv.startsWith("﻿Similarity % (n = 3),")).toBe(true);
  expect(csv).toContain("\r\n");

  // ANL-02: placement matrix with top group highlighted.
  await page.getByRole("tab", { name: "Placement matrix" }).click();
  const placement = page.getByTestId("placement-matrix");
  const carrotRow = placement.getByRole("row").filter({ hasText: "Carrot" });
  await expect(carrotRow.locator("td").nth(0)).toHaveText("33%");
  await expect(carrotRow.locator("td").nth(1)).toHaveText("67%");
  await expect(carrotRow.locator("td[data-top]")).toHaveText("67%");
  await expect(carrotRow.locator("td").last()).toHaveText("Vegetables");

  // ANL-03: dendrogram with cut-off slider and cluster list.
  await page.getByRole("tab", { name: "Dendrogram" }).click();
  await expect(page.getByTestId("dendrogram").locator("svg path")).toHaveCount(2);
  await expect(page.getByTestId("cluster-list")).toContainText("Apple");
  await page.getByTestId("cutoff-slider").fill("0");
  await expect(page.getByTestId("cluster-count")).toHaveText("1 cluster");
  await page.getByTestId("cutoff-slider").fill("100");
  await expect(page.getByTestId("cluster-list")).toContainText("C1 (2 cards): Apple, Banana");

  // Toggle includes the in-progress board (n 3 → 4), never the excluded one.
  await page.getByLabel("Include in-progress boards").check();
  await expect(page.getByTestId("analysis-n")).toHaveText("4");
  await page.getByRole("tab", { name: "Placement matrix" }).click();
  await expect(
    page
      .getByTestId("placement-matrix")
      .getByRole("row")
      .filter({ hasText: "Carrot" })
      .locator("td")
      .nth(1),
  ).toHaveText("75%");
  const [placementCsv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download CSV" }).click(),
  ]);
  expect(fs.readFileSync(await placementCsv.path(), "utf8")).toContain("Placement % (n = 4)");
  await page.getByLabel("Include in-progress boards").uncheck();
  await expect(page.getByTestId("analysis-n")).toHaveText("3");
});

test("ANL-04 ANL-05: open study shows group names and participant cards", async ({ page }) => {
  const { study, boardIds } = seedOpen();
  await page.goto(`/admin/studies/${study.id}/analysis`);
  await expect(page.getByTestId("analysis-n")).toHaveText("2");
  await expect(page.getByRole("tab", { name: "Placement matrix" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Group names" }).click();
  const names = page.getByTestId("group-names");
  await expect(names.getByRole("row")).toHaveCount(2); // header + one normalised name
  await expect(names.getByRole("rowheader")).toHaveText("Account");
  await expect(names).toContainText("2 (100%)");
  await expect(names).toContainText("Login ×2");

  await page.getByRole("tab", { name: /Participant cards/ }).click();
  const cards = page.getByTestId("participant-cards");
  await expect(cards.getByRole("rowheader")).toHaveText("Reset password");
  await expect(cards.getByRole("link")).toHaveAttribute(
    "href",
    `/admin/studies/${study.id}/boards/${boardIds[0]}`,
  );
  await expect(cards).toContainText("Account");
});

test("ANL-01: a study without completed boards shows the empty state", async ({ page }) => {
  const db = e2eDb();
  const study = makeStudy(db, { sortType: "open", title: `Empty ${unique()}` });
  makeCards(db, study.id, ["X", "Y"]);
  makeBoard(db, study.id);
  await page.goto(`/admin/studies/${study.id}/analysis`);
  await expect(page.getByTestId("analysis-n")).toHaveText("0");
  await expect(page.getByText("No boards to analyse yet")).toBeVisible();
  await expect(page.getByText(/1 board is still in progress/)).toBeVisible();
});

test("ANL-01 ANL-03: screenshots of closed and open analysis pages", async ({ browser }) => {
  for (const kind of ["closed", "open"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await loginAsAdmin(page);
    const id = kind === "closed" ? seedLarge() : seedOpen().study.id;
    await page.goto(`/admin/studies/${id}/analysis`);
    await expect(page.getByTestId("similarity-matrix")).toBeVisible();
    await page.screenshot({
      path: `test-results/analysis-${kind}-similarity.png`,
      fullPage: true,
      caret: "initial",
    });
    await page.getByRole("tab", { name: "Dendrogram" }).click();
    await page.screenshot({
      path: `test-results/analysis-${kind}-dendrogram.png`,
      fullPage: true,
      caret: "initial",
    });
    const second = kind === "closed" ? "Placement matrix" : "Group names";
    await page.getByRole("tab", { name: second }).click();
    await page.screenshot({
      path: `test-results/analysis-${kind}-${kind === "closed" ? "placement" : "groups"}.png`,
      fullPage: true,
      caret: "initial",
    });
    await context.close();
  }
});

test("ANL-01 NFR-04: a 200-card study renders the matrix and dendrogram", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await loginAsAdmin(page);
  const id = seedLarge(200);
  const start = Date.now();
  await page.goto(`/admin/studies/${id}/analysis`);
  const matrix = page.getByTestId("similarity-matrix");
  await expect(matrix.getByRole("rowheader")).toHaveCount(199);
  expect(Date.now() - start).toBeLessThan(15_000); // dev server; NFR-04 is measured in vitest
  await matrix.locator('td[tabindex="0"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("cell-tooltip")).toContainText("boards");
  await page.screenshot({ path: "test-results/analysis-200-similarity.png", caret: "initial" });
  await page.getByRole("tab", { name: "Dendrogram" }).click();
  await page.screenshot({ path: "test-results/analysis-200-dendrogram.png", caret: "initial" });
  await context.close();
});

/** A closed study with 24 cards / 5 groups and 30 boards of structured random data. */
function seedLarge(count = 24): string {
  const db = e2eDb();
  const study = makeStudy(db, { sortType: "closed", title: `Intranet navigation ${unique()}` });
  const labels = Array.from(
    { length: count },
    (_, i) =>
      `Topic ${i + 1} ${["policies", "payroll", "holiday booking", "IT support", "canteen menu", "org chart"][i % 6]}`,
  );
  const cards = makeCards(db, study.id, labels);
  const groups = makeGroups(db, study.id, ["HR", "Finance", "IT", "Facilities", "About us"]);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let b = 0; b < 30; b++) {
    const board = makeBoard(db, study.id, done());
    cards.forEach((card, i) => {
      if (rand() < 0.05) return;
      const home = i % 5;
      const g = rand() < 0.7 ? home : Math.floor(rand() * 5);
      place(db, board.id, card.id, groups[g].id, i);
    });
  }
  return study.id;
}
