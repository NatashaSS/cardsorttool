/**
 * Post-login redirect target: a same-origin path under /admin, else "/admin".
 * Rejects protocol-relative ("//host"), backslash tricks and the login page itself.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return "/admin";
  if (!/^\/admin(?:[/?#]|$)/.test(next)) return "/admin";
  if (next.includes("\\") || next.includes("//") || /\s/.test(next)) return "/admin";
  if (/^\/admin\/login(?:[/?#]|$)/.test(next)) return "/admin";
  return next;
}
