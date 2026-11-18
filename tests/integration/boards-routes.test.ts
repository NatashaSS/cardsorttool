import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardStateDTO } from "@/lib/api-types";
import type { DB } from "@/server/db/open";
import { createTestDb } from "../helpers/db";
import { makeCards, makeGroups, makeStudy } from "../helpers/factories";

const holder = vi.hoisted(() => ({ db: null as unknown as DB }));
vi.mock("@/server/db/client", () => ({ getDb: () => holder.db }));

import { GET as getStudy } from "@/app/api/s/[slug]/route";
import { POST as postBoard } from "@/app/api/s/[slug]/boards/route";
import { GET as getBoard } from "@/app/api/boards/[token]/route";
import { POST as postOp } from "@/app/api/boards/[token]/ops/route";
import { POST as postComplete } from "@/app/api/boards/[token]/complete/route";

const params = <P,>(p: P) => ({ params: Promise.resolve(p) });
const json = (body: unknown) =>
  new Request("http://test.local/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = () => new Request("http://test.local/api");

beforeEach(() => {
  holder.db = createTestDb();
});

function liveStudy() {
  const study = makeStudy(holder.db, { settings: { randomizeCardOrder: false } });
  const cards = makeCards(holder.db, study.id, ["Apples", "Bananas"]);
  const groups = makeGroups(holder.db, study.id, ["Fruit"]);
  return { study, cards, groups };
}

describe("participant API routes", () => {
  it("PART-01: GET /api/s/[slug] returns public study data, 404 for unknown slugs", async () => {
    const { study } = liveStudy();
    const res = await getStudy(get(), params({ slug: study.slug }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: study.slug, status: "live" });
    const missing = await getStudy(get(), params({ slug: "unknown" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");
  });

  it("PART-02: POST /api/s/[slug]/boards creates a board (201) and validates details (400)", async () => {
    const { study } = liveStudy();
    const bad = await postBoard(json({ participant: {} }), params({ slug: study.slug }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("bad_request");
    const notJson = await postBoard(json("{oops"), params({ slug: study.slug }));
    expect(notJson.status).toBe(400);

    const res = await postBoard(json({ participant: { name: "Ann" } }), params({ slug: study.slug }));
    expect(res.status).toBe(201);
    const { token } = await res.json();
    expect(typeof token).toBe("string");
  });

  it("PART-02: POST /api/s/[slug]/boards on a draft study is 409 study_not_live", async () => {
    const study = makeStudy(holder.db, { status: "draft" });
    const res = await postBoard(json({ participant: { name: "Ann" } }), params({ slug: study.slug }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("study_not_live");
  });

  it("PART-04: GET /api/boards/[token] with an unknown token is 404 (and not cached)", async () => {
    const res = await getBoard(get(), params({ token: "not-a-real-token" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("SAVE-01 / SAVE-03 / DONE-04: ops, stale revisions and completion over HTTP", async () => {
    const { study, cards, groups } = liveStudy();
    const created = await postBoard(json({ participant: { name: "Ann" } }), params({ slug: study.slug }));
    const { token } = await created.json();

    const stateRes = await getBoard(get(), params({ token }));
    expect(stateRes.status).toBe(200);
    expect(stateRes.headers.get("cache-control")).toBe("no-store");
    const state = (await stateRes.json()) as BoardStateDTO;
    expect(state.unsortedCardIds).toEqual(cards.map((c) => c.id));

    const move = { type: "moveCard", cardId: cards[0].id, toGroupId: groups[0].id, toIndex: 0 };
    const ok = await postOp(json({ revision: 0, op: move }), params({ token }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toMatchObject({ revision: 1, lastActivityAt: expect.any(String) });

    const stale = await postOp(json({ revision: 0, op: move }), params({ token }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("stale_revision");

    const invalid = await postOp(json({ revision: 1, op: { type: "explode" } }), params({ token }));
    expect(invalid.status).toBe(400);

    const forbidden = await postOp(
      json({ revision: 1, op: { type: "addGroup", groupId: "newGroup01", name: "X" } }),
      params({ token }),
    );
    expect(forbidden.status).toBe(403);

    const done = await postComplete(json({}), params({ token }));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ status: "completed", completedAt: expect.any(String) });

    const frozen = await postOp(json({ revision: 1, op: move }), params({ token }));
    expect(frozen.status).toBe(409);
    expect((await frozen.json()).error.code).toBe("board_completed");
  });

  it("DONE-05: POST /complete returns 422 with blockers when rules are not met", async () => {
    const study = makeStudy(holder.db, { settings: { requireAllSorted: true } });
    makeCards(holder.db, study.id, ["Apples"]);
    makeGroups(holder.db, study.id, ["Fruit"]);
    const { token } = await (
      await postBoard(json({ participant: { name: "Ann" } }), params({ slug: study.slug }))
    ).json();
    const res = await postComplete(json({}), params({ token }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("unprocessable");
    expect(body.error.details[0].code).toBe("unsorted_cards");
  });
});
