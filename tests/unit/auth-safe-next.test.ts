import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/components/auth/safe-next";

describe("safeNextPath", () => {
  it("AUTH-02: keeps same-origin /admin paths after login", () => {
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("/admin/studies/abc?tab=cards")).toBe("/admin/studies/abc?tab=cards");
  });

  it("AUTH-02: falls back to /admin for anything else", () => {
    for (const bad of [
      undefined,
      "",
      "https://evil.example/admin",
      "//evil.example/admin",
      "/admin//evil.example",
      "/\\evil.example",
      "/admin\\..\\x",
      "/administrator",
      "/s/abc",
      "/admin/login",
      "/admin/login?next=/admin",
      "/admin/\nfoo",
    ]) {
      expect(safeNextPath(bad)).toBe("/admin");
    }
  });
});
