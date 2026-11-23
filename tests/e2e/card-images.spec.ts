// Stream M: card images (STU-13, BRD-09) from the editor through the participant board to the
// admin's read-only view. Images are generated in code (tests/helpers/card-images.ts).
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { StudyDetailDTO } from "../../src/lib/api-types";
import { SVG_BYTES, makePng } from "../helpers/card-images";
import { loginAsAdmin } from "./helpers";
import {
  boardRow,
  card,
  completeSort,
  group,
  hydrated,
  joinStudy,
  sortInto,
  tray,
  unique,
  within,
} from "./journey-helpers";

const panel = (page: Page) => page.getByRole("tabpanel");

/** The image actually decoded (not a broken-image placeholder). */
async function expectLoaded(img: Locator) {
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

const wide = makePng(48, 24, (x, y) =>
  x < 24 ? [37, 99, 235] : y < 12 ? [251, 191, 36] : [22, 163, 74],
);
const tall = makePng(20, 60, (_x, y) =>
  y < 20 ? [220, 38, 38] : y < 40 ? [255, 255, 255] : [37, 99, 235],
);

test("STU-13 BRD-09: admin adds card images in the editor; participants see and drag them; the read-only view shows them", async ({
  page,
  browser,
}) => {
  await loginAsAdmin(page);
  const created = await page.request.post("/api/admin/studies", {
    data: { title: `Images ${unique()}`, sortType: "closed" },
  });
  expect(created.status()).toBe(201);
  const study = (await created.json()) as StudyDetailDTO;
  const bulk = await page.request.post(`/api/admin/studies/${study.id}/cards/bulk`, {
    data: { text: "Apples\nBananas\nCherries" },
  });
  expect(bulk.ok()).toBe(true);
  expect(
    (
      await page.request.post(`/api/admin/studies/${study.id}/groups`, { data: { name: "Fruit" } })
    ).ok(),
  ).toBe(true);

  await page.goto(`/admin/studies/${study.id}`);
  await page.getByRole("tab", { name: /Cards/ }).click();
  await expect(panel(page).getByTestId("card-label")).toHaveText(["Apples", "Bananas", "Cherries"]);

  // STU-13: upload, see the thumbnail; replace keeps one image with a new URL.
  await expect(panel(page).getByRole("button", { name: "Add image to Apples" })).toBeVisible();
  await panel(page)
    .getByLabel("Image file for Apples")
    .setInputFiles({ name: "apples.png", mimeType: "image/png", buffer: tall });
  const appleThumb = panel(page).getByRole("img", { name: "Image for Apples" });
  await expectLoaded(appleThumb);
  const firstSrc = await appleThumb.getAttribute("src");
  await panel(page)
    .getByLabel("Image file for Apples")
    .setInputFiles({ name: "apples.png", mimeType: "image/png", buffer: wide });
  await expect(appleThumb).not.toHaveAttribute("src", firstSrc!);
  await expectLoaded(appleThumb);

  await panel(page)
    .getByLabel("Image file for Bananas")
    .setInputFiles({ name: "bananas.png", mimeType: "image/png", buffer: tall });
  await expectLoaded(panel(page).getByRole("img", { name: "Image for Bananas" }));

  // STU-13: SVG is rejected — by the editor's pre-check, and by the server when it pretends to be a PNG.
  await panel(page)
    .getByLabel("Image file for Cherries")
    .setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: SVG_BYTES });
  await expect(
    panel(page).getByText(/not a supported image.*PNG, JPEG, WebP or GIF/),
  ).toBeVisible();
  await panel(page)
    .getByLabel("Image file for Cherries")
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: SVG_BYTES });
  await expect(
    panel(page).getByText(/not a supported image.*PNG, JPEG, WebP or GIF/),
  ).toBeVisible();
  await expect(panel(page).getByRole("img", { name: "Image for Cherries" })).toHaveCount(0);

  // Remove, then add back (exercises the Remove control).
  await panel(page).getByRole("button", { name: "Remove image from Bananas" }).click();
  await expect(panel(page).getByRole("img", { name: "Image for Bananas" })).toHaveCount(0);
  await panel(page)
    .getByLabel("Image file for Bananas")
    .setInputFiles({ name: "bananas.png", mimeType: "image/png", buffer: tall });
  await expectLoaded(panel(page).getByRole("img", { name: "Image for Bananas" }));

  await page.screenshot({ path: "test-results/card-images-editor.png" });

  // Persisted across a reload.
  await page.reload();
  await page.getByRole("tab", { name: /Cards/ }).click();
  await expectLoaded(panel(page).getByRole("img", { name: "Image for Apples" }));

  // STU-03: publishing locks the image controls but keeps the thumbnails.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByTestId("status-badge")).toHaveText("Live");
  await page.getByRole("tab", { name: /Cards/ }).click();
  await expect(panel(page).getByRole("button", { name: /image/i })).toHaveCount(0);
  await expect(panel(page).getByLabel("Image file for Apples")).toHaveCount(0);
  await expectLoaded(panel(page).getByRole("img", { name: "Image for Apples" }));
  const shareUrl = await page.getByLabel("Participant link").inputValue();

  // BRD-09: the participant sees images on the cards (alt = label, lazy) and can drag them.
  const p = await joinStudy(browser, shareUrl, "Ivy");
  const apples = card(p.page, "Apples");
  const appleImg = apples.getByRole("img", { name: "Apples" });
  await expectLoaded(appleImg);
  await expect(appleImg).toHaveAttribute("loading", "lazy");
  await expectLoaded(card(p.page, "Bananas").getByRole("img", { name: "Bananas" }));
  await expect(card(p.page, "Cherries").getByRole("img")).toHaveCount(0);
  await p.page.screenshot({ path: "test-results/card-images-tray.png" });
  // The accessible name of the card stays its label.
  await expect(within(tray(p.page), "Apples")).toBeVisible();

  const fruit = group(p.page, "Fruit");
  await sortInto(p.page, "Apples", fruit);
  await expectLoaded(within(fruit, "Apples").getByRole("img", { name: "Apples" }));
  await sortInto(p.page, "Bananas", fruit);
  // Let the drop animation finish before the screenshot.
  await expect(p.page.locator(".rotate-2")).toHaveCount(0);
  await p.page.screenshot({ path: "test-results/card-images-board.png" });
  await sortInto(p.page, "Cherries", fruit);
  await completeSort(p.page);
  await p.context.close();

  // BRD-09: the admin read-only view shows the image too.
  await page.goto(`/admin/studies/${study.id}/boards`);
  await boardRow(page, "Ivy").getByRole("link", { name: "View board of Ivy" }).click();
  await hydrated(page);
  await expectLoaded(
    within(group(page, "Fruit"), "Apples", true).getByRole("img", { name: "Apples" }),
  );
});

