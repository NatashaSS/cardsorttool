// Stream J: cross-browser smoke (NFR-07). Runs in every configured Playwright project —
// Chromium locally; Chromium, Firefox and WebKit in CI (E2E_ALL_BROWSERS=1). Keep it
// browser-agnostic: no Chromium-only permissions or APIs.
import { expect, test } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./fixtures";
import {
  checkAdminSide,
  completeSort,
  createLiveStudy,
  group,
  hydrated,
  joinStudy,
  sortInto,
} from "./journey-helpers";

test("NFR-07: admin login, participant drag-and-drop sort, completion and analysis work in this browser", async ({
  page,
  browser,
  browserName,
}) => {
  test.info().annotations.push({ type: "browser", description: browserName });

  // Admin logs in through the real form.
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const study = await createLiveStudy(page.request, {
    title: `Browser smoke ${browserName} ${Date.now()}`,
    sortType: "hybrid",
    cards: ["Apples", "Carrots"],
    groups: ["Fruit"],
  });

  // Participant: entry form, mouse drag-and-drop, own group, auto-save, completion modal.
  const { context, page: p } = await joinStudy(browser, study.shareUrl!, `Browser ${browserName}`);
  await sortInto(p, "Apples", group(p, "Fruit"));
  await p.getByRole("button", { name: "+ New group" }).click();
  await p.getByLabel("Group name").fill("Veg");
  await p.getByLabel("Group name").press("Enter");
  await sortInto(p, "Carrots", group(p, "Veg"));
  await p.reload();
  await hydrated(p);
  await expect(p.getByTestId("progress")).toHaveText("2 of 2 cards sorted");
  await completeSort(p);
  await context.close();

  await checkAdminSide(page, study.id, `Browser ${browserName}`, {
    expectGroups: { Fruit: ["Apples"], Veg: ["Carrots"] },
    sorted: "2 / 2 sorted",
    n: 1,
  });
});
