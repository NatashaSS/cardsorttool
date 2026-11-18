import { unsealData } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import type { ApiErrorBody } from "@/lib/api-types";

/**
 * AUTH-03 (first layer): optimistic cookie check before admin routes render.
 * - /admin/** (except /admin/login) without a valid session → redirect to /admin/login?next=…
 * - /api/admin/** (except login/logout) without a valid session → 401 JSON
 * The protected layout (requireAdminPage) and route handlers (requireAdmin) still check the
 * session themselves (defence in depth).
 *
 * The cookie is unsealed here directly rather than via src/server/session.ts, because that module
 * is server-only and uses next/headers. Keep SESSION_COOKIE / ttl in sync with sessionOptions().
 */
const SESSION_COOKIE = "cardsort_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const PUBLIC_PATHS = new Set(["/admin/login", "/api/admin/login", "/api/admin/logout"]);

async function hasValidAdminSession(seal: string | undefined): Promise<boolean> {
  const password = process.env.SESSION_SECRET ?? "";
  if (!seal || password.length < 32) return false;
  try {
    const data = await unsealData<{ isAdmin?: unknown }>(seal, {
      password,
      ttl: SESSION_TTL_SECONDS,
    });
    return data?.isAdmin === true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (PUBLIC_PATHS.has(path)) return NextResponse.next();

  if (await hasValidAdminSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (path.startsWith("/api/")) {
    const body: ApiErrorBody = { error: { code: "unauthorized", message: "Admin login required" } };
    return NextResponse.json(body, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.search = "";
  // /admin is the default target, so keep that URL clean.
  const target = path + search;
  if (target !== "/admin") loginUrl.searchParams.set("next", target);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Only admin pages and the admin API; never /_next, static files, /s/** or participant APIs.
  matcher: ["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*"],
};
