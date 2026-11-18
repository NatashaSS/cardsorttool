import bcrypt from "bcryptjs";
import { unsealData } from "iron-session";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake next/headers cookie store shared by getAdminSession() in the route handlers.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (!value || opts?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

import * as loginRoute from "@/app/api/admin/login/route";
import * as logoutRoute from "@/app/api/admin/logout/route";
import { loginRateLimiter } from "@/server/services/rate-limit";
import { SESSION_COOKIE } from "@/server/session";

const SECRET = "integration-session-secret-at-least-32-chars";
const EMAIL = "admin@example.com";
const PASSWORD = "s3cret-password";
const saved = { ...process.env };

beforeAll(() => {
  process.env.ADMIN_EMAIL = EMAIL;
  process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
  process.env.SESSION_SECRET = SECRET;
});
afterAll(() => {
  process.env = { ...saved };
});
beforeEach(() => {
  jar.clear();
  loginRateLimiter.reset();
});

const none = { params: Promise.resolve({}) };

function login(body: unknown, ip = "203.0.113.7") {
  return loginRoute.POST(
    new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    none,
  );
}

async function sessionData() {
  const seal = jar.get(SESSION_COOKIE);
  if (!seal) return null;
  return unsealData<Record<string, unknown>>(seal, { password: SECRET });
}

describe("POST /api/admin/login", () => {
  it("AUTH-02: correct credentials return { ok: true } and create an admin session", async () => {
    const res = await login({ email: "Admin@Example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const data = await sessionData();
    expect(data).toMatchObject({ isAdmin: true, email: EMAIL });
    expect(typeof data?.loggedInAt).toBe("string");
  });

  it("AUTH-02: wrong credentials return a generic 401 and create no session", async () => {
    for (const body of [
      { email: EMAIL, password: "nope" },
      { email: "someone@example.com", password: PASSWORD },
    ]) {
      const res = await login(body);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("unauthorized");
      expect(json.error.message).toBe("Invalid email or password");
    }
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("AUTH-02: invalid bodies return 400", async () => {
    expect((await login("not json")).status).toBe(400);
    expect((await login({ email: EMAIL })).status).toBe(400);
    expect((await login({ email: "", password: "" })).status).toBe(400);
  });

  it("AUTH-05: more than 10 failed attempts from one IP are rejected with 429", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await login({ email: EMAIL, password: "wrong" })).status).toBe(401);
    }
    const blocked = await login({ email: EMAIL, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("rate_limited");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    // Another IP is unaffected.
    expect((await login({ email: EMAIL, password: PASSWORD }, "198.51.100.1")).status).toBe(200);
  });

  it("AUTH-05: a successful login clears that IP's failures", async () => {
    for (let i = 0; i < 9; i++) await login({ email: EMAIL, password: "wrong" });
    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(200);
    for (let i = 0; i < 10; i++) {
      expect((await login({ email: EMAIL, password: "wrong" })).status).toBe(401);
    }
    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(429);
  });
});

describe("POST /api/admin/logout", () => {
  it("AUTH-04: destroys the session and redirects (303) to the login page", async () => {
    await login({ email: EMAIL, password: PASSWORD });
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    const res = await logoutRoute.POST();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/login");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
});
