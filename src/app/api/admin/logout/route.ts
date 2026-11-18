import { getAdminSession } from "@/server/session";

/**
 * AUTH-04: destroy the session and send the browser to the login page. 303 so a plain HTML form
 * POST (the admin nav) follows with a GET; fetch callers can ignore the redirect. The Location is
 * relative so it stays correct behind a reverse proxy.
 */
export async function POST(): Promise<Response> {
  const session = await getAdminSession();
  session.destroy();
  return new Response(null, { status: 303, headers: { Location: "/admin/login" } });
}
