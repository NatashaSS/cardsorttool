// Single-flight auto-save queue (SAVE-01/02/03, DESIGN §8). Framework-free; the React binding
// lives in use-board.ts. Ops are applied optimistically by the caller and enqueued here; they
// are sent one at a time, in order, each carrying the last known revision.
import type { BoardStateDTO } from "@/lib/api-types";
import type { BoardOpInput } from "@/lib/schemas";
import { BoardApiError, type BoardApi } from "./api-client";

export type SaveStatus = "saved" | "saving" | "error";

/**
 * Why the queue replaced the local state with the server's:
 * - stale:     409 stale_revision (another tab changed the board) — SAVE-03
 * - completed: 409 board_completed — DONE-04
 * - closed:    409 study_not_live — PART-06
 * - rejected:  another 4xx; the optimistic change is rolled back
 * - requested: reload() was called
 */
export type ResetReason = "stale" | "completed" | "closed" | "rejected" | "requested";

export type SaveQueueSnapshot = {
  status: SaveStatus;
  /** Ops not yet confirmed by the server (including the one in flight). */
  pending: number;
  /** Delay of the scheduled automatic retry, while status is "error". */
  retryInMs: number | null;
};

export type SaveQueueOptions = {
  api: Pick<BoardApi, "postOp" | "getState">;
  revision: number;
  /** First retry delay; doubles per failed attempt up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
};

type Waiter = { resolve: (allSaved: boolean) => void; dropped: boolean };

export function reasonForError(e: unknown): ResetReason {
  if (e instanceof BoardApiError) {
    if (e.code === "stale_revision") return "stale";
    if (e.code === "board_completed") return "completed";
    if (e.code === "study_not_live") return "closed";
  }
  return "rejected";
}

export class SaveQueue {
  private readonly api: SaveQueueOptions["api"];
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private revision: number;
  private queue: BoardOpInput[] = [];
  private inFlight = false;
  private resyncing: ResetReason | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryAction: (() => void) | null = null;
  private status: SaveStatus = "saved";
  private retryInMs: number | null = null;
  private snap: SaveQueueSnapshot = { status: "saved", pending: 0, retryInMs: null };
  private readonly listeners = new Set<() => void>();
  private readonly resetListeners = new Set<(state: BoardStateDTO, reason: ResetReason) => void>();
  private waiters: Waiter[] = [];

  constructor(options: SaveQueueOptions) {
    this.api = options.api;
    this.revision = options.revision;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 10_000;
  }

  // ---- observation ---------------------------------------------------------

  /** Stable between changes (for useSyncExternalStore). */
  getSnapshot = (): SaveQueueSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called after the local state must be replaced by the server's (409s, rejected ops). */
  onReset(listener: (state: BoardStateDTO, reason: ResetReason) => void): () => void {
    this.resetListeners.add(listener);
    return () => this.resetListeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  private get idle(): boolean {
    return this.queue.length === 0 && !this.inFlight && this.resyncing === null;
  }

  private emit() {
    const pending = this.queue.length;
    const { status, retryInMs } = this;
    if (
      this.snap.status !== status ||
      this.snap.pending !== pending ||
      this.snap.retryInMs !== retryInMs
    ) {
      this.snap = { status, pending, retryInMs };
      for (const l of this.listeners) l();
    }
  }

  private setStatus(status: SaveStatus, retryInMs: number | null = null) {
    this.status = status;
    this.retryInMs = retryInMs;
    this.emit();
  }

  private settleIfIdle() {
    if (!this.idle) return;
    this.setStatus("saved");
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.resolve(!w.dropped);
  }

  // ---- commands ------------------------------------------------------------

  /** Queue an op that has already been applied optimistically. */
  enqueue(op: BoardOpInput): void {
    this.queue.push(op);
    if (this.status !== "error") this.setStatus("saving");
    else this.emit();
    this.pump();
  }

  /**
   * Resolves once every queued op has been saved (true) or the queue was dropped because the
   * state was reset from the server (false). Used before completing the board (DONE-03).
   */
  flush(): Promise<boolean> {
    if (this.idle) return Promise.resolve(true);
    return new Promise((resolve) => this.waiters.push({ resolve, dropped: false }));
  }

  /** Manual "Retry" (SAVE-02): retry now instead of waiting for the backoff timer. */
  retryNow(): void {
    if (!this.timer || !this.retryAction) return;
    clearTimeout(this.timer);
    this.timer = null;
    const action = this.retryAction;
    this.retryAction = null;
    action();
  }

  /** Drop pending ops and replace the local state with the server's. */
  reload(reason: ResetReason = "requested"): Promise<void> {
    return this.resync(reason);
  }

  /** Stop timers (e.g. on unmount). Pending ops stay queued. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.retryAction = null;
  }

  // ---- internals -----------------------------------------------------------

  private scheduleRetry(action: () => void) {
    const delay = Math.min(this.baseDelayMs * 2 ** this.attempt, this.maxDelayMs);
    this.attempt++;
    this.retryAction = action;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.retryAction = null;
      action();
    }, delay);
    this.setStatus("error", delay);
  }

  private pump(): void {
    if (this.inFlight || this.timer || this.resyncing !== null || this.queue.length === 0) return;
    const op = this.queue[0];
    this.inFlight = true;
    if (this.status !== "error") this.setStatus("saving");
    this.api.postOp(this.revision, op).then(
      (res) => {
        this.inFlight = false;
        if (this.resyncing !== null || this.queue[0] !== op) return; // dropped meanwhile
        this.queue.shift();
        this.revision = res.revision;
        this.attempt = 0;
        if (this.queue.length > 0) {
          this.setStatus("saving");
          this.pump();
        } else {
          this.settleIfIdle();
        }
      },
      (e: unknown) => {
        this.inFlight = false;
        if (this.resyncing !== null || this.queue[0] !== op) return;
        if (e instanceof BoardApiError && e.retryable) {
          this.scheduleRetry(() => this.pump());
        } else {
          void this.resync(reasonForError(e));
        }
      },
    );
  }

  private async resync(reason: ResetReason): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.retryAction = null;
    this.queue = [];
    for (const w of this.waiters) w.dropped = true;
    this.resyncing = reason;
    this.attempt = 0;
    this.setStatus("saving");
    await this.fetchState(reason);
  }

  private async fetchState(reason: ResetReason): Promise<void> {
    try {
      const state = await this.api.getState();
      this.resyncing = null;
      this.revision = state.board.revision;
      this.attempt = 0;
      // Ops enqueued during the refetch were applied to the state being replaced.
      this.queue = [];
      for (const w of this.waiters) w.dropped = true;
      for (const l of this.resetListeners) l(state, reason);
      this.settleIfIdle();
    } catch {
      await new Promise<void>((resolve) => this.scheduleRetry(resolve));
      await this.fetchState(reason);
    }
  }
}
