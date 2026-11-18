// Participant entry pages: intro, details form, board creation and resume (stream F2).
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { boards } from "../../src/server/db/schema";
import { e2eDb, makeCards, makeStudy } from "./helpers";

const boardsOf = (studyId: string) => e2eDb().select().from(boards).where(eq(boards.studyId, studyId)).all();

const boardUrl = (slug: string) => new RegExp(`/s/${slug}/b/([A-Za-z0-9_-]+)$`);

async function tokenFromUrl(page: Page, slug: string): Promise<string> {
  await expect(page).toHaveURL(boardUrl(slug));
  return page.url().match(boardUrl(slug))![1];
}

test("PART-01: a live study shows the intro with title, instructions and Start", async ({ page }) => {
  const study = makeStudy(e2eDb(), { title: "Intranet navigation", instructions: "Sort the cards." });
  await page.goto(`/s/${study.slug}`);
  await expect(page.getByRole("heading", { name: "Intranet navigation" })).toBeVisible();
  await expect(page.getByText("Sort the cards.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
});

for (const status of ["draft", "closed"] as const) {
  test(`PART-01: a ${status} study is not accepting responses`, async ({ page }) => {
    const study = makeStudy(e2eDb(), { status, title: `A ${status} study` });
    await page.goto(`/s/${study.slug}`);
    await expect(
      page.getByRole("heading", { name: "This study is not currently accepting responses" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
  });
}

test("PART-01: an unknown study link shows a friendly not-found page", async ({ page }) => {
  const res = await page.goto("/s/does-not-exist-123");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /couldn.t find this study/ })).toBeVisible();
});

test("PFLD-02: required and invalid email errors are shown", async ({ page }) => {
  const study = makeStudy(e2eDb(), {
    participantFields: [
      { key: "name", mode: "required" },
      { key: "email", mode: "required" },
    ],
  });
  await page.goto(`/s/${study.slug}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Start sorting" }).click();
  await expect(page.getByText("Name is required")).toBeVisible();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeFocused();
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  expect(boardsOf(study.id)).toHaveLength(0);
});

test("PART-02 PFLD-02 PFLD-04: valid details create a board with the answers and open its URL", async ({
  page,
}) => {
  const db = e2eDb();
  const study = makeStudy(db, {
    participantFields: [
      { key: "name", mode: "required" },
      { key: "email", mode: "optional" },
      { key: "gender", mode: "optional" },
      { key: "country", mode: "required" },
      { key: "custom_team", label: "Which team are you in?", mode: "optional" },
    ],
  });
  makeCards(db, study.id, ["Payroll", "Holidays"]);
  await page.goto(`/s/${study.slug}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Gender").selectOption({ label: "Prefer to self-describe" });
  await page.getByLabel("Please describe your gender").fill("Agender");
  await page.getByLabel("Country of residence").selectOption("GB");
  await page.getByLabel("Which team are you in?").fill("Platform");
  await page.getByRole("button", { name: "Start sorting" }).click();

  const token = await tokenFromUrl(page, study.slug);
  const rows = boardsOf(study.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].token).toBe(token);
  expect(rows[0].participant).toEqual({
    name: "Ada Lovelace",
    email: "ada@example.com",
    gender: "self_describe",
    genderSelfDescribe: "Agender",
    country: "GB",
    custom_team: "Platform",
  });
});

test("PFLD-05: a study with no fields skips the details form", async ({ page }) => {
  const study = makeStudy(e2eDb(), { participantFields: [] });
  await page.goto(`/s/${study.slug}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const token = await tokenFromUrl(page, study.slug);
  const rows = boardsOf(study.id);
  expect(rows.map((r) => r.token)).toEqual([token]);
  expect(rows[0].participant).toEqual({});
});

test("PART-03: revisiting the study link offers to continue or start a new sort", async ({ page }) => {
  const study = makeStudy(e2eDb(), { participantFields: [] });
  await page.goto(`/s/${study.slug}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const firstToken = await tokenFromUrl(page, study.slug);

  await page.goto(`/s/${study.slug}`);
  await page.getByRole("link", { name: "Continue where you left off" }).click();
  expect(await tokenFromUrl(page, study.slug)).toBe(firstToken);

  await page.goto(`/s/${study.slug}`);
  await page.getByRole("button", { name: "Start a new sort" }).click();
  await expect(page).not.toHaveURL(new RegExp(`/b/${firstToken}$`));
  const secondToken = await tokenFromUrl(page, study.slug);
  expect(secondToken).not.toBe(firstToken);
  expect(boardsOf(study.id)).toHaveLength(2);

  // The newest board is the one offered next time.
  await page.goto(`/s/${study.slug}`);
  await expect(page.getByRole("link", { name: "Continue where you left off" })).toHaveAttribute(
    "href",
    `/s/${study.slug}/b/${secondToken}`,
  );
});

test("PART-03: a stored token whose board was deleted is dropped", async ({ page }) => {
  const study = makeStudy(e2eDb(), { participantFields: [] });
  await page.goto(`/s/${study.slug}`);
  await page.evaluate((slug) => localStorage.setItem(`cardsort:board:${slug}`, "deleted-board-token-xyz"), study.slug);
  await page.reload();
  await expect
    .poll(() => page.evaluate((slug) => localStorage.getItem(`cardsort:board:${slug}`), study.slug))
    .toBeNull();
  await expect(page.getByRole("link", { name: "Continue where you left off" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
});
