import { describe, expect, it } from "vitest";
import {
  SETTINGS_META,
  isSettingApplicable,
  visibleSettings,
  type SettingsContext,
} from "@/components/admin/study-editor/settings-model";

const ctx = (
  sortType: SettingsContext["sortType"],
  groupMode: SettingsContext["groupMode"] = "unbounded",
  allowParticipantCards = false,
): SettingsContext => ({ sortType, groupMode, settings: { allowParticipantCards } });

const keys = (c: SettingsContext) => visibleSettings(c).map((m) => m.key);

describe("settings visibility (DESIGN §5 matrix)", () => {
  it("PERM-01..09: every setting has a label, hint and requirement id", () => {
    expect(SETTINGS_META.map((m) => m.requirement)).toEqual([
      "PERM-01",
      "PERM-02",
      "PERM-03",
      "PERM-04",
      "PERM-05",
      "PERM-06",
      "PERM-07",
      "PERM-08",
      "PERM-09",
    ]);
    for (const m of SETTINGS_META) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.hint.length).toBeGreaterThan(0);
    }
  });

  it("PERM-03 PERM-04 PERM-06 PERM-07: closed sorts hide group rename/delete, naming and empty-group settings", () => {
    expect(keys(ctx("closed"))).toEqual([
      "allowParticipantCards",
      "requireAllSorted",
      "randomizeCardOrder",
      "showCardDescriptions",
    ]);
  });

  it("PERM-03 PERM-04: open fixed sorts allow renaming placeholders but not deleting groups", () => {
    const k = keys(ctx("open", "fixed"));
    expect(k).toContain("allowRenameGroups");
    expect(k).toContain("requireGroupNames");
    expect(k).toContain("allowEmptyGroups");
    expect(k).not.toContain("allowDeleteGroups");
  });

  it("PERM-03 PERM-04 PERM-06 PERM-07: open unbounded and hybrid sorts show all group settings", () => {
    for (const c of [ctx("open", "unbounded"), ctx("hybrid")]) {
      expect(keys(c)).toEqual([
        "allowParticipantCards",
        "allowRenameGroups",
        "allowDeleteGroups",
        "requireAllSorted",
        "requireGroupNames",
        "allowEmptyGroups",
        "randomizeCardOrder",
        "showCardDescriptions",
      ]);
    }
  });

  it("PERM-02: editing own cards is only offered when participants may add cards", () => {
    expect(isSettingApplicable("allowEditOwnCards", ctx("closed", "unbounded", false))).toBe(false);
    expect(isSettingApplicable("allowEditOwnCards", ctx("closed", "unbounded", true))).toBe(true);
    expect(keys(ctx("hybrid", "unbounded", true))).toContain("allowEditOwnCards");
  });

  it("PERM-01 PERM-05 PERM-08 PERM-09: apply to every sort type", () => {
    for (const c of [ctx("closed"), ctx("open", "fixed"), ctx("open"), ctx("hybrid")]) {
      for (const key of [
        "allowParticipantCards",
        "requireAllSorted",
        "randomizeCardOrder",
        "showCardDescriptions",
      ] as const) {
        expect(isSettingApplicable(key, c)).toBe(true);
      }
    }
  });
});
