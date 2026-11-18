// Integration checkpoint 1 (IMPLEMENTATION_PLAN §4): one journey across every Wave 1 stream.
// Admin (A + C) builds and publishes a study through the real API; a participant (F2 + F1 + D)
// enters, sorts, reloads, and completes; the board is then frozen.
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { StudyDetailDTO } from "../../src/lib/api-types";
import { loginAsAdmin } from "./helpers";

async function drag(page: Page, source: Locator, target: Locator) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("drag: element not visible");
  const [sx, sy] = [s.x + s.width / 2, s.y + s.height / 2];
  const [tx, ty] = [t.x + t.width / 2, t.y + Math.min(t.height / 2, 60)];
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 16 });
  await page.mouse.move(tx + 2, ty + 2, { steps: 2 });
  await page.mouse.up();
}

const card = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });
const group = (page: Page, name: string) => page.getByRole("region", { name: `Group ${name}` });
const saved = (page: Page) => expect(page.getByTestId("save-status")).toHaveText(/All changes saved/);

test("SAVE-01 DONE-04 PART-02: admin publishes a closed study; a participant sorts and completes it", async ({
  page,
  browser,
}) => {
  // --- Admin: create, configure and publish via the admin API --------------------------------
  await loginAsAdmin(page);
  const api = page.request;
  const created = await api.post("/api/admin/studies", {
    data: { title: "Journey: grocery", sortType: "closed" },
  });
  expect(created.status()).toBe(201);
  const study = (await created.json()) as StudyDetailDTO;
  const id = study.id;

  await api.post(`/api/admin/studies/${id}/cards/bulk`, { data: { text: "Apples\nBread\nMilk" } });
  for (const name of ["Fruit", "Bakery", "Dairy"]) {
    await api.post(`/api/admin/studies/${id}/groups`, { data: { name } });
  }
  await api.patch(`/api/admin/studies/${id}`, {
    data: {
      instructions: "Please add the cards to groups where you feel they naturally belong",
      participantFields: [
        { key: "name", mode: "required" },
        { key: "role", mode: "optional" },
      ],
      settings: { ...study.settings, requireAllSorted: true },
    },
  });
  const published = await api.post(`/api/admin/studies/${id}/status`, { data: { status: "live" } });
  expect(published.ok()).toBe(true);
  const shareUrl = ((await published.json()) as StudyDetailDTO).shareUrl;

  // The editor shows the share link for the published study.
  await page.goto(`/admin/studies/${id}`);
  await expect(page.locator(`input[value="${shareUrl}"]`)).toBeVisible();

  // --- Participant: separate browser context (no admin cookie) ------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(new URL(shareUrl).pathname);
  await p.getByRole("button", { name: "Start", exact: true }).click();
  await p.getByLabel("Name").fill("Grace Hopper");
  await p.getByLabel(/Role/).fill("Researcher");
  await p.getByRole("button", { name: "Start sorting" }).click();
  await expect(p).toHaveURL(/\/s\/[a-z0-9]+\/b\/[A-Za-z0-9_-]+$/);
  await expect(p.getByTestId("board")).toHaveAttribute("data-hydrated", "true");
  await expect(p.getByTestId("participant-note")).toContainText("Grace Hopper");
  await expect(p.getByTestId("progress")).toHaveText("0 of 3 cards sorted");

  // PERM-05: completion blocked until everything is sorted.
  await expect(p.getByRole("button", { name: "Complete card sort" })).toBeDisabled();

  await drag(p, card(p, "Apples"), group(p, "Fruit"));
  await saved(p);
  await drag(p, card(p, "Bread"), group(p, "Bakery"));
  await saved(p);

  // Reload: progress was persisted after every move (SAVE-01).
  await p.reload();
  await expect(p.getByTestId("board")).toHaveAttribute("data-hydrated", "true");
  await expect(p.getByTestId("progress")).toHaveText("2 of 3 cards sorted");
  await expect(group(p, "Fruit").getByRole("button", { name: "Apples", exact: true })).toBeVisible();

  await drag(p, card(p, "Milk"), group(p, "Dairy"));
  await saved(p);

  // DONE-02/03: confirm, then thank-you in the same modal.
  await p.getByRole("button", { name: "Complete card sort" }).click();
  const dialog = p.getByRole("dialog");
  await dialog.getByRole("button", { name: "Yes, complete" }).click();
  await expect(dialog.getByRole("heading", { name: "Thank you!" })).toBeVisible();

  // DONE-04: frozen — the API rejects further changes, the page renders read-only.
  const token = new URL(p.url()).pathname.split("/").pop()!;
  const state = await (await p.request.get(`/api/boards/${token}`)).json();
  expect(state.board.status).toBe("completed");
  const op = await p.request.post(`/api/boards/${token}/ops`, {
    data: {
      revision: state.board.revision,
      op: { type: "moveCard", cardId: state.cards[0].id, toGroupId: null, toIndex: 0 },
    },
  });
  expect(op.status()).toBe(409);
  await p.reload();
  await expect(p.getByText(/You have completed this card sort/)).toBeVisible();

  // Admin sees the completed board counted on the study.
  const after = (await (await api.get(`/api/admin/studies/${id}`)).json()) as StudyDetailDTO;
  expect(after.boardCounts).toEqual({ inProgress: 0, completed: 1 });
  await ctx.close();
});
