import "server-only";
import bcrypt from "bcryptjs";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";
import { ServiceError } from "./errors";

export type AdminSession = { isAdmin?: boolean; email?: string; loggedInAt?: string };

export const SESSION_COOKIE = "cardsort_admin";

/** NOTE: src/proxy.ts duplicates the cookie name and TTL (it cannot import this file). */
export function sessionOptions(): SessionOptions {
  return {
    password: env.sessionSecret,
    cookieName: SESSION_COOKIE,
    ttl: 60 * 60 * 24 * 7, // 7 days
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: env.isProduction, path: "/" },
  };
}

/** Mutable session (call .save() / .destroy()). Use in route handlers and server actions. */
export async function getAdminSession() {
  return getIronSession<AdminSession>(await cookies(), sessionOptions());
}

export async function isAdmin(): Promise<boolean> {
  return (await getAdminSession()).isAdmin === true;
}

/** For /api/admin/** route handlers (AUTH-03): throws a 401 ServiceError. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new ServiceError("unauthorized", "Admin login required");
}

/** For admin pages (AUTH-03): redirects to the login page. */
export async function requireAdminPage(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

/** AUTH-01/02: compare against the single admin configured in env. */
export async function verifyAdminCredentials(email: string, password: string): Promise<boolean> {
  const expectedEmail = env.adminEmail.trim().toLowerCase();
  const hash = env.adminPasswordHash;
  if (!expectedEmail || !hash) return false;
  const passwordOk = await bcrypt.compare(password, hash);
  return passwordOk && email.trim().toLowerCase() === expectedEmail;
}
