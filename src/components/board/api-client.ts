// BoardApiClient: a thin fetch wrapper over the participant board endpoints (DESIGN §7).
import type {
  ApiErrorBody,
  BoardOpResponse,
  BoardStateDTO,
  CompleteBoardResponse,
  ErrorCode,
} from "@/lib/api-types";
import type { BoardOpInput } from "@/lib/schemas";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** status 0 = the request never got a response (offline, DNS, aborted). */
export class BoardApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | null;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode | null, message: string, details?: unknown) {
    super(message);
    this.name = "BoardApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Network failures, 5xx and rate limiting are worth retrying as-is. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

export type BoardApi = {
  getState(): Promise<BoardStateDTO>;
  postOp(revision: number, op: BoardOpInput): Promise<BoardOpResponse>;
  complete(): Promise<CompleteBoardResponse>;
};

export function createBoardApi(token: string, fetchImpl?: FetchLike): BoardApi {
  const base = `/api/boards/${encodeURIComponent(token)}`;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    // Resolve fetch lazily so tests can stub the global.
    const doFetch: FetchLike = fetchImpl ?? ((input, i) => fetch(input, i));
    let res: Response;
    try {
      res = await doFetch(base + path, {
        cache: "no-store",
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch (e) {
      throw new BoardApiError(0, null, e instanceof Error ? e.message : "Network error");
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = (body as ApiErrorBody | null)?.error;
      throw new BoardApiError(
        res.status,
        err?.code ?? null,
        err?.message ?? `HTTP ${res.status}`,
        err?.details,
      );
    }
    return body as T;
  }

  return {
    getState: () => request<BoardStateDTO>(""),
    postOp: (revision, op) =>
      request<BoardOpResponse>("/ops", { method: "POST", body: JSON.stringify({ revision, op }) }),
    complete: () => request<CompleteBoardResponse>("/complete", { method: "POST" }),
  };
}
