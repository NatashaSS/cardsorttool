import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoardApi, type FetchLike } from "@/components/board/api-client";
import { SaveQueue, type ResetReason } from "@/components/board/save-queue";
import type { BoardStateDTO } from "@/lib/api-types";
import type { BoardOpInput } from "@/lib/schemas";
import { boardState } from "./fixtures";

type Call = { url: string; method: string; body: unknown };
type Reply = { status: number; body?: unknown } | "network";

/** Fake fetch: records calls; replies come from a per-endpoint script (default 200). */
function fakeServer(initialRevision = 0) {
  const calls: Call[] = [];
  let revision = initialRevision;
  const opReplies: Reply[] = [];
  const stateReplies: Reply[] = [];
  let serverState: BoardStateDTO = boardState({ board: { revision } });
  const pendingOps: Array<() => void> = [];
  let holdOps = false;

  const respond = (r: Reply): Promise<Response> =>
    r === "network"
      ? Promise.reject(new TypeError("Failed to fetch"))
      : Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status }));

  const fetch: FetchLike = (url, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.endsWith("/ops")) {
      const scripted = opReplies.shift();
      const reply = (): Promise<Response> => {
        if (scripted) return respond(scripted);
        revision++;
        return respond({ status: 200, body: { revision, lastActivityAt: "t" } });
      };
      if (holdOps)
        return new Promise((resolve, reject) =>
          pendingOps.push(() => reply().then(resolve, reject)),
        );
      return reply();
    }
    const scripted = stateReplies.shift();
    if (scripted) return respond(scripted);
    return respond({ status: 200, body: serverState });
  };

  return {
    fetch,
    calls,
    opCalls: () => calls.filter((c) => c.url.endsWith("/ops")),
    stateCalls: () => calls.filter((c) => c.method === "GET"),
    scriptOps: (...r: Reply[]) => opReplies.push(...r),
    scriptState: (...r: Reply[]) => stateReplies.push(...r),
    setState: (s: BoardStateDTO) => (serverState = s),
    hold: (on: boolean) => (holdOps = on),
    release: () => pendingOps.splice(0).forEach((f) => f()),
  };
}

const move = (cardId: string, toIndex = 0): BoardOpInput => ({
  type: "moveCard",
  cardId,
  toGroupId: "group-0001",
  toIndex,
});
const err = (status: number, code: string) => ({
  status,
  body: { error: { code, message: code } },
});

