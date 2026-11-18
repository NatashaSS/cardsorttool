import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { boards, studies } from "../../src/server/db/schema";
import { e2eDb, makeBoard, makeCards, makeGroups, makeStudy, type StudyOverrides } from "./helpers";

type Seed = { slug: string; token: string; url: string; studyId: string };

/** A live study with cards (+ predefined groups for closed/hybrid) and one board. */
function seed(
  opts: StudyOverrides & {
    cards?: string[];
    groups?: string[];
    participant?: Record<string, string>;
  } = {},
): Seed {
  const {
    cards: labels = ["Apples", "Carrots", "Bananas"],
    groups: groupNames,
    participant,
    ...study
  } = opts;
  const db = e2eDb();
  const s = makeStudy(db, { sortType: "closed", ...study });
  const cards = makeCards(db, s.id, labels);
  const names = groupNames ?? (s.sortType === "open" ? [] : ["Fruit", "Vegetables"]);
  makeGroups(db, s.id, names);
  const b = makeBoard(db, s.id, {
    cardOrder: cards.map((c) => c.id),
    participant: participant ?? { name: "Ada Lovelace" },
  });
  return { slug: s.slug, token: b.token, url: `/s/${s.slug}/b/${b.token}`, studyId: s.id };
}

const card = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });
const group = (page: Page, name: string) => page.getByRole("region", { name: `Group ${name}` });
const tray = (page: Page) => page.getByTestId("tray");
const saved = (page: Page) =>
  expect(page.getByTestId("save-status")).toHaveText(/All changes saved/);

/** Navigate and wait until React has hydrated the board (drag/keyboard handlers attached). */
async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("board")).toHaveAttribute("data-hydrated", "true");
}

async function reload(page: Page) {
  await page.reload();
  await expect(page.getByTestId("board")).toHaveAttribute("data-hydrated", "true");
}

/** dnd-kit's pointer sensor needs intermediate moves to activate and track the drag. */
async function drag(page: Page, source: Locator, target: Locator) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("drag: element not visible");
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  const tx = t.x + t.width / 2;
  const ty = t.y + Math.min(t.height / 2, 60);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 16 });
  await page.mouse.move(tx + 2, ty + 2, { steps: 2 });
  await page.mouse.up();
}

