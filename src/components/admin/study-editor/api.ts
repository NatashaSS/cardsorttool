// Typed fetch helper for the admin JSON API (/api/admin/**). Client-side only.
import type { ApiErrorBody, ErrorCode } from "@/lib/api-types";

export class AdminApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Call an admin endpoint. `path` is relative to /api/admin (e.g. "/studies/abc/cards").
 * `body` is sent as JSON, or as-is when it is FormData (multipart uploads).
 * Resolves with the parsed JSON (undefined for 204); throws AdminApiError otherwise.
 */
export async function adminApi<T = unknown>(
  path: string,
  { method = "GET", body }: { method?: Method; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      // FormData sets its own multipart Content-Type (with the boundary).
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new AdminApiError("internal", 0, "Could not reach the server. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  let json: unknown = undefined;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body; handled below.
  }
  if (!res.ok) {
    if (isApiErrorBody(json)) {
      const { code, message, details } = json.error;
      const msg =
        code === "unauthorized" ? "Your session has expired. Please log in again." : message;
      throw new AdminApiError(code, res.status, msg, details);
    }
    throw new AdminApiError("internal", res.status, `Request failed (${res.status}).`);
  }
  return json as T;
}

/**
 * Extra human-readable lines from an error's `details`: publish problems
 * (`details.problems`) or zod field errors (`details.fieldErrors` / `formErrors`).
 */
export function errorDetailLines(err: unknown): string[] {
  if (!(err instanceof AdminApiError) || typeof err.details !== "object" || err.details === null) {
    return [];
  }
  const d = err.details as Record<string, unknown>;
  const lines: string[] = [];
  const pushStrings = (value: unknown, prefix = "") => {
    if (!Array.isArray(value)) return;
    for (const v of value) if (typeof v === "string") lines.push(prefix + v);
  };
  pushStrings(d.problems);
  pushStrings(d.formErrors);
  if (typeof d.fieldErrors === "object" && d.fieldErrors !== null) {
    for (const [field, msgs] of Object.entries(d.fieldErrors as Record<string, unknown>)) {
      pushStrings(msgs, `${field}: `);
    }
  }
  return lines;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
