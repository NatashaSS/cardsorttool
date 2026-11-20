import bcrypt from "bcryptjs";
import { defineConfig, devices } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_DB, E2E_PORT } from "./tests/e2e/fixtures";

const baseURL = `http://localhost:${E2E_PORT}`;
const viewport = { width: 1440, height: 900 };
// NFR-07: CI runs every spec in Chromium, Firefox and WebKit; locally only Chromium is installed.
const allBrowsers = Boolean(process.env.E2E_ALL_BROWSERS);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: process.env.CI ? "retain-on-failure" : "off", viewport },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport } },
    ...(allBrowsers
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"], viewport } },
          { name: "webkit", use: { ...devices["Desktop Safari"], viewport } },
        ]
      : []),
  ],
  webServer: {
    // Fresh database for every run, then a dev server on a dedicated port.
    command: `node -e "for (const s of ['','-wal','-shm']) require('fs').rmSync('${E2E_DB}'+s,{force:true})" && tsx scripts/migrate.ts && next dev -p ${E2E_PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_PATH: E2E_DB,
      ADMIN_EMAIL: E2E_ADMIN_EMAIL,
      // "b64:" form: no "$", which Next.js would otherwise expand when .env defines the same key.
      ADMIN_PASSWORD_HASH: `b64:${Buffer.from(bcrypt.hashSync(E2E_ADMIN_PASSWORD, 4)).toString("base64")}`,
      SESSION_SECRET: "e2e-session-secret-at-least-32-characters-long",
      PUBLIC_BASE_URL: baseURL,
    },
  },
});
