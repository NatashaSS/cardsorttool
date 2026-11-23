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

import { getAnalysisView } from "@/app/api/admin/studies/[id]/analysis/view";
import * as analysisRoute from "@/app/api/admin/studies/[id]/analysis/route";
import * as placementCsvRoute from "@/app/api/admin/studies/[id]/analysis/placement.csv/route";
import * as similarityCsvRoute from "@/app/api/admin/studies/[id]/analysis/similarity.csv/route";
import { loadAnalysisData, loadAnalysisInput } from "@/server/services/analysis-data";

const req = (path: string) => new Request(`http://localhost/api/admin/studies/x/analysis${path}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const done = () => ({ status: "completed" as const, completedAt: new Date().toISOString() });

beforeEach(() => {
  state.db = createTestDb();
  state.isAdmin = true;
});

/**
 * Closed study, cards A/B, groups G1/G2. Boards (participant answers → A, B):
 *  b1 senior / Acme / GB → G1, G1   b2 senior / acme  / FR → G1, G2
 *  b3 lead / Globex / GB → G2, G2   b4 junior / —     / —  → G1, G1
 *  wip: senior / Acme / GB (in progress) → G2, G2
 *  excluded: senior / Acme / GB (completed, excluded) → G2, G1
 */
function seed() {
  const db = state.db;
  const study = makeStudy(db, {
    sortType: "closed",
    participantFields: [
      { key: "seniority", mode: "optional" },
      { key: "organisation", mode: "optional" },
      { key: "country", mode: "optional" },
    ],
  });
  const [a, b] = makeCards(db, study.id, ["A", "B"]);
  const [g1, g2] = makeGroups(db, study.id, ["G1", "G2"]);
  const board = (
    participant: Record<string, string>,
    ga: typeof g1,
    gb: typeof g1,
    extra: Record<string, unknown> = done(),
  ) => {
    const row = makeBoard(db, study.id, { participant, ...extra });
    place(db, row.id, a.id, ga.id);
    place(db, row.id, b.id, gb.id);
    return row;
  };
  const ids = {
    b1: board({ seniority: "senior", organisation: "Acme", country: "GB" }, g1, g1).id,
    b2: board({ seniority: "senior", organisation: " acme ", country: "FR" }, g1, g2).id,
    b3: board({ seniority: "lead", organisation: "Globex", country: "GB" }, g2, g2).id,
    b4: board({ seniority: "junior" }, g1, g1).id,
    wip: board({ seniority: "senior", organisation: "Acme", country: "GB" }, g2, g2, {}).id,
    excluded: board({ seniority: "senior", organisation: "Acme", country: "GB" }, g2, g1, {
      ...done(),
      excluded: true,
    }).id,
  };
  return { study, ids };
}

const boardIds = (studyId: string, filter: Record<string, string[]>, includeInProgress = false) =>
  loadAnalysisInput(state.db, studyId, { includeInProgress, filter })
    .boards.map((b) => b.id)
    .sort();

describe("loadAnalysisInput with participant filters", () => {
  it("ANL-09: OR within a field, AND across fields; case-insensitive text; not answered", () => {
    const { study, ids } = seed();
    expect(boardIds(study.id, {})).toEqual([ids.b1, ids.b2, ids.b3, ids.b4].sort());
    expect(boardIds(study.id, { seniority: ["senior"] })).toEqual([ids.b1, ids.b2].sort());
    expect(boardIds(study.id, { seniority: ["senior", "lead"] })).toEqual(
      [ids.b1, ids.b2, ids.b3].sort(),
    );
    expect(boardIds(study.id, { seniority: ["senior", "lead"], country: ["GB"] })).toEqual(
      [ids.b1, ids.b3].sort(),
    );
    expect(boardIds(study.id, { organisation: ["ACME"] })).toEqual([ids.b1, ids.b2].sort());
    expect(boardIds(study.id, { organisation: [""] })).toEqual([ids.b4]);
    expect(boardIds(study.id, { country: ["", "FR"] })).toEqual([ids.b2, ids.b4].sort());
    expect(boardIds(study.id, { seniority: ["executive"] })).toEqual([]);
  });

  it("ANL-09: unknown or disabled field keys are ignored", () => {
    const { study, ids } = seed();
    expect(boardIds(study.id, { name: ["Test Participant"], bogus: ["x"] })).toHaveLength(4);
    expect(
      loadAnalysisData(state.db, study.id, {
        includeInProgress: false,
        filter: { name: ["x"], seniority: ["lead", "lead"] },
      }).filter,
    ).toEqual({ seniority: ["lead"] });
    expect(boardIds(study.id, { name: ["x"], seniority: ["lead"] })).toEqual([ids.b3]);
  });

  it("ANL-09 RES-03: in-progress toggle combines with filters; excluded boards never count", () => {
    const { study, ids } = seed();
    expect(boardIds(study.id, { seniority: ["senior"] }, true)).toEqual(
      [ids.b1, ids.b2, ids.wip].sort(),
    );
    expect(boardIds(study.id, { organisation: ["acme"] }, true)).not.toContain(ids.excluded);
  });

  it("ANL-09: placements of filtered boards only; analysis result reflects the filter", () => {
    const { study } = seed();
    const view = getAnalysisView(state.db, study.id, {
      includeInProgress: false,
      filter: { seniority: ["senior"] },
    });
    expect(view.result.n).toBe(2);
    expect(view.unfilteredN).toBe(4);
    // A & B together on b1 only (b2 split them) → 50 %.
    expect(view.result.similarity.ratio[0][1]).toBe(0.5);
    expect(view.result.placement?.counts[0]).toEqual([2, 0, 0]);
    const all = getAnalysisView(state.db, study.id, { includeInProgress: false });
    expect(all.result.similarity.ratio[0][1]).toBe(0.75);
    expect(all.filter).toEqual({});
  });

  it("ANL-09 RES-03: filter options count boards before participant filters, never excluded ones", () => {
    const { study } = seed();
    const view = getAnalysisView(state.db, study.id, {
      includeInProgress: false,
      filter: { seniority: ["lead"] },
    });
    expect(view.filterOptions.map((f) => f.key)).toEqual(["seniority", "organisation", "country"]);
    const [seniority, organisation, country] = view.filterOptions;
    expect(seniority.values).toEqual([
      { value: "junior", label: "Junior", count: 1 },
      { value: "senior", label: "Senior", count: 2 },
      { value: "lead", label: "Lead / Principal", count: 1 },
    ]);
    expect(organisation.values).toEqual([
      { value: "Acme", label: "Acme", count: 2 },
      { value: "Globex", label: "Globex", count: 1 },
      { value: "", label: "(not answered)", count: 1 },
    ]);
    expect(country.values).toEqual([
      { value: "FR", label: "France", count: 1 },
      { value: "GB", label: "United Kingdom", count: 2 },
      { value: "", label: "(not answered)", count: 1 },
    ]);
    // With in-progress boards the counts include them (still not the excluded board).
    const wip = getAnalysisView(state.db, study.id, { includeInProgress: true });
    expect(wip.filterOptions[0].values.find((v) => v.value === "senior")?.count).toBe(3);
    expect(wip.filterOptions[1].values[0]).toEqual({ value: "Acme", label: "Acme", count: 3 });
  });

  it("ANL-09: a study without participant fields has no filter options", () => {
    const study = makeStudy(state.db, { participantFields: [] });
    makeBoard(state.db, study.id, done());
    const view = getAnalysisView(state.db, study.id, {
      includeInProgress: false,
      filter: { name: ["x"] },
    });
    expect(view.filterOptions).toEqual([]);
    expect(view.filter).toEqual({});
    expect(view.result.n).toBe(1);
  });
});

describe("analysis routes with filters", () => {
  it("ANL-09: GET analysis parses repeated filter params and includeInProgress", async () => {
    const { study } = seed();
    const res = await analysisRoute.GET(
      req("?includeInProgress=1&filter=seniority%3Asenior&filter=country:GB&filter=bogus:1"),
      ctx(study.id),
    );
    expect(res.status).toBe(200);
    const view = (await res.json()) as AnalysisView;
    expect(view.includeInProgress).toBe(true);
    expect(view.filter).toEqual({ seniority: ["senior"], country: ["GB"] });
    expect(view.result.n).toBe(2); // b1 + wip
    expect(view.unfilteredN).toBe(5);
  });

  it("ANL-09 ANL-07: CSV exports honour filters; n, header note and file name reflect them", async () => {
    const { study } = seed();
    const sim = await similarityCsvRoute.GET(
      req("/similarity.csv?filter=seniority:senior&filter=seniority:lead"),
      ctx(study.id),
    );
    expect(sim.headers.get("content-disposition")).toBe(
      `attachment; filename="similarity-matrix-${study.id}-filtered.csv"`,
    );
    const simLines = (await sim.text()).replace(/^﻿/, "").split("\r\n");
    expect(simLines[0]).toBe('"Similarity % (n = 3; Seniority: Senior, Lead / Principal)",A,B');
    expect(simLines[1]).toBe("A,100,66.7");

    const plc = await placementCsvRoute.GET(
      req("/placement.csv?includeInProgress=1&filter=organisation:acme"),
      ctx(study.id),
    );
    const plcLines = (await plc.text()).replace(/^﻿/, "").split("\r\n");
    // b1, b2 and the in-progress Acme board; the excluded Acme board is never counted.
    expect(plcLines[0]).toBe("Placement % (n = 3; Organisation: Acme),G1,G2,Unsorted");
    expect(plcLines[1]).toBe("A,66.7,33.3,0");

    const plain = await similarityCsvRoute.GET(req("/similarity.csv"), ctx(study.id));
    expect(plain.headers.get("content-disposition")).not.toContain("filtered");
    expect(await plain.text()).toContain("Similarity % (n = 4),A,B");
  });

  it("AUTH-03 ANL-09: filtered analysis endpoints still require the admin session", async () => {
    const { study } = seed();
    state.isAdmin = false;
    const q = "?filter=seniority:senior";
    for (const res of [
      await analysisRoute.GET(req(q), ctx(study.id)),
      await similarityCsvRoute.GET(req(`/similarity.csv${q}`), ctx(study.id)),
      await placementCsvRoute.GET(req(`/placement.csv${q}`), ctx(study.id)),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});