test("BRD-09: a card whose image fails to load falls back to its label", async ({
  page,
  browser,
}) => {
  await loginAsAdmin(page);
  const created = await page.request.post("/api/admin/studies", {
    data: { title: `Broken image ${unique()}`, sortType: "open" },
  });
  const study = (await created.json()) as StudyDetailDTO;
  const added = await page.request.post(`/api/admin/studies/${study.id}/cards`, {
    data: { label: "Pears", description: null },
  });
  const pears = (await added.json()) as { id: string };
  const put = await page.request.put(`/api/admin/studies/${study.id}/cards/${pears.id}/image`, {
    multipart: { file: { name: "p.png", mimeType: "image/png", buffer: makePng() } },
  });
  expect(put.ok(), await put.text()).toBe(true);
  const live = await page.request.post(`/api/admin/studies/${study.id}/status`, {
    data: { status: "live" },
  });
  expect(live.ok()).toBe(true);
  const { shareUrl } = (await live.json()) as StudyDetailDTO;

  const p = await joinStudy(browser, shareUrl, "Rob");
  await expectLoaded(card(p.page, "Pears").getByRole("img", { name: "Pears" }));
  // Simulate the image going missing: the next load of the board gets a 404 for it.
  await p.page.route("**/api/images/cards/**", (r) => r.fulfill({ status: 404, body: "" }));
  await p.page.reload();
  await hydrated(p.page);
  await expect(card(p.page, "Pears")).toBeVisible();
  await expect(card(p.page, "Pears").getByRole("img")).toHaveCount(0);
  await expect(card(p.page, "Pears")).toContainText("Pears");
  await p.context.close();
});
