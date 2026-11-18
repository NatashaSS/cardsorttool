import bcrypt from "bcryptjs";
import { defineConfig, devices } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_DB, E2E_PORT } from "./tests/e2e/fixtures";

const baseURL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "off", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // Fresh database for every run, then a dev server on a dedicated port.
    command: `node -e "for (const s of ['','-wal','-shm']) require('fs').rmSync('${E2E_DB}'+s,{force:true})" && tsx scripts/migrate.ts && next dev -p ${E2E_PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_PATH: E2E_DB,
      ADMIN_EMAIL: E2E_ADMIN_EMAIL,
      // Escaped "$": Next.js expands $ sequences in env vars that .env also defines, and the
      // server unescapes "\\$" itself, so the escaped form is safe in every case.
      ADMIN_PASSWORD_HASH: bcrypt.hashSync(E2E_ADMIN_PASSWORD, 4).replace(/\$/g, "\\$"),
      SESSION_SECRET: "e2e-session-secret-at-least-32-characters-long",
      PUBLIC_BASE_URL: baseURL,
    },
  },
});
