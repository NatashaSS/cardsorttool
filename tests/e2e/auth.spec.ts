import { expect, test } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./fixtures";
import { loginAsAdmin } from "./helpers";

test("AUTH-02: logging in via the form lands on /admin", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});

test("AUTH-02: a wrong password shows a generic error and creates no session", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("AUTH-03: unauthenticated deep link redirects to login and returns there afterwards", async ({
  page,
}) => {
  await page.goto("/admin/studies/new");
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fstudies%2Fnew$/);
  await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin\/studies\/new$/);
});

test("AUTH-03: unauthenticated admin API calls return 401", async ({ request }) => {
  const res = await request.get("/api/admin/studies");
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe("unauthorized");
});

test("AUTH-02: an already logged-in admin visiting /admin/login goes to /admin", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/admin/login");
  await expect(page).toHaveURL(/\/admin$/);
});

test("AUTH-04: logging out via the nav returns to login and protects /admin again", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Admin login" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await page.request.get("/api/admin/studies")).status()).toBe(401);
});
