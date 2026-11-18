// Shared e2e helpers. Seed data straight into the e2e database file used by the
// Playwright web server (see playwright.config.ts), using the same factories as unit tests.
import type { APIRequestContext, Page } from "@playwright/test";
import { openDatabase, type DB } from "../../src/server/db/open";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_DB } from "./fixtures";

export * from "../helpers/factories";

let cached: DB | null = null;

/** Handle to the e2e database (already migrated by the web server command). */
export function e2eDb(): DB {
  cached ??= openDatabase(E2E_DB).db;
  return cached;
}

/**
 * Log in as the admin via the API. Contract (stream A): POST /api/admin/login with JSON
 * { email, password } → 200 and sets the session cookie; 401 on bad credentials.
 * Uses the page's request context so the cookie is shared with the page.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await loginRequest(page.request);
}

export async function loginRequest(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/admin/login", {
    data: { email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD },
  });
  if (!res.ok()) throw new Error(`Admin login failed: ${res.status()} ${await res.text()}`);
}
