import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/server/db/open";
import { ServiceError } from "@/server/errors";
import { createTestDb } from "../helpers/db";

const state = vi.hoisted(() => ({ db: null as unknown as DB, isAdmin: true }));

vi.mock("@/server/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/server/session", () => ({
  requireAdmin: async () => {
    if (!state.isAdmin) throw new ServiceError("unauthorized", "Admin login required");
  },
}));

import * as studiesRoute from "@/app/api/admin/studies/route";
import * as studyRoute from "@/app/api/admin/studies/[id]/route";
import * as statusRoute from "@/app/api/admin/studies/[id]/status/route";
import * as duplicateRoute from "@/app/api/admin/studies/[id]/duplicate/route";
import * as cardsRoute from "@/app/api/admin/studies/[id]/cards/route";
import * as cardRoute from "@/app/api/admin/studies/[id]/cards/[cardId]/route";
import * as cardsReorderRoute from "@/app/api/admin/studies/[id]/cards/reorder/route";
import * as cardsBulkRoute from "@/app/api/admin/studies/[id]/cards/bulk/route";
import * as groupsRoute from "@/app/api/admin/studies/[id]/groups/route";
import * as groupRoute from "@/app/api/admin/studies/[id]/groups/[groupId]/route";
import * as groupsReorderRoute from "@/app/api/admin/studies/[id]/groups/reorder/route";

const BASE = "http://localhost/api/admin/studies";

const req = (method: string, body?: unknown) =>
  new Request(BASE, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });
const none = ctx({} as Record<string, never>);

beforeEach(() => {
  state.db = createTestDb();
  state.isAdmin = true;
});

async function createViaApi(body: unknown = { title: "Study", sortType: "closed" }) {
  const res = await studiesRoute.POST(req("POST", body), none);
  expect(res.status).toBe(201);
  return res.json();
}