test.describe("participant board", () => {
  test("BRD-01: shows the participant note, instructions, groups and the unsorted tray", async ({
    page,
  }) => {
    const s = seed({
      participant: { name: "Ada Lovelace", role: "Engineer", organisation: "Analytical Ltd" },
      participantFields: [
        { key: "name", mode: "required" },
        { key: "role", mode: "optional" },
        { key: "organisation", mode: "optional" },
      ],
    });
    await open(page, s.url);
    const note = page.getByTestId("participant-note");
    await expect(note).toContainText("Ada Lovelace");
    await expect(note).toContainText("Engineer");
    await expect(note).toContainText("Analytical Ltd");
    await expect(page.getByTestId("instructions")).toHaveText(/Please add the cards to groups/);
    await expect(group(page, "Fruit")).toBeVisible();
    await expect(within(tray(page), "Apples")).toBeVisible();
  });

  test("BRD-01: narrow screens get a 'please use a larger screen' notice", async ({ page }) => {
    const s = seed();
    await page.setViewportSize({ width: 800, height: 900 });
    await open(page, s.url);
    await expect(page.getByText("Please use a larger screen")).toBeVisible();
    await expect(page.getByTestId("board")).toBeHidden();
  });

  test("SAVE-01 / SAVE-02 / BRD-02 / BRD-08: dragging a card into a group is saved and survives a reload", async ({
    page,
  }) => {
    const s = seed();
    await open(page, s.url);
    await expect(page.getByTestId("progress")).toHaveText("0 of 3 cards sorted");

    await drag(page, card(page, "Apples"), group(page, "Fruit"));
    await expect(within(group(page, "Fruit"), "Apples")).toBeVisible();
    await expect(page.getByTestId("progress")).toHaveText("1 of 3 cards sorted");
    await saved(page);

    await drag(page, card(page, "Bananas"), group(page, "Fruit"));
    await drag(page, card(page, "Carrots"), group(page, "Vegetables"));
    await saved(page);
    await expect(page.getByTestId("progress")).toHaveText("3 of 3 cards sorted");

    await reload(page);
    await expect(within(group(page, "Fruit"), "Apples")).toBeVisible();
    await expect(within(group(page, "Fruit"), "Bananas")).toBeVisible();
    await expect(within(group(page, "Vegetables"), "Carrots")).toBeVisible();
    await expect(page.getByTestId("progress")).toHaveText("3 of 3 cards sorted");

    // Between groups and back to the tray.
    await drag(page, card(page, "Bananas"), group(page, "Vegetables"));
    await drag(page, card(page, "Apples"), tray(page));
    await saved(page);
    await reload(page);
    await expect(within(group(page, "Vegetables"), "Bananas")).toBeVisible();
    await expect(within(tray(page), "Apples")).toBeVisible();
    await expect(page.getByTestId("progress")).toHaveText("2 of 3 cards sorted");
  });

  test("BRD-02: reorders cards within a group", async ({ page }) => {
    const s = seed();
    await open(page, s.url);
    await drag(page, card(page, "Apples"), group(page, "Fruit"));
    await drag(page, card(page, "Bananas"), group(page, "Fruit"));
    await saved(page);
    const labels = () =>
      group(page, "Fruit")
        .locator("[data-card-id] [aria-roledescription]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    const before = await labels();
    expect(before).toHaveLength(2);
    await drag(page, card(page, before[1]!), card(page, before[0]!));
    await saved(page);
    await expect.poll(labels).toEqual([before[1], before[0]]);
    await reload(page);
    await expect.poll(labels).toEqual([before[1], before[0]]);
  });

  test("BRD-03: a card can be moved with the keyboard", async ({ page }) => {
    const s = seed();
    await open(page, s.url);
    await card(page, "Apples").focus();
    await page.keyboard.press("Space");
    await expect(card(page, "Apples")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByText(/Card Apples is over group/)).toBeAttached();
    await page.keyboard.press("Space");
    await expect(page.getByText(/Card Apples was dropped in group/)).toBeAttached();
    await expect(page.getByTestId("progress")).toHaveText("1 of 3 cards sorted");
    await saved(page);
  });

  test("BRD-05 / BRD-06 / BRD-07: open sort — add, rename and delete groups", async ({ page }) => {
    const s = seed({ sortType: "open" });
    await open(page, s.url);

    await page.getByRole("button", { name: "+ New group" }).click();
    const name = page.getByLabel("Group name");
    await expect(name).toBeFocused();
    await name.fill("Tools");
    await name.press("Enter");
    await expect(group(page, "Tools")).toBeVisible();
    await saved(page);

    // BRD-07: drop onto the new-group zone creates a group containing the card.
    await drag(page, card(page, "Apples"), page.getByTestId("new-group-drop"));
    await expect(page.getByLabel("Group name")).toHaveCount(2);
    await expect(page.getByLabel("Group name").nth(1)).toBeFocused();
    await page.getByLabel("Group name").nth(1).fill("Fruit");
    await page.getByLabel("Group name").nth(1).press("Enter");
    await expect(within(group(page, "Fruit"), "Apples")).toBeVisible();
    await saved(page);

    await reload(page);
    await expect(page.getByLabel("Group name").nth(0)).toHaveValue("Tools");
    await expect(within(group(page, "Fruit"), "Apples")).toBeVisible();

    // Rename.
    await page.getByLabel("Group name").nth(0).fill("Hardware");
    await page.getByLabel("Group name").nth(0).press("Enter");
    await saved(page);

    // Delete a non-empty group: confirmation; its cards go back to the tray.
    await page.getByRole("button", { name: "Delete group Fruit" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("1 card will go back to the unsorted cards");
    await dialog.getByRole("button", { name: "Delete group" }).click();
    await expect(group(page, "Fruit")).toHaveCount(0);
    await expect(within(tray(page), "Apples")).toBeVisible();

    // Delete an empty group: no confirmation.
    await page.getByRole("button", { name: "Delete group Hardware" }).click();
    await expect(group(page, "Hardware")).toHaveCount(0);
    await saved(page);

    await reload(page);
    await expect(page.getByLabel("Group name")).toHaveCount(0);
    await expect(page.getByTestId("progress")).toHaveText("0 of 3 cards sorted");
  });

  test("BRD-06: closed sorts show no add/rename/delete group controls", async ({ page }) => {
    const s = seed();
    await open(page, s.url);
    await expect(group(page, "Fruit")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New group" })).toHaveCount(0);
    await expect(page.getByLabel("Group name")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Delete group/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Add card" })).toHaveCount(0);
  });

  test("PERM-01 / PERM-02: participants add, edit and delete their own cards when allowed", async ({
    page,
  }) => {
    const s = seed({ settings: { allowParticipantCards: true } });
    await open(page, s.url);
    await page.getByRole("button", { name: "+ Add card" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Label").fill("Tomatoes");
    await dialog.getByLabel("Description").fill("Fruit or vegetable?");
    await dialog.getByRole("button", { name: "Add card" }).click();
    await expect(within(tray(page), "Tomatoes")).toBeVisible();
    await expect(tray(page)).toContainText("Your card");
    await expect(page.getByTestId("progress")).toHaveText("0 of 4 cards sorted");
    await saved(page);

    await reload(page);
    await expect(within(tray(page), "Tomatoes")).toBeVisible();
    // PERM-09: description on hover.
    await card(page, "Tomatoes").hover();
    await expect(page.getByRole("tooltip")).toHaveText("Fruit or vegetable?");

    await page.getByRole("button", { name: "Edit card Tomatoes" }).click();
    await page.getByRole("dialog").getByLabel("Label").fill("Cherry tomatoes");
    await page.getByRole("dialog").getByRole("button", { name: "Save card" }).click();
    await expect(within(tray(page), "Cherry tomatoes")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit card Apples" })).toHaveCount(0);

    await page.getByRole("button", { name: "Delete card Cherry tomatoes" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete card" }).click();
    await expect(card(page, "Cherry tomatoes")).toHaveCount(0);
    await saved(page);
    await reload(page);
    await expect(page.getByTestId("progress")).toHaveText("0 of 3 cards sorted");
  });

  test("DONE-01: completion is disabled with an explanation while cards are unsorted (PERM-05)", async ({
    page,
  }) => {
    const s = seed({ settings: { requireAllSorted: true }, cards: ["Apples"] });
    await open(page, s.url);
    const button = page.getByRole("button", { name: "Complete card sort" });
    await expect(button).toBeDisabled();
    await expect(page.getByTestId("completion-blockers")).toHaveText(
      "Sort all cards before completing (1 card left).",
    );
    await drag(page, card(page, "Apples"), group(page, "Fruit"));
    await expect(button).toBeEnabled();
    await expect(page.getByTestId("completion-blockers")).toHaveCount(0);
  });

  test("DONE-02 / DONE-03 / PART-05: confirm, cancel, complete with a thank-you in the same modal, then read-only", async ({
    page,
  }) => {
    const s = seed();
    await open(page, s.url);
    await drag(page, card(page, "Apples"), group(page, "Fruit"));
    await saved(page);

    const complete = page.getByRole("button", { name: "Complete card sort" });
    const dialog = page.getByRole("dialog");

    await complete.click();
    await expect(dialog.getByRole("heading", { name: "Complete your card sort?" })).toBeVisible();
    await expect(dialog).toContainText("You won't be able to make changes afterwards.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await complete.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await complete.click();
    await page.mouse.click(5, 5); // backdrop
    await expect(dialog).toHaveCount(0);

    await complete.click();
    const handle = await dialog.elementHandle();
    await dialog.getByRole("button", { name: "Yes, complete" }).click();
    await expect(dialog.getByRole("heading", { name: "Thank you!" })).toBeVisible();
    // Same dialog element, content swapped (not closed and reopened).
    expect(
      await handle?.evaluate((el) => el.isConnected && el.textContent?.includes("Thank you")),
    ).toBe(true);
    await expect(page.getByTestId("readonly-banner")).toHaveText(
      "You have completed this card sort — thank you.",
    );
    await dialog.getByRole("button", { name: "Close" }).click();

    await reload(page);
    await expect(page.getByTestId("readonly-banner")).toHaveText(
      "You have completed this card sort — thank you.",
    );
    await expect(complete).toHaveCount(0);
    await expect(within(group(page, "Fruit"), "Apples", true)).toBeVisible();
    await expect(page.locator('[aria-roledescription="sortable"]')).toHaveCount(0);

    const db = e2eDb();
    const row = db.select().from(boards).where(eq(boards.token, s.token)).get();
    expect(row?.status).toBe("completed");
  });

  test("PART-06: a board of a closed study is read-only with a closed message", async ({
    page,
  }) => {
    const s = seed();
    e2eDb().update(studies).set({ status: "closed" }).where(eq(studies.id, s.studyId)).run();
    await open(page, s.url);
    await expect(page.getByTestId("readonly-banner")).toContainText("This study has been closed");
    await expect(page.getByRole("button", { name: "Complete card sort" })).toHaveCount(0);
    await expect(page.locator('[aria-roledescription="sortable"]')).toHaveCount(0);
  });

  test("SAVE-03: a stale tab reloads the latest state and tells the user", async ({ context }) => {
    const s = seed();
    const a = await context.newPage();
    const b = await context.newPage();
    await open(a, s.url);
    await open(b, s.url);

    await drag(a, card(a, "Apples"), group(a, "Fruit"));
    await saved(a);

    await drag(b, card(b, "Carrots"), group(b, "Vegetables"));
    await expect(b.getByTestId("board-notice")).toContainText("changed in another tab");
    await saved(b);
    // B now shows A's change and its own rejected change is gone.
    await expect(within(group(b, "Fruit"), "Apples")).toBeVisible();
    await expect(within(tray(b), "Carrots")).toBeVisible();

    // B can continue editing with the fresh revision.
    await drag(b, card(b, "Carrots"), group(b, "Vegetables"));
    await saved(b);
    await reload(b);
    await expect(within(group(b, "Vegetables"), "Carrots")).toBeVisible();
    await expect(within(group(b, "Fruit"), "Apples")).toBeVisible();
  });

  test("PART-04: unknown tokens and mismatched slugs are 404", async ({ page }) => {
    const s = seed();
    const res = await page.goto(`/s/${s.slug}/b/not-a-real-token`);
    expect(res?.status()).toBe(404);
    const other = seed();
    const res2 = await page.goto(`/s/${other.slug}/b/${s.token}`);
    expect(res2?.status()).toBe(404);
  });
});

/** A card (by label) inside a container. Read-only cards aren't buttons. */
function within(container: Locator, label: string, readOnly = false): Locator {
  return readOnly
    ? container.locator("[data-card-id]", { hasText: label })
    : container.getByRole("button", { name: label, exact: true });
}
