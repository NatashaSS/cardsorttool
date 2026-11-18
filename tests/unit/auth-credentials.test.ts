import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// session.ts imports next/headers; credential checks don't use it.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

import { verifyAdminCredentials } from "@/server/session";

const HASH = bcrypt.hashSync("correct horse", 4);
const saved = { ...process.env };

beforeEach(() => {
  process.env.ADMIN_EMAIL = "Admin@Example.com";
  process.env.ADMIN_PASSWORD_HASH = HASH;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("verifyAdminCredentials", () => {
  it("AUTH-01: accepts the single env-configured admin, email case-insensitively", async () => {
    expect(await verifyAdminCredentials("admin@example.com", "correct horse")).toBe(true);
    expect(await verifyAdminCredentials("  ADMIN@EXAMPLE.COM ", "correct horse")).toBe(true);
  });

  it("AUTH-01: rejects a wrong password or another email", async () => {
    expect(await verifyAdminCredentials("admin@example.com", "wrong")).toBe(false);
    expect(await verifyAdminCredentials("other@example.com", "correct horse")).toBe(false);
  });

  it("AUTH-01: accepts a hash with .env-escaped \\$ characters", async () => {
    process.env.ADMIN_PASSWORD_HASH = HASH.replace(/\$/g, "\\$");
    expect(await verifyAdminCredentials("admin@example.com", "correct horse")).toBe(true);
  });

  it("AUTH-01: missing env config never authenticates", async () => {
    delete process.env.ADMIN_PASSWORD_HASH;
    expect(await verifyAdminCredentials("admin@example.com", "correct horse")).toBe(false);
    process.env.ADMIN_PASSWORD_HASH = HASH;
    delete process.env.ADMIN_EMAIL;
    expect(await verifyAdminCredentials("", "correct horse")).toBe(false);
    expect(await verifyAdminCredentials("admin@example.com", "correct horse")).toBe(false);
  });
});
