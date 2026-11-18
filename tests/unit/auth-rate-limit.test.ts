import { describe, expect, it } from "vitest";
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  clientIp,
  createRateLimiter,
} from "@/server/services/rate-limit";

function limiter() {
  let t = 1_000_000;
  const rl = createRateLimiter({ max: LOGIN_MAX_FAILURES, windowMs: LOGIN_WINDOW_MS, now: () => t });
  return { rl, advance: (ms: number) => (t += ms) };
}

describe("login rate limiter", () => {
  it("AUTH-05: allows 10 failures in 15 minutes and rejects the 11th attempt", () => {
    expect(LOGIN_MAX_FAILURES).toBe(10);
    expect(LOGIN_WINDOW_MS).toBe(15 * 60 * 1000);
    const { rl, advance } = limiter();
    for (let i = 0; i < 10; i++) {
      expect(rl.isLimited("1.2.3.4")).toBe(false);
      rl.recordFailure("1.2.3.4");
      advance(1000);
    }
    expect(rl.isLimited("1.2.3.4")).toBe(true);
    expect(rl.retryAfterSeconds("1.2.3.4")).toBeGreaterThan(0);
  });

  it("AUTH-05: limits per IP", () => {
    const { rl } = limiter();
    for (let i = 0; i < 10; i++) rl.recordFailure("1.1.1.1");
    expect(rl.isLimited("1.1.1.1")).toBe(true);
    expect(rl.isLimited("2.2.2.2")).toBe(false);
  });

  it("AUTH-05: failures older than the window expire (sliding window)", () => {
    const { rl, advance } = limiter();
    rl.recordFailure("ip");
    advance(10 * 60 * 1000);
    for (let i = 0; i < 9; i++) rl.recordFailure("ip");
    expect(rl.isLimited("ip")).toBe(true);
    advance(5 * 60 * 1000 + 1); // the first failure is now outside the window
    expect(rl.isLimited("ip")).toBe(false);
    expect(rl.retryAfterSeconds("ip")).toBe(0);
    advance(10 * 60 * 1000);
    expect(rl.isLimited("ip")).toBe(false);
  });

  it("AUTH-05: reset clears one key or all keys", () => {
    const { rl } = limiter();
    for (let i = 0; i < 10; i++) {
      rl.recordFailure("a");
      rl.recordFailure("b");
    }
    rl.reset("a");
    expect(rl.isLimited("a")).toBe(false);
    expect(rl.isLimited("b")).toBe(true);
    rl.reset();
    expect(rl.isLimited("b")).toBe(false);
  });

  it("AUTH-05: client IP comes from x-forwarded-for, then x-real-ip, else 'unknown'", () => {
    expect(
      clientIp(new Headers({ "x-forwarded-for": " 9.9.9.9 , 10.0.0.1", "x-real-ip": "8.8.8.8" })),
    ).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
