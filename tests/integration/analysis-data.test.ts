import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/open";
import { ServiceError } from "@/server/errors";
import { getStudyAnalysis, loadAnalysisInput } from "@/server/services/analysis-data";
import { createTestDb } from "../helpers/db";
import {
  makeBoard,
  makeCard,
  makeCards,
  makeGroup,
  makeGroups,
  makeStudy,
  place,
} from "../helpers/factories";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

const completed = (studyId: string, extra: Record<string, unknown> = {}) =>
  makeBoard(db, studyId, { status: "completed", completedAt: new Date().toISOString(), ...extra });

describe("loadAnalysisInput", () => {
  it("ANL-01: unknown study → not_found", () => {
    expect(() => loadAnalysisInput(db, "nope", { includeInProgress: false })).toThrow(ServiceError);
    expect(() => getStudyAnalysis(db, "nope", { includeInProgress: false })).toThrow(/not found/i);
  });

  it("ANL-01 ANL-02: predefined cards and groups by position; every card mapped, unsorted → null", () => {
    const study = makeStudy(db, { sortType: "closed" });
    const [b, a] = [
      makeCard(db, study.id, { label: "B", position: 1 }),
      makeCard(db, study.id, { label: "A", position: 0 }),
    ];
    const [g2, g1] = [
      makeGroup(db, study.id, { name: "G2", position: 1 }),
      makeGroup(db, study.id, { name: "G1", position: 0 }),
    ];
    const board = completed(study.id);
    place(db, board.id, a.id, g2.id);

    const input = loadAnalysisInput(db, study.id, { includeInProgress: false });
    expect(input.cards).toEqual([
      { id: a.id, label: "A" },
      { id: b.id, label: "B" },
    ]);
    expect(input.groups).toEqual([
      { id: g1.id, name: "G1" },
      { id: g2.id, name: "G2" },
    ]);
    expect(input.boards).toHaveLength(1);
    expect(input.boards[0].placements).toEqual({
      [a.id]: { groupId: g2.id, groupKind: "predefined", groupName: "G2" },
      [b.id]: null,
    });
    expect(input.boards[0].participantCards).toEqual([]);
  });

  it("RES-03 ANL-01: excluded boards are ignored; in-progress only with the toggle", () => {
    const study = makeStudy(db);
    const [card] = makeCards(db, study.id, ["A"]);
    const [group] = makeGroups(db, study.id, ["G"]);
    const done = completed(study.id);
    const excludedDone = completed(study.id, { excluded: true });
    const wip = makeBoard(db, study.id);
    const excludedWip = makeBoard(db, study.id, { excluded: true });
    for (const b of [done, excludedDone, wip, excludedWip]) place(db, b.id, card.id, group.id);

    const ids = (includeInProgress: boolean) =>
      loadAnalysisInput(db, study.id, { includeInProgress })
        .boards.map((b) => b.id)
        .sort();
    expect(ids(false)).toEqual([done.id]);
    expect(ids(true)).toEqual([done.id, wip.id].sort());
    expect(getStudyAnalysis(db, study.id, { includeInProgress: true }).n).toBe(2);
  });

  it("ANL-04 ANL-05: participant groups/kinds and participant cards with their group name", () => {
    const study = makeStudy(db, { sortType: "hybrid" });
    const [a, b, c] = makeCards(db, study.id, ["A", "B", "C"]);
    const [pre] = makeGroups(db, study.id, ["Pre"]);
    const board = completed(study.id);
    const own = makeGroup(db, study.id, {
      boardId: board.id,
      kind: "participant",
      name: "Mine",
      position: 1,
    });
    const holder = makeGroup(db, study.id, {
      boardId: board.id,
      kind: "placeholder",
      name: "Group 1",
    });
    place(db, board.id, a.id, pre.id);
    place(db, board.id, b.id, own.id);
    place(db, board.id, c.id, holder.id);
    const pc1 = makeCard(db, study.id, { boardId: board.id, label: "Extra 1", position: 0 });
    makeCard(db, study.id, { boardId: board.id, label: "Extra 2", position: 1 });
    place(db, board.id, pc1.id, own.id);
    // A participant card on another (excluded) board is not listed.
    const other = completed(study.id, { excluded: true });
    makeCard(db, study.id, { boardId: other.id, label: "Hidden" });

    const input = loadAnalysisInput(db, study.id, { includeInProgress: false });
    expect(input.cards.map((x) => x.label)).toEqual(["A", "B", "C"]); // participant cards excluded
    expect(input.groups.map((g) => g.name)).toEqual(["Pre"]); // board groups excluded
    const p = input.boards[0].placements;
    expect(p[a.id]).toEqual({ groupId: pre.id, groupKind: "predefined", groupName: "Pre" });
    expect(p[b.id]).toEqual({ groupId: own.id, groupKind: "participant", groupName: "Mine" });
    expect(p[c.id]).toEqual({ groupId: holder.id, groupKind: "placeholder", groupName: "Group 1" });
    expect(input.boards[0].participantCards).toEqual([
      { label: "Extra 1", groupName: "Mine" },
      { label: "Extra 2", groupName: null },
    ]);

    const result = getStudyAnalysis(db, study.id, { includeInProgress: false });
    expect(result.placement?.columns.map((col) => col.label)).toEqual([
      "Pre",
      "Other (participant groups)",
      "Unsorted",
    ]);
    expect(result.groupNames.map((g) => g.displayName).sort()).toEqual(["Group 1", "Mine"]);
    expect(result.participantCards).toEqual([
      { boardId: board.id, label: "Extra 1", groupName: "Mine" },
      { boardId: board.id, label: "Extra 2", groupName: null },
    ]);
  });

  it("ANL-01: no boards → n = 0 with every card listed", () => {
    const study = makeStudy(db, { sortType: "open" });
    makeCards(db, study.id, ["A", "B"]);
    const result = getStudyAnalysis(db, study.id, { includeInProgress: true });
    expect(result.n).toBe(0);
    expect(result.placement).toBeNull();
    expect(result.dendrogram.leafOrder).toHaveLength(2);
  });
});
