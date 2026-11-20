import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/server/db/open";
import { ServiceError } from "@/server/errors";
import { createTestDb } from "../helpers/db";
import { makeBoard, makeCards, makeGroups, makeStudy, place } from "../helpers/factories";

const state = vi.hoisted(() => ({ db: null as unknown as DB, isAdmin: true }));

vi.mock("@/server/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/server/session", () => ({
  requireAdmin: async () => {
    if (!state.isAdmin) throw new ServiceError("unauthorized", "Admin login required");
  },
}));

import * as boardsRoute from "@/app/api/admin/studies/[id]/boards/route";
import * as boardRoute from "@/app/api/admin/studies/[id]/boards/[boardId]/route";
import * as placementsRoute from "@/app/api/admin/studies/[id]/export/placements.csv/route";
import * as participantsRoute from "@/app/api/admin/studies/[id]/export/participants.csv/route";

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/admin/studies/x/boards", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  state.db = createTestDb();
  state.isAdmin = true;
});

function seed() {
  const study = makeStudy(state.db, { title: "Shop navigation" });
  const [card] = makeCards(state.db, study.id, ["=1+1", "B"]);
  const [group] = makeGroups(state.db, study.id, ["G"]);
  const board = makeBoard(state.db, study.id, { participant: { name: "Ada" } });
  place(state.db, board.id, card.id, group.id);
  return { study, board };
}

describe("admin results API", () => {
  it("AUTH-03: every results route returns 401 without a session and changes nothing", async () => {
    const { study, board } = seed();
    state.isAdmin = false;
    const p = { id: study.id, boardId: board.id };
    const responses = await Promise.all([
      boardsRoute.GET(req("GET"), ctx({ id: study.id })),
      boardRoute.PATCH(req("PATCH", { excluded: true }), ctx(p)),
      boardRoute.DELETE(req("DELETE"), ctx(p)),
      placementsRoute.GET(req("GET"), ctx({ id: study.id })),
      participantsRoute.GET(req("GET"), ctx({ id: study.id })),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
    state.isAdmin = true;
    const list = await (await boardsRoute.GET(req("GET"), ctx({ id: study.id }))).json();
    expect(list).toHaveLength(1);
    expect(list[0].excluded).toBe(false);
  });

  it("RES-01: GET boards → BoardSummaryDTO[]; unknown study → 404", async () => {
    const { study, board } = seed();
    const res = await boardsRoute.GET(req("GET"), ctx({ id: study.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ id: board.id, participant: { name: "Ada" }, sortedCount: 1, totalCount: 2 }),
    ]);
    const missing = await boardsRoute.GET(req("GET"), ctx({ id: "nope-nope" }));
    expect(missing.status).toBe(404);
  });

  it("RES-03: PATCH excluded → 204; invalid body → 400; other study → 404", async () => {
    const { study, board } = seed();
    const p = ctx({ id: study.id, boardId: board.id });
    expect((await boardRoute.PATCH(req("PATCH", { excluded: true }), p)).status).toBe(204);
    let list = await (await boardsRoute.GET(req("GET"), ctx({ id: study.id }))).json();
    expect(list[0].excluded).toBe(true);
    expect((await boardRoute.PATCH(req("PATCH", { excluded: false }), p)).status).toBe(204);
    list = await (await boardsRoute.GET(req("GET"), ctx({ id: study.id }))).json();
    expect(list[0].excluded).toBe(false);

    const bad = await boardRoute.PATCH(req("PATCH", { excluded: "yes" }), p);
    expect(bad.status).toBe(400);
    expect((await boardRoute.PATCH(req("PATCH", "{not json"), p)).status).toBe(400);

    const other = makeStudy(state.db);
    const cross = await boardRoute.PATCH(
      req("PATCH", { excluded: true }),
      ctx({ id: other.id, boardId: board.id }),
    );
    expect(cross.status).toBe(404);
  });

  it("RES-04: DELETE → 204, then 404; other study → 404", async () => {
    const { study, board } = seed();
    const other = makeStudy(state.db);
    expect((await boardRoute.DELETE(req("DELETE"), ctx({ id: other.id, boardId: board.id }))).status).toBe(404);
    const p = ctx({ id: study.id, boardId: board.id });
    expect((await boardRoute.DELETE(req("DELETE"), p)).status).toBe(204);
    expect(await (await boardsRoute.GET(req("GET"), ctx({ id: study.id }))).json()).toEqual([]);
    expect((await boardRoute.DELETE(req("DELETE"), p)).status).toBe(404);
  });

  it("RES-05: CSV exports have CSV headers, an attachment file name and escaped content", async () => {
    const { study, board } = seed();
    const placements = await placementsRoute.GET(req("GET"), ctx({ id: study.id }));
    expect(placements.status).toBe(200);
    expect(placements.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(placements.headers.get("content-disposition")).toBe(
      'attachment; filename="shop-navigation-placements.csv"',
    );
    const bytes = new Uint8Array(await placements.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = new TextDecoder().decode(bytes); // strips the BOM
    expect(text.split("\r\n")[0]).toBe(
      "board_id,status,excluded,started_at,last_activity_at,completed_at,Name,card_label,card_origin,group_name,group_origin,position",
    );
    expect(text).toContain(`,Ada,'=1+1,predefined,G,predefined,1\r\n`);

    const participants = await participantsRoute.GET(req("GET"), ctx({ id: study.id }));
    expect(participants.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(participants.headers.get("content-disposition")).toBe(
      'attachment; filename="shop-navigation-participants.csv"',
    );
    const ptext = await participants.text();
    expect(ptext.split("\r\n")[1]).toMatch(new RegExp(`^${board.id},in_progress,false,.*,1,2,Ada$`));

    expect((await placementsRoute.GET(req("GET"), ctx({ id: "missing-x" }))).status).toBe(404);
    expect((await participantsRoute.GET(req("GET"), ctx({ id: "missing-x" }))).status).toBe(404);
  });
});
