import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "@/components/admin/analysis/types";
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

import * as analysisRoute from "@/app/api/admin/studies/[id]/analysis/route";
import * as placementCsvRoute from "@/app/api/admin/studies/[id]/analysis/placement.csv/route";
import * as similarityCsvRoute from "@/app/api/admin/studies/[id]/analysis/similarity.csv/route";

const req = (path: string) => new Request(`http://localhost/api/admin/studies/x/analysis${path}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.db = createTestDb();
  state.isAdmin = true;
});

function seed(sortType: "closed" | "open" = "closed") {
  const db = state.db;
  const study = makeStudy(db, { sortType, title: "Nav" });
  const [a, b] = makeCards(db, study.id, ["=SUM(A1)", 'Say "hi", ok']);
  const groups = sortType === "closed" ? makeGroups(db, study.id, ["-Group"]) : [];
  const done = makeBoard(db, study.id, {
    status: "completed",
    completedAt: new Date().toISOString(),
  });
  const wip = makeBoard(db, study.id);
  if (groups[0]) {
    place(db, done.id, a.id, groups[0].id);
    place(db, done.id, b.id, groups[0].id);
    place(db, wip.id, a.id, groups[0].id);
  }
  return study;
}

describe("analysis API", () => {
  it("AUTH-03: every analysis endpoint returns 401 without a session", async () => {
    const study = seed();
    state.isAdmin = false;
    for (const res of [
      await analysisRoute.GET(req(""), ctx(study.id)),
      await similarityCsvRoute.GET(req("/similarity.csv"), ctx(study.id)),
      await placementCsvRoute.GET(req("/placement.csv"), ctx(study.id)),
    ]) {
      expect(res.status).toBe(401);
    }
  });

  it("ANL-01 ANL-02: returns labels + AnalysisResult; includeInProgress=1 adds in-progress boards", async () => {
    const study = seed();
    const res = await analysisRoute.GET(req(""), ctx(study.id));
    expect(res.status).toBe(200);
    const view = (await res.json()) as AnalysisView;
    expect(view.study).toMatchObject({ id: study.id, title: "Nav", sortType: "closed" });
    expect(view.cards.map((c) => c.label)).toEqual(["=SUM(A1)", 'Say "hi", ok']);
    expect(view.includeInProgress).toBe(false);
    expect(view.boardCounts).toEqual({ completed: 1, inProgress: 1, excluded: 0 });
    expect(view.result.n).toBe(1);
    expect(view.result.similarity.ratio[0][1]).toBe(1);

    const withWip = (await (
      await analysisRoute.GET(req("?includeInProgress=1"), ctx(study.id))
    ).json()) as AnalysisView;
    expect(withWip.includeInProgress).toBe(true);
    expect(withWip.result.n).toBe(2);
    expect(withWip.result.placement?.counts[0]).toEqual([2, 0]);
  });

  it("ANL-01: unknown study → 404", async () => {
    expect((await analysisRoute.GET(req(""), ctx("missing"))).status).toBe(404);
    expect((await similarityCsvRoute.GET(req("/similarity.csv"), ctx("missing"))).status).toBe(404);
  });

  it("ANL-07: similarity CSV has CSV headers, BOM, CRLF, quoting and formula protection", async () => {
    const study = seed();
    const res = await similarityCsvRoute.GET(req("/similarity.csv"), ctx(study.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename=".+\.csv"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    const lines = text.split("\r\n");
    expect(lines.at(-1)).toBe("");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("'=SUM(A1)");
    expect(lines[0]).toContain('"Say ""hi"", ok"');
    expect(lines[1]).toMatch(/^'=SUM\(A1\),100,100$/);
  });

  it("ANL-07: placement CSV honours includeInProgress and is 422 for open sorts", async () => {
    const study = seed();
    const text = await (
      await placementCsvRoute.GET(req("/placement.csv?includeInProgress=1"), ctx(study.id))
    ).text();
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Placement % (n = 2),'-Group,Unsorted");
    expect(lines[1]).toBe("'=SUM(A1),100,0");
    expect(lines[2]).toBe('"Say ""hi"", ok",50,50');

    const open = seed("open");
    const res = await placementCsvRoute.GET(req("/placement.csv"), ctx(open.id));
    expect(res.status).toBe(422);
  });
});
