// Stream J: cross-cutting journeys, one per sort type / group mode, each from a published study
// through a participant's sort and completion to the admin's results and analysis pages.
// The admin side is set up through the admin API (the editor UI has its own spec); the
// participant drives the real board UI.
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { placements } from "../../src/server/db/schema";
import {
  boardRow,
  boardState,
  card,
  checkAdminSide,
  completeButton,
  completeSort,
  createLiveStudy,
  drag,
  group,
  hydrated,
  joinStudy,
  rawOp,
  saved,
  setStudyStatus,
  sortInto,
  tray,
  unique,
  within,
} from "./journey-helpers";
import { e2eDb, loginAsAdmin, makeBoard, makeCards, makeGroups, makeStudy, place } from "./helpers";

const blockers = (page: Page) => page.getByTestId("completion-blockers");
/** SAVE-04 / BRD-06: the server rejects ops the study's permissions don't allow. */
async function expectForbidden(res: APIResponse) {
  expect(res.status(), await res.text()).toBe(403);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
}
/** Values of the editable group-name inputs, in board order. */
const groupNames = (page: Page) =>
  page.getByLabel("Group name").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("STU-05 PERM-03 PERM-06 RES-01 RES-02 ANL-01: open-fixed journey — placeholders, renaming, naming block, completion", async ({
  page,
  browser,
}) => {
  const study = await createLiveStudy(page.request, {
    sortType: "open",
    groupMode: "fixed",
    fixedGroupCount: 3,
    cards: ["Apples", "Bananas", "Hammer", "Saw"],
  });
  const { context, page: p, token } = await joinStudy(browser, study.shareUrl!, "Fixed Fiona");

  // STU-05: exactly N placeholder groups named "Group 1"…"Group N"; no add/delete controls.
  await expect(p.getByLabel("Group name")).toHaveCount(3);
  await expect.poll(() => groupNames(p)).toEqual(["Group 1", "Group 2", "Group 3"]);
  for (const n of [1, 2, 3]) await expect(group(p, `Group ${n}`)).toBeVisible();
  await expect(p.getByRole("button", { name: "+ New group" })).toHaveCount(0);
  await expect(p.getByTestId("new-group-drop")).toHaveCount(0);
  await expect(p.getByRole("button", { name: /^Delete group/ })).toHaveCount(0);
  // The server agrees: no groups can be added to a fixed sort.
  const add = await rawOp(p, token, { type: "addGroup", groupId: "extragroup01", name: "Extra" });
  await expectForbidden(add);

  await sortInto(p, "Apples", group(p, "Group 1"));
  await sortInto(p, "Hammer", group(p, "Group 2"));

  // PERM-06: non-empty placeholders with their default names block completion (empty Group 3
  // doesn't count).
  await expect(completeButton(p)).toBeDisabled();
  await expect(blockers(p)).toHaveText("Give every group a name (2 groups still unnamed).");

  // PERM-03: placeholders can be renamed.
  const names = p.getByLabel("Group name");
  await names.nth(0).fill("Fruit");
  await names.nth(0).press("Enter");
  await expect(group(p, "Fruit")).toBeVisible();
  await expect(blockers(p)).toHaveText("Give every group a name (1 group still unnamed).");
  await names.nth(1).fill("Tools");
  await names.nth(1).press("Enter");
  await expect(group(p, "Tools")).toBeVisible();
  await saved(p);
  await expect(blockers(p)).toHaveCount(0);

  await sortInto(p, "Bananas", group(p, "Fruit"));
  await sortInto(p, "Saw", group(p, "Tools"));

  // Renames survived a reload (SAVE-01).
  await p.reload();
  await hydrated(p);
  await expect.poll(() => groupNames(p)).toEqual(["Fruit", "Tools", "Group 3"]);

  await completeSort(p);
  await context.close();

  await checkAdminSide(page, study.id, "Fixed Fiona", {
    expectGroups: { Fruit: ["Apples", "Bananas"], Tools: ["Hammer", "Saw"] },
    sorted: "4 / 4 sorted",
    n: 1,
  });
  // ANL-04: the participant's group names appear in the overview.
  await page.getByRole("tab", { name: "Group names" }).click();
  await expect(page.getByTestId("group-names")).toContainText("Fruit");
  await expect(page.getByTestId("group-names")).toContainText("Tools");
});

