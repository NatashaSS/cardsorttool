import "server-only";

/**
 * AUTH-05: in-memory sliding-window limiter for failed admin logins, keyed by client IP.
 *
 * - A key is limited once it has `max` failures inside the last `windowMs`; every further attempt
 *   ("more than 10 failed attempts in 15 minutes") is rejected until the oldest failure ages out.
 * - Rejected (429) attempts are not recorded, so a blocked client is released `windowMs` after its
 *   failures, not after its last retry.
 * - A successful login clears the key's failures (the client has proven it knows the password).
 * - State is per process and lost on restart; good enough for a single self-hosted instance.
 */
export type RateLimiter = {
  /** True when the key has reached `max` failures in the window (the next attempt is rejected). */
  isLimited(key: string): boolean;
  /** Record one failed attempt for the key. */
  recordFailure(key: string): void;
  /** Seconds until the key can try again (0 when not limited). */
  retryAfterSeconds(key: string): number;
  /** Forget one key's failures, or all keys when called without an argument. */
  reset(key?: string): void;
};

export type RateLimiterOptions = {
  max: number;
  windowMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function createRateLimiter({ max, windowMs, now = Date.now }: RateLimiterOptions): RateLimiter {
  const failures = new Map<string, number[]>();

  /** Drop timestamps outside the window; returns the live list (and forgets empty keys). */
  function live(key: string): number[] {
    const list = failures.get(key);
    if (!list) return [];
    const cutoff = now() - windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length === 0) failures.delete(key);
    else if (kept.length !== list.length) failures.set(key, kept);
    return kept;
  }

  function sweep() {
    for (const key of failures.keys()) live(key);
  }

  return {
    isLimited(key) {
      return live(key).length >= max;
    },
    recordFailure(key) {
      // Occasionally sweep stale keys so memory stays bounded by recently failing IPs.
      if (failures.size > 1000) sweep();
      const list = live(key);
      list.push(now());
      // Only the newest `max` timestamps matter for the decision.
      failures.set(key, list.slice(-max));
    },
    retryAfterSeconds(key) {
      const list = live(key);
      if (list.length < max) return 0;
      const oldestRelevant = list[list.length - max];
      return Math.max(1, Math.ceil((oldestRelevant + windowMs - now()) / 1000));
    },
    reset(key) {
      if (key === undefined) failures.clear();
      else failures.delete(key);
    },
  };
}

/** Process-wide limiter used by POST /api/admin/login. */
export const loginRateLimiter: RateLimiter = createRateLimiter({
  max: LOGIN_MAX_FAILURES,
  windowMs: LOGIN_WINDOW_MS,
});

/**
 * Client IP for rate limiting: first `x-forwarded-for` entry, else `x-real-ip`, else "unknown".
 * These headers are only trustworthy behind a reverse proxy that sets them (the documented
 * deployment); without one, all direct clients may share the "unknown" bucket or spoof a value.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
