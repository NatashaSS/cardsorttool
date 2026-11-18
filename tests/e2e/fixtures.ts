// Shared e2e constants. The Playwright webServer runs with these credentials.
export const E2E_ADMIN_EMAIL = "admin@example.com";
export const E2E_ADMIN_PASSWORD = "e2e-password";
// Override with E2E_PORT=… to run several e2e suites in parallel (e.g. in worktrees).
export const E2E_PORT = Number(process.env.E2E_PORT) || 3100;
export const E2E_DB = process.env.E2E_PORT ? `data/e2e-${process.env.E2E_PORT}.db` : "data/e2e.db";
