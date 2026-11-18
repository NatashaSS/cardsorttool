import { z } from "zod";
import { ServiceError } from "@/server/errors";
import { parseBody, route } from "@/server/http";
import { clientIp, loginRateLimiter } from "@/server/services/rate-limit";
import { getAdminSession, verifyAdminCredentials } from "@/server/session";

const LoginSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024),
});

/**
 * AUTH-02/05: POST { email, password } → 200 { ok: true } + session cookie;
 * 400 invalid body; 401 bad credentials (generic message); 429 too many failures from this IP.
 */
export const POST = route(async (req) => {
  const ip = clientIp(req.headers);
  if (loginRateLimiter.isLimited(ip)) {
    throw new ServiceError("rate_limited", "Too many failed login attempts. Try again later.", {
      retryAfterSeconds: loginRateLimiter.retryAfterSeconds(ip),
    });
  }

  const { email, password } = await parseBody(req, LoginSchema);
  if (!(await verifyAdminCredentials(email, password))) {
    loginRateLimiter.recordFailure(ip);
    throw new ServiceError("unauthorized", "Invalid email or password");
  }

  loginRateLimiter.reset(ip);
  const session = await getAdminSession();
  session.isAdmin = true;
  session.email = email.trim().toLowerCase();
  session.loggedInAt = new Date().toISOString();
  await session.save();
  return { ok: true };
});
