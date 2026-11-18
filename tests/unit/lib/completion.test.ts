import { describe, expect, it } from "vitest";
import {
  getCompletionBlockers,
  isDefaultGroupName,
  placeholderGroupName,
  type CompletionState,
} from "@/lib/completion";
import type { GroupDTO } from "@/lib/api-types";
import { rulesConfig } from "../../helpers/rules";

const group = (overrides: Partial<GroupDTO>): GroupDTO => ({
  id: "g".padEnd(10, "x"),
  name: "Named",
  kind: "participant",
  cardIds: [],
  ...overrides,
});

const state = (overrides: Partial<CompletionState> = {}): CompletionState => ({
  study: rulesConfig({ sortType: "open" }),
  boardStatus: "in_progress",
  groups: [],
  unsortedCardIds: [],
  ...overrides,
});

const codes = (s: CompletionState) => getCompletionBlockers(s).map((b) => b.code);

describe("getCompletionBlockers", () => {
  it("DONE-04: a completed board cannot be completed again", () => {
    expect(codes(state({ boardStatus: "completed" }))).toEqual(["not_editable"]);
  });

  it("PART-06: a closed study blocks completion", () => {
    expect(codes(state({ study: rulesConfig({ status: "closed" }) }))).toEqual(["not_editable"]);
  });

  it("PERM-05: unsorted cards block completion only when requireAllSorted is on", () => {
    expect(codes(state({ unsortedCardIds: ["a"] }))).toEqual([]);
    const strict = rulesConfig({ sortType: "open", settings: { requireAllSorted: true } });
    expect(codes(state({ study: strict, unsortedCardIds: ["a"] }))).toEqual(["unsorted_cards"]);
    expect(codes(state({ study: strict, unsortedCardIds: [] }))).toEqual([]);
  });

  it("PERM-06: non-empty groups with default names block completion when required", () => {
    const groups = [group({ name: "Group 2", kind: "placeholder", cardIds: ["a"] })];
    expect(codes(state({ groups }))).toEqual(["unnamed_groups"]);
    expect(codes(state({ groups: [group({ name: "  ", cardIds: ["a"] })] }))).toEqual(["unnamed_groups"]);
    // empty unnamed groups don't count
    expect(codes(state({ groups: [group({ name: "", cardIds: [] })] }))).toEqual([]);
    const relaxed = rulesConfig({ sortType: "open", settings: { requireGroupNames: false } });
    expect(codes(state({ study: relaxed, groups }))).toEqual([]);
  });

  it("PERM-06: predefined groups and closed sorts are exempt from naming", () => {
    const groups = [group({ name: "Group 1", kind: "predefined", cardIds: ["a"] })];
    expect(codes(state({ study: rulesConfig({ sortType: "closed" }), groups }))).toEqual([]);
    expect(codes(state({ study: rulesConfig({ sortType: "hybrid" }), groups }))).toEqual([]);
  });

  it("PERM-07: empty participant groups block completion when not allowed", () => {
    const groups = [group({ cardIds: [] }), group({ kind: "predefined", cardIds: [] })];
    expect(codes(state({ groups }))).toEqual([]);
    const strict = rulesConfig({ sortType: "hybrid", settings: { allowEmptyGroups: false } });
    expect(getCompletionBlockers(state({ study: strict, groups }))).toEqual([
      { code: "empty_groups", message: "Remove or fill empty groups (1 empty)." },
    ]);
  });

  it("DONE-01: multiple blockers are all reported", () => {
    const strict = rulesConfig({
      sortType: "open",
      settings: { requireAllSorted: true, allowEmptyGroups: false },
    });
    const groups = [group({ name: "", cardIds: ["a"] }), group({ cardIds: [] })];
    expect(codes(state({ study: strict, groups, unsortedCardIds: ["b"] }))).toEqual([
      "unsorted_cards",
      "unnamed_groups",
      "empty_groups",
    ]);
  });
});

describe("group name helpers", () => {
  it("STU-05: placeholder names are Group 1..N and count as default names", () => {
    expect(placeholderGroupName(0)).toBe("Group 1");
    expect(isDefaultGroupName(placeholderGroupName(11))).toBe(true);
    expect(isDefaultGroupName("New group")).toBe(true);
    expect(isDefaultGroupName("Groupies")).toBe(false);
  });
});
