import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";

const SECRET = "unit-test-session-secret-at-least-32-chars";
const saved = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});
afterEach(() => {
  process.env.SESSION_SECRET = saved;
});

async function cookieFor(data: object, password = SECRET) {
  return `cardsort_admin=${await sealData(data, { password, ttl: 3600 })}`;
}

function req(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

const isPassThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it("AUTH-03: redirects unauthenticated admin pages to login with ?next", async () => {
    let res = await proxy(req("/admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/admin/login");

    res = await proxy(req("/admin/studies/abc?tab=1"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/admin/login");
    expect(loc.searchParams.get("next")).toBe("/admin/studies/abc?tab=1");
  });

  it("AUTH-03: returns 401 JSON for unauthenticated admin API calls", async () => {
    const res = await proxy(req("/api/admin/studies"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: "Admin login required" },
    });
  });

  it("AUTH-03: lets the login page, login and logout endpoints through", async () => {
    for (const p of ["/admin/login", "/api/admin/login", "/api/admin/logout"]) {
      expect(isPassThrough(await proxy(req(p)))).toBe(true);
    }
  });

  it("AUTH-03: accepts a valid sealed admin session", async () => {
    const cookie = await cookieFor({ isAdmin: true, email: "a@b.c" });
    expect(isPassThrough(await proxy(req("/admin/studies", cookie)))).toBe(true);
    expect(isPassThrough(await proxy(req("/api/admin/studies", cookie)))).toBe(true);
  });

  it("AUTH-03: rejects tampered, foreign-secret and non-admin cookies", async () => {
    const cookies = [
      "cardsort_admin=garbage",
      await cookieFor({ isAdmin: true }, "another-secret-that-is-at-least-32-characters"),
      await cookieFor({ isAdmin: false }),
      await cookieFor({}),
    ];
    for (const c of cookies) {
      expect((await proxy(req("/api/admin/studies", c))).status).toBe(401);
    }
  });

  it("AUTH-03: matcher only covers admin pages and the admin API", () => {
    expect(config.matcher).toEqual(["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*"]);
  });
});