function setup(revision = 0) {
  const server = fakeServer(revision);
  const queue = new SaveQueue({
    api: createBoardApi("tok-en", server.fetch),
    revision,
    baseDelayMs: 500,
    maxDelayMs: 4000,
  });
  const resets: { state: BoardStateDTO; reason: ResetReason }[] = [];
  queue.onReset((state, reason) => resets.push({ state, reason }));
  return { server, queue, resets };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SaveQueue", () => {
  it("SAVE-01: sends each op to POST /api/boards/[token]/ops with the current revision", async () => {
    const { server, queue } = setup(3);
    queue.enqueue(move("card-0001"));
    await vi.runAllTimersAsync();
    expect(server.opCalls()).toEqual([
      {
        url: "/api/boards/tok-en/ops",
        method: "POST",
        body: { revision: 3, op: move("card-0001") },
      },
    ]);
    expect(queue.getRevision()).toBe(4);
  });

  it("SAVE-02: sends ops one at a time, in order, each with the revision returned by the previous", async () => {
    const { server, queue } = setup(0);
    server.hold(true);
    queue.enqueue(move("card-0001"));
    queue.enqueue(move("card-0002"));
    queue.enqueue(move("card-0003"));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.opCalls()).toHaveLength(1); // single flight
    expect(queue.getSnapshot()).toMatchObject({ status: "saving", pending: 3 });
    server.hold(false);
    server.release();
    await vi.runAllTimersAsync();
    expect(server.opCalls().map((c) => (c.body as { revision: number }).revision)).toEqual([
      0, 1, 2,
    ]);
    expect(server.opCalls().map((c) => (c.body as { op: { cardId: string } }).op.cardId)).toEqual([
      "card-0001",
      "card-0002",
      "card-0003",
    ]);
    expect(queue.getSnapshot()).toEqual({ status: "saved", pending: 0, retryInMs: null });
  });

  it("SAVE-02: status goes saving → saved and notifies subscribers", async () => {
    const { queue } = setup();
    const seen: string[] = [];
    queue.subscribe(() => seen.push(queue.getSnapshot().status));
    expect(queue.getSnapshot().status).toBe("saved");
    queue.enqueue(move("card-0001"));
    expect(queue.getSnapshot().status).toBe("saving");
    await vi.runAllTimersAsync();
    expect(queue.getSnapshot().status).toBe("saved");
    expect(seen[0]).toBe("saving");
    expect(seen.at(-1)).toBe("saved");
  });

  it("SAVE-02: retries network errors and 5xx with exponential backoff", async () => {
    const { server, queue } = setup();
    server.scriptOps("network", err(500, "internal"), err(503, "internal"), "network");
    queue.enqueue(move("card-0001"));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot()).toMatchObject({ status: "error", retryInMs: 500 });
    expect(server.opCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(server.opCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.opCalls()).toHaveLength(2);
    expect(queue.getSnapshot().retryInMs).toBe(1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(server.opCalls()).toHaveLength(3);
    expect(queue.getSnapshot().retryInMs).toBe(2000);

    await vi.advanceTimersByTimeAsync(2000);
    expect(server.opCalls()).toHaveLength(4);
    expect(queue.getSnapshot().retryInMs).toBe(4000);

    await vi.advanceTimersByTimeAsync(4000);
    expect(server.opCalls()).toHaveLength(5);
    expect(queue.getSnapshot().status).toBe("saved");
    // Every attempt used the same revision.
    expect(new Set(server.opCalls().map((c) => (c.body as { revision: number }).revision))).toEqual(
      new Set([0]),
    );
  });

  it("SAVE-02: caps the backoff delay", async () => {
    const { server, queue } = setup();
    server.scriptOps(...Array<Reply>(8).fill("network"));
    queue.enqueue(move("card-0001"));
    await vi.advanceTimersByTimeAsync(0);
    const delays: (number | null)[] = [];
    for (let i = 0; i < 6; i++) {
      delays.push(queue.getSnapshot().retryInMs);
      await vi.advanceTimersByTimeAsync(queue.getSnapshot().retryInMs ?? 0);
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 4000, 4000]);
  });

  it("SAVE-02: manual retry sends immediately", async () => {
    const { server, queue } = setup();
    server.scriptOps("network");
    queue.enqueue(move("card-0001"));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot().status).toBe("error");
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.opCalls()).toHaveLength(2);
    expect(queue.getSnapshot().status).toBe("saved");
  });

  it("SAVE-02: ops enqueued while retrying are sent after the failed one succeeds", async () => {
    const { server, queue } = setup();
    server.scriptOps("network");
    queue.enqueue(move("card-0001"));
    await vi.advanceTimersByTimeAsync(0);
    queue.enqueue(move("card-0002"));
    expect(queue.getSnapshot()).toMatchObject({ status: "error", pending: 2 });
    await vi.runAllTimersAsync();
    expect(server.opCalls().map((c) => (c.body as { op: { cardId: string } }).op.cardId)).toEqual([
      "card-0001",
      "card-0001",
      "card-0002",
    ]);
  });

  it("SAVE-03: on 409 stale_revision refetches the board, drops the queue and reports 'stale'", async () => {
    const { server, queue, resets } = setup(2);
    const fresh = boardState({ board: { revision: 7 } });
    server.setState(fresh);
    server.scriptOps(err(409, "stale_revision"));
    queue.enqueue(move("card-0001"));
    queue.enqueue(move("card-0002"));
    await vi.runAllTimersAsync();
    expect(server.stateCalls()).toEqual([
      { url: "/api/boards/tok-en", method: "GET", body: undefined },
    ]);
    expect(resets).toEqual([{ state: fresh, reason: "stale" }]);
    expect(server.opCalls()).toHaveLength(1); // card-0002 was dropped
    expect(queue.getSnapshot()).toEqual({ status: "saved", pending: 0, retryInMs: null });
    // Next op uses the refetched revision.
    queue.enqueue(move("card-0003"));
    await vi.runAllTimersAsync();
    expect((server.opCalls()[1].body as { revision: number }).revision).toBe(7);
  });

  it("DONE-04 / PART-06: 409 board_completed and study_not_live reset with their reasons", async () => {
    for (const [code, reason] of [
      ["board_completed", "completed"],
      ["study_not_live", "closed"],
    ] as const) {
      const { server, queue, resets } = setup();
      server.scriptOps(err(409, code));
      queue.enqueue(move("card-0001"));
      await vi.runAllTimersAsync();
      expect(resets.map((r) => r.reason)).toEqual([reason]);
    }
  });

  it("SAVE-04: other 4xx responses roll back to the server state", async () => {
    for (const reply of [
      err(403, "forbidden"),
      err(404, "not_found"),
      err(400, "bad_request"),
      err(409, "conflict"),
    ]) {
      const { server, queue, resets } = setup();
      server.scriptOps(reply);
      queue.enqueue(move("card-0001"));
      await vi.runAllTimersAsync();
      expect(resets.map((r) => r.reason)).toEqual(["rejected"]);
      expect(server.opCalls()).toHaveLength(1);
    }
  });

  it("SAVE-03: retries the refetch with backoff when it fails", async () => {
    const { server, queue, resets } = setup();
    server.scriptOps(err(409, "stale_revision"));
    server.scriptState("network", err(500, "internal"));
    queue.enqueue(move("card-0001"));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getSnapshot().status).toBe("error");
    await vi.runAllTimersAsync();
    expect(server.stateCalls()).toHaveLength(3);
    expect(resets).toHaveLength(1);
    expect(queue.getSnapshot().status).toBe("saved");
  });

  it("DONE-03: flush() resolves true once everything queued is saved", async () => {
    const { server, queue } = setup();
    expect(await queue.flush()).toBe(true); // idle
    server.scriptOps("network");
    queue.enqueue(move("card-0001"));
    queue.enqueue(move("card-0002"));
    let result: boolean | undefined;
    void queue.flush().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(result).toBe(true);
    expect(server.opCalls()).toHaveLength(3);
  });

  it("DONE-03: flush() resolves false when the queue was dropped by a reset", async () => {
    const { server, queue } = setup();
    server.scriptOps(err(409, "stale_revision"));
    queue.enqueue(move("card-0001"));
    const flushed = queue.flush();
    await vi.runAllTimersAsync();
    expect(await flushed).toBe(false);
  });

  it("reload() replaces the state on request", async () => {
    const { queue, resets } = setup();
    await queue.reload();
    expect(resets.map((r) => r.reason)).toEqual(["requested"]);
  });
});
