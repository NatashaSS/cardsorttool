import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "@/server/env";

const original = process.env.ADMIN_PASSWORD_HASH;
afterEach(() => {
  process.env.ADMIN_PASSWORD_HASH = original;
});

describe("ADMIN_PASSWORD_HASH formats", () => {
  const hash = bcrypt.hashSync("pw", 4);

  it("AUTH-01: accepts the b64: form printed by hash-password", () => {
    process.env.ADMIN_PASSWORD_HASH = `b64:${Buffer.from(hash).toString("base64")}`;
    expect(env.adminPasswordHash).toBe(hash);
  });

  it("AUTH-01: accepts the raw and the \\$-escaped hash", () => {
    process.env.ADMIN_PASSWORD_HASH = hash;
    expect(env.adminPasswordHash).toBe(hash);
    process.env.ADMIN_PASSWORD_HASH = hash.replace(/\$/g, "\\$");
    expect(env.adminPasswordHash).toBe(hash);
  });
});
