import { expect, test } from "@playwright/test";

test("AUTH-03: unauthenticated visit to /admin redirects to the login page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Admin login" })).toBeVisible();
});

test("participant study link serves a page", async ({ page }) => {
  const res = await page.goto("/s/example");
  expect(res?.status()).toBeLessThan(500);
});
