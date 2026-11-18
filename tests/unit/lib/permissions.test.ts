import { describe, expect, it } from "vitest";
import {
  canDeleteCard,
  canDeleteGroup,
  canEditCard,
  canRenameGroup,
  getBoardCapabilities,
  type BoardContext,
} from "@/lib/permissions";
import { rulesConfig } from "../../helpers/rules";

const ctx = (study = rulesConfig(), extra: Partial<BoardContext> = {}): BoardContext => ({
  study,
  boardStatus: "in_progress",
  participantGroupCount: 0,
  ...extra,
});

const closed = rulesConfig({ sortType: "closed" });
const openFixed = rulesConfig({ sortType: "open", groupMode: "fixed", fixedGroupCount: 4 });
const openUnbounded = rulesConfig({ sortType: "open", groupMode: "unbounded" });
const hybrid = rulesConfig({ sortType: "hybrid" });

describe("getBoardCapabilities", () => {
  it("PART-06 / DONE-04: nothing is editable on a completed board or a non-live study", () => {
    for (const c of [
      ctx(openUnbounded, { boardStatus: "completed" }),
      ctx(rulesConfig({ sortType: "open", status: "closed" })),
      ctx(rulesConfig({ status: "draft" })),
    ]) {
      const caps = getBoardCapabilities(c);
      expect(caps).toMatchObject({ canEdit: false, canMoveCards: false, canAddGroup: false, canAddCard: false });
      expect(canRenameGroup(c, "participant")).toBe(false);
      expect(canDeleteGroup(c, "participant")).toBe(false);
    }
  });

  it("STU-04 / STU-05: who may add groups, by sort type and group mode", () => {
    expect(getBoardCapabilities(ctx(closed)).canAddGroup).toBe(false);
    expect(getBoardCapabilities(ctx(openFixed)).canAddGroup).toBe(false);
    expect(getBoardCapabilities(ctx(openUnbounded)).canAddGroup).toBe(true);
    expect(getBoardCapabilities(ctx(hybrid)).canAddGroup).toBe(true);
    expect(getBoardCapabilities(ctx(closed)).canMoveCards).toBe(true);
  });

  it("STU-06: the participant group limit disables adding groups", () => {
    const limited = rulesConfig({ sortType: "hybrid", maxParticipantGroups: 2 });
    expect(getBoardCapabilities(ctx(limited, { participantGroupCount: 1 })).canAddGroup).toBe(true);
    const atLimit = getBoardCapabilities(ctx(limited, { participantGroupCount: 2 }));
    expect(atLimit).toMatchObject({ canAddGroup: false, groupLimitReached: true });
  });

  it("PERM-01: adding cards follows allowParticipantCards for every sort type", () => {
    for (const s of [closed, openFixed, openUnbounded, hybrid]) {
      expect(getBoardCapabilities(ctx(s)).canAddCard).toBe(false);
      const on = { ...s, settings: { ...s.settings, allowParticipantCards: true } };
      expect(getBoardCapabilities(ctx(on)).canAddCard).toBe(true);
    }
  });
});

describe("group rename/delete (PERM-03, PERM-04)", () => {
  it("PERM-03: predefined groups can never be renamed", () => {
    for (const s of [closed, hybrid]) expect(canRenameGroup(ctx(s), "predefined")).toBe(false);
  });

  it("PERM-03: placeholders renamable only in fixed-mode open sorts, when allowed", () => {
    expect(canRenameGroup(ctx(openFixed), "placeholder")).toBe(true);
    const off = rulesConfig({ sortType: "open", groupMode: "fixed", settings: { allowRenameGroups: false } });
    expect(canRenameGroup(ctx(off), "placeholder")).toBe(false);
  });

  it("PERM-03: participant groups renamable in open-unbounded and hybrid, when allowed", () => {
    expect(canRenameGroup(ctx(openUnbounded), "participant")).toBe(true);
    expect(canRenameGroup(ctx(hybrid), "participant")).toBe(true);
    const off = rulesConfig({ sortType: "hybrid", settings: { allowRenameGroups: false } });
    expect(canRenameGroup(ctx(off), "participant")).toBe(false);
  });

  it("PERM-04: only participant groups are deletable, when allowed", () => {
    expect(canDeleteGroup(ctx(hybrid), "participant")).toBe(true);
    expect(canDeleteGroup(ctx(hybrid), "predefined")).toBe(false);
    expect(canDeleteGroup(ctx(openFixed), "placeholder")).toBe(false);
    const off = rulesConfig({ sortType: "open", settings: { allowDeleteGroups: false } });
    expect(canDeleteGroup(ctx(off), "participant")).toBe(false);
  });
});

describe("card edit/delete (PERM-02)", () => {
  const withCards = (allowEditOwnCards: boolean) =>
    rulesConfig({ sortType: "open", settings: { allowParticipantCards: true, allowEditOwnCards } });

  it("PERM-02: participants may edit/delete only their own cards, when allowed", () => {
    expect(canEditCard(ctx(withCards(true)), "participant")).toBe(true);
    expect(canDeleteCard(ctx(withCards(true)), "participant")).toBe(true);
    expect(canEditCard(ctx(withCards(true)), "predefined")).toBe(false);
    expect(canEditCard(ctx(withCards(false)), "participant")).toBe(false);
  });
});