test("STU-06 PERM-01 PERM-02 BRD-05 BRD-07 BRD-08 ANL-05 RES-02: open-unbounded journey — own cards, drop-to-create group, group limit", async ({
  page,
  browser,
}) => {
  const study = await createLiveStudy(page.request, {
    sortType: "open",
    groupMode: "unbounded",
    maxParticipantGroups: 2,
    cards: ["Apples", "Hammer"],
    settings: { allowParticipantCards: true },
  });
  const { context, page: p, token } = await joinStudy(browser, study.shareUrl!, "Unbounded Uma");
  await expect(p.getByLabel("Group name")).toHaveCount(0);
  await expect(p.getByTestId("progress")).toHaveText("0 of 2 cards sorted");

  // PERM-01: add a card of their own; it starts in the tray and counts towards Y (BRD-08).
  await p.getByRole("button", { name: "+ Add card" }).click();
  const cardDialog = p.getByRole("dialog");
  await cardDialog.getByLabel("Label").fill("Nails");
  await cardDialog.getByRole("button", { name: "Add card" }).click();
  await expect(within(tray(p), "Nails")).toBeVisible();
  await expect(tray(p)).toContainText("Your card");
  await expect(p.getByTestId("progress")).toHaveText("0 of 3 cards sorted");
  await saved(p);

  // BRD-05: "+ New group" focuses the new group's name input.
  await p.getByRole("button", { name: "+ New group" }).click();
  const firstName = p.getByLabel("Group name");
  await expect(firstName).toBeFocused();
  await firstName.fill("Fruit");
  await firstName.press("Enter");
  await sortInto(p, "Apples", group(p, "Fruit"));

  // BRD-07: dropping a card on the "new group" zone creates a group containing it.
  await drag(p, card(p, "Hammer"), p.getByTestId("new-group-drop"));
  await expect(p.getByLabel("Group name")).toHaveCount(2);
  const second = p.getByLabel("Group name").nth(1);
  await expect(second).toBeFocused();
  await second.fill("Tools");
  await second.press("Enter");
  await expect(within(group(p, "Tools"), "Hammer")).toBeVisible();
  await saved(p);

  // STU-06: the limit (2) is reached — no add control, and the server rejects a third group.
  await expect(p.getByRole("button", { name: "+ New group" })).toHaveCount(0);
  await expect(p.getByTestId("new-group-drop")).toHaveCount(0);
  await expect(p.getByText("You've reached the maximum of 2 groups.")).toBeVisible();
  const third = await rawOp(p, token, { type: "addGroup", groupId: "thirdgroup01", name: "More" });
  await expectForbidden(third);
  expect(await third.text()).toContain("maximum number of groups");
  expect((await boardState(p, token)).groups).toHaveLength(2);

  // PERM-02: own cards are editable, predefined ones are not.
  await expect(p.getByRole("button", { name: "Edit card Nails" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Edit card Apples" })).toHaveCount(0);
  await p.getByRole("button", { name: "Edit card Nails" }).click();
  await p.getByRole("dialog").getByLabel("Label").fill("Nails and screws");
  await p.getByRole("dialog").getByRole("button", { name: "Save card" }).click();
  await expect(within(tray(p), "Nails and screws")).toBeVisible();
  await saved(p);
  const apples = (await boardState(p, token)).cards.find((c) => c.label === "Apples")!;
  const edit = await rawOp(p, token, {
    type: "editCard",
    cardId: apples.id,
    label: "Pears",
    description: null,
  });
  await expectForbidden(edit);

  await sortInto(p, "Nails and screws", group(p, "Tools"));
  await expect(p.getByTestId("progress")).toHaveText("3 of 3 cards sorted");
  await completeSort(p);
  await context.close();

  await checkAdminSide(page, study.id, "Unbounded Uma", {
    expectGroups: { Fruit: ["Apples"], Tools: ["Hammer", "Nails and screws"] },
    sorted: "3 / 3 sorted",
    n: 1,
  });
  // ANL-05: participant-created cards are listed (and excluded from the matrix: 2 cards → 1 row).
  await expect(page.getByTestId("similarity-matrix").getByRole("rowheader")).toHaveCount(1);
  await page.getByRole("tab", { name: /Participant cards/ }).click();
  await expect(page.getByTestId("participant-cards")).toContainText("Nails and screws");
  await expect(page.getByTestId("participant-cards")).toContainText("Tools");
});

test("STU-04 PERM-03 PERM-04 BRD-06 ANL-02 RES-02: hybrid journey — predefined groups are fixed, own groups are editable", async ({
  page,
  browser,
}) => {
  const study = await createLiveStudy(page.request, {
    sortType: "hybrid",
    cards: ["Apples", "Carrots", "Hammer"],
    groups: ["Fruit", "Vegetables"],
  });
  const { context, page: p, token } = await joinStudy(browser, study.shareUrl!, "Hybrid Hal");

  // Predefined groups: shown by name, not renamable or deletable.
  await expect(group(p, "Fruit")).toBeVisible();
  await expect(group(p, "Vegetables")).toBeVisible();
  await expect(p.getByLabel("Group name")).toHaveCount(0);
  await expect(p.getByRole("button", { name: /^Delete group/ })).toHaveCount(0);

  // Own group next to them.
  await p.getByRole("button", { name: "+ New group" }).click();
  await p.getByLabel("Group name").fill("Tools");
  await p.getByLabel("Group name").press("Enter");
  await expect(group(p, "Tools")).toBeVisible();
  await expect(p.getByLabel("Group name")).toHaveCount(1);
  await expect(p.getByRole("button", { name: "Delete group Tools" })).toBeVisible();

  await sortInto(p, "Apples", group(p, "Fruit"));
  await sortInto(p, "Carrots", group(p, "Vegetables"));
  await sortInto(p, "Hammer", group(p, "Tools"));

  // The server refuses to rename or delete a predefined group.
  const fruit = (await boardState(p, token)).groups.find((g) => g.name === "Fruit")!;
  expect(fruit.kind).toBe("predefined");
  for (const op of [
    { type: "renameGroup", groupId: fruit.id, name: "Produce" },
    { type: "deleteGroup", groupId: fruit.id },
  ]) {
    const res = await rawOp(p, token, op);
    await expectForbidden(res);
  }
  expect((await boardState(p, token)).groups.map((g) => g.name)).toEqual([
    "Fruit",
    "Vegetables",
    "Tools",
  ]);

  await completeSort(p);
  await context.close();

  await checkAdminSide(page, study.id, "Hybrid Hal", {
    expectGroups: { Fruit: ["Apples"], Vegetables: ["Carrots"], Tools: ["Hammer"] },
    sorted: "3 / 3 sorted",
    n: 1,
  });
  // ANL-02: hybrid placement matrix has the predefined groups plus "Other".
  await page.getByRole("tab", { name: "Placement matrix" }).click();
  const placement = page.getByTestId("placement-matrix");
  await expect(placement).toContainText("Other");
  await expect(
    placement.getByRole("row").filter({ hasText: "Apples" }).locator("td[data-top]"),
  ).toHaveText("100%");
});

test("STU-04 PERM-05 PERM-07 DONE-01 DONE-05 RES-01 ANL-02: closed journey — all cards must be sorted; predefined groups may stay empty", async ({
  page,
  browser,
}) => {
  const study = await createLiveStudy(page.request, {
    sortType: "closed",
    cards: ["Apples", "Carrots"],
    groups: ["Fruit", "Vegetables", "Other"],
    settings: { requireAllSorted: true, allowEmptyGroups: false },
  });
  const { context, page: p, token } = await joinStudy(browser, study.shareUrl!, "Closed Cleo");
  await expect(p.getByRole("button", { name: "+ New group" })).toHaveCount(0);

  // PERM-05: disabled with an explanation; the server also refuses (DONE-05).
  await expect(completeButton(p)).toBeDisabled();
  await expect(blockers(p)).toHaveText("Sort all cards before completing (2 cards left).");
  const early = await p.request.post(`/api/boards/${token}/complete`);
  expect(early.status()).toBe(422);

  await sortInto(p, "Apples", group(p, "Fruit"));
  await expect(blockers(p)).toHaveText("Sort all cards before completing (1 card left).");
  await sortInto(p, "Carrots", group(p, "Vegetables"));

  // PERM-07 off only concerns participant/placeholder groups: empty predefined "Other" is fine.
  await expect(within(group(p, "Other"), "Apples")).toHaveCount(0);
  await expect(blockers(p)).toHaveCount(0);
  await completeSort(p);
  await context.close();

  await checkAdminSide(page, study.id, "Closed Cleo", {
    expectGroups: { Fruit: ["Apples"], Vegetables: ["Carrots"] },
    sorted: "2 / 2 sorted",
    n: 1,
  });
  await page.getByRole("tab", { name: "Placement matrix" }).click();
  const carrots = page
    .getByTestId("placement-matrix")
    .getByRole("row")
    .filter({ hasText: "Carrots" });
  await expect(carrots.locator("td[data-top]")).toHaveText("100%");
});

test("PERM-07: with empty groups disallowed, an empty own group blocks completion in a hybrid sort", async ({
  page,
  browser,
}) => {
  const study = await createLiveStudy(page.request, {
    sortType: "hybrid",
    cards: ["Apples"],
    groups: ["Fruit", "Vegetables"],
    settings: { allowEmptyGroups: false },
  });
  const { context, page: p } = await joinStudy(browser, study.shareUrl!, "Empty Emil");
  await sortInto(p, "Apples", group(p, "Fruit"));
  await expect(completeButton(p)).toBeEnabled(); // empty predefined "Vegetables" is allowed

  await p.getByRole("button", { name: "+ New group" }).click();
  await p.getByLabel("Group name").fill("Spare");
  await p.getByLabel("Group name").press("Enter");
  await saved(p);
  await expect(completeButton(p)).toBeDisabled();
  await expect(blockers(p)).toHaveText("Remove or fill empty groups (1 empty).");

  await p.getByRole("button", { name: "Delete group Spare" }).click();
  await expect(group(p, "Spare")).toHaveCount(0);
  await saved(p);
  await completeSort(p);
  await context.close();
});

test("PART-06: closing a study mid-sort freezes the open board; reopening makes it editable again", async ({
  page,
  browser,
}) => {
  const study = await createLiveStudy(page.request, {
    sortType: "closed",
    cards: ["Apples", "Carrots"],
    groups: ["Fruit", "Vegetables"],
  });
  const { context, page: p, token } = await joinStudy(browser, study.shareUrl!, "Paused Pat");
  await sortInto(p, "Apples", group(p, "Fruit"));

  // The admin closes the study while the participant's board is open.
  await setStudyStatus(page.request, study.id, "closed");

  // The next change is rejected by the server; the board reloads read-only with the message.
  await drag(p, card(p, "Carrots"), group(p, "Vegetables"));
  await expect(p.getByTestId("readonly-banner")).toHaveText(
    "This study has been closed. Your board can no longer be changed.",
  );
  await expect(p.locator('[aria-roledescription="sortable"]')).toHaveCount(0);
  await expect(completeButton(p)).toHaveCount(0);
  await expect(within(tray(p), "Carrots", true)).toBeVisible();
  await expect(within(group(p, "Fruit"), "Apples", true)).toBeVisible();
  const state = await boardState(p, token);
  expect(state.study.status).toBe("closed");
  expect(state.unsortedCardIds).toHaveLength(1);
  const direct = await rawOp(p, token, {
    type: "moveCard",
    cardId: state.unsortedCardIds[0],
    toGroupId: null,
    toIndex: 0,
  });
  expect(direct.status()).toBe(409);

  // Reopening (closed → live) makes the board editable again.
  await setStudyStatus(page.request, study.id, "live");
  await p.reload();
  await hydrated(p);
  await expect(p.getByTestId("readonly-banner")).toHaveCount(0);
  await sortInto(p, "Carrots", group(p, "Vegetables"));
  await p.reload();
  await hydrated(p);
  await expect(within(group(p, "Vegetables"), "Carrots")).toBeVisible();
  await completeSort(p);
  await context.close();
});

test("RES-03 ANL-01: excluding a board from the list removes it from the analysis n; including restores it", async ({
  page,
}) => {
  const db = e2eDb();
  const study = makeStudy(db, { sortType: "closed", title: `Exclusion ${unique()}` });
  const [a, b] = makeCards(db, study.id, ["Apples", "Bananas"]);
  const [fruit, other] = makeGroups(db, study.id, ["Fruit", "Other"]);
  const done = { status: "completed" as const, completedAt: new Date().toISOString() };
  const keep = makeBoard(db, study.id, { ...done, participant: { name: "Kept Kim" } });
  place(db, keep.id, a.id, fruit.id, 0);
  place(db, keep.id, b.id, fruit.id, 1);
  const test = makeBoard(db, study.id, { ...done, participant: { name: "Test Run" } });
  place(db, test.id, a.id, fruit.id, 0);
  place(db, test.id, b.id, other.id, 0);

  const analysisN = async () => {
    await page.goto(`/admin/studies/${study.id}/analysis`);
    return page.getByTestId("analysis-n");
  };
  await expect(await analysisN()).toHaveText("2");
  await expect(
    page.getByTestId("similarity-matrix").locator("td").filter({ hasText: "50" }),
  ).toHaveCount(1);

  await page.goto(`/admin/studies/${study.id}/boards`);
  await page.getByRole("button", { name: "Exclude board of Test Run" }).click();
  await expect(boardRow(page, "Test Run")).toHaveAttribute("data-excluded", "true");

  await expect(await analysisN()).toHaveText("1");
  await expect(page.getByText("1 excluded board not counted")).toBeVisible();
  await expect(
    page.getByTestId("similarity-matrix").locator("td").filter({ hasText: "100" }),
  ).toHaveCount(1);

  await page.goto(`/admin/studies/${study.id}/boards`);
  await page.getByRole("button", { name: "Include board of Test Run" }).click();
  await expect(boardRow(page, "Test Run")).not.toHaveAttribute("data-excluded", "true");
  await expect(await analysisN()).toHaveText("2");

  // Exclusion never touches the board's data.
  expect(db.select().from(placements).where(eq(placements.boardId, test.id)).all()).toHaveLength(2);
});