describe("admin studies API", () => {
  it("AUTH-03: unauthenticated calls return 401 and change nothing", async () => {
    const study = await createViaApi();
    state.isAdmin = false;
    const calls: Promise<Response>[] = [
      studiesRoute.GET(req("GET"), none),
      studiesRoute.POST(req("POST", { title: "X", sortType: "open" }), none),
      studyRoute.GET(req("GET"), ctx({ id: study.id })),
      studyRoute.PATCH(req("PATCH", { title: "Hacked" }), ctx({ id: study.id })),
      studyRoute.DELETE(req("DELETE"), ctx({ id: study.id })),
      statusRoute.POST(req("POST", { status: "live" }), ctx({ id: study.id })),
      duplicateRoute.POST(req("POST"), ctx({ id: study.id })),
      cardsRoute.POST(req("POST", { label: "A" }), ctx({ id: study.id })),
      cardRoute.PATCH(req("PATCH", { label: "A" }), ctx({ id: study.id, cardId: "xxxxxxxxxx" })),
      cardRoute.DELETE(req("DELETE"), ctx({ id: study.id, cardId: "xxxxxxxxxx" })),
      cardsReorderRoute.POST(req("POST", { ids: [] }), ctx({ id: study.id })),
      cardsBulkRoute.POST(req("POST", { text: "A\nB" }), ctx({ id: study.id })),
      groupsRoute.POST(req("POST", { name: "G" }), ctx({ id: study.id })),
      groupRoute.PATCH(req("PATCH", { name: "G" }), ctx({ id: study.id, groupId: "xxxxxxxxxx" })),
      groupRoute.DELETE(req("DELETE"), ctx({ id: study.id, groupId: "xxxxxxxxxx" })),
      groupsReorderRoute.POST(req("POST", { ids: [] }), ctx({ id: study.id })),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
    state.isAdmin = true;
    const detail = await (await studyRoute.GET(req("GET"), ctx({ id: study.id }))).json();
    expect(detail).toMatchObject({ title: "Study", status: "draft", cards: [], groups: [] });
  });

  it("STU-01: create, list, get, patch and delete a study over HTTP", async () => {
    const created = await createViaApi({ title: "Nav study", sortType: "hybrid" });
    expect(created).toMatchObject({ title: "Nav study", sortType: "hybrid", status: "draft" });

    const list = await (await studiesRoute.GET(req("GET"), none)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, boardCounts: { inProgress: 0, completed: 0 } });

    const patched = await studyRoute.PATCH(
      req("PATCH", { instructions: "Sort!" }),
      ctx({ id: created.id }),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).instructions).toBe("Sort!");

    const del = await studyRoute.DELETE(req("DELETE"), ctx({ id: created.id }));
    expect(del.status).toBe(204);
    const missing = await studyRoute.GET(req("GET"), ctx({ id: created.id }));
    expect(missing.status).toBe(404);
  });

  it("NFR-06: invalid bodies are rejected with 400", async () => {
    const bad = await studiesRoute.POST(req("POST", { title: "", sortType: "weird" }), none);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("bad_request");
    const notJson = await studiesRoute.POST(req("POST", "{nope"), none);
    expect(notJson.status).toBe(400);
  });

  it("STU-07 / STU-08 / STU-09 / STU-10 / STU-03: build and publish a study over HTTP", async () => {
    const study = await createViaApi();
    const id = study.id as string;

    const publishEmpty = await statusRoute.POST(req("POST", { status: "live" }), ctx({ id }));
    expect(publishEmpty.status).toBe(422);
    expect((await publishEmpty.json()).error.code).toBe("unprocessable");

    const card = await (
      await cardsRoute.POST(req("POST", { label: "Apples" }), ctx({ id }))
    ).json();
    expect(card).toMatchObject({ label: "Apples", description: null, position: 0 });
    const dup = await cardsRoute.POST(req("POST", { label: "apples" }), ctx({ id }));
    expect(dup.status).toBe(409);

    const bulk = await (
      await cardsBulkRoute.POST(req("POST", { text: "Pears\napples\n\nPlums" }), ctx({ id }))
    ).json();
    expect(bulk.added.map((c: { label: string }) => c.label)).toEqual(["Pears", "Plums"]);
    expect(bulk.skipped).toEqual(["apples"]);

    const edited = await cardRoute.PATCH(
      req("PATCH", { label: "Green apples", description: "Tart" }),
      ctx({ id, cardId: card.id }),
    );
    expect((await edited.json()).label).toBe("Green apples");

    const ids = [bulk.added[1].id, card.id, bulk.added[0].id];
    const reordered = await (
      await cardsReorderRoute.POST(req("POST", { ids }), ctx({ id }))
    ).json();
    expect(reordered.map((c: { id: string }) => c.id)).toEqual(ids);
    const badReorder = await cardsReorderRoute.POST(
      req("POST", { ids: ids.slice(1) }),
      ctx({ id }),
    );
    expect(badReorder.status).toBe(400);

    const delCard = await cardRoute.DELETE(req("DELETE"), ctx({ id, cardId: bulk.added[0].id }));
    expect(delCard.status).toBe(204);

    const g1 = await (await groupsRoute.POST(req("POST", { name: "Fruit" }), ctx({ id }))).json();
    const g2 = await (await groupsRoute.POST(req("POST", { name: "Other" }), ctx({ id }))).json();
    const renamed = await groupRoute.PATCH(
      req("PATCH", { name: "Stone fruit" }),
      ctx({ id, groupId: g2.id }),
    );
    expect((await renamed.json()).name).toBe("Stone fruit");
    const gr = await (
      await groupsReorderRoute.POST(req("POST", { ids: [g2.id, g1.id] }), ctx({ id }))
    ).json();
    expect(gr.map((g: { name: string }) => g.name)).toEqual(["Stone fruit", "Fruit"]);

    const live = await statusRoute.POST(req("POST", { status: "live" }), ctx({ id }));
    expect(live.status).toBe(200);
    expect((await live.json()).status).toBe("live");

    const locked = await cardsRoute.POST(req("POST", { label: "Late" }), ctx({ id }));
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.code).toBe("study_locked");
    const delGroup = await groupRoute.DELETE(req("DELETE"), ctx({ id, groupId: g1.id }));
    expect(delGroup.status).toBe(409);

    const copy = await duplicateRoute.POST(req("POST"), ctx({ id }));
    expect(copy.status).toBe(201);
    const copyBody = await copy.json();
    expect(copyBody).toMatchObject({ status: "draft", title: "Copy of Study" });
    expect(copyBody.cards).toHaveLength(2);
    expect(copyBody.groups).toHaveLength(2);
  });
});
