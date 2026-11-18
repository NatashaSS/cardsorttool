import type { ErrorCode } from "@/lib/api-types";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  stale_revision: 409,
  board_completed: 409,
  study_not_live: 409,
  study_locked: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
};

/** Throw from services; route handlers map it to an HTTP response (src/server/http.ts). */
export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = "Not found") => new ServiceError("not_found", what);
export const badRequest = (message: string, details?: unknown) =>
  new ServiceError("bad_request", message, details);
