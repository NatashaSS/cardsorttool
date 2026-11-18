// Which participant permission settings (PERM-01..09) apply to a study, per the
// DESIGN §5 matrix. Pure so it can be unit-tested; the settings UI hides the rest
// (hidden settings keep their stored value).
import type { StudySettings } from "@/lib/schemas";
import type { GroupMode, SortType } from "@/lib/types";

export type SettingKey = keyof StudySettings;

export type SettingMeta = {
  key: SettingKey;
  requirement: string;
  label: string;
  hint: string;
};

/** Display order of the settings. */
export const SETTINGS_META: SettingMeta[] = [
  {
    key: "allowParticipantCards",
    requirement: "PERM-01",
    label: "Participants may add their own cards",
    hint: "Shows an “Add card” control. New cards are visible only on that participant's board.",
  },
  {
    key: "allowEditOwnCards",
    requirement: "PERM-02",
    label: "Participants may edit or delete cards they created",
    hint: "Your predefined cards can never be edited or deleted by participants.",
  },
  {
    key: "allowRenameGroups",
    requirement: "PERM-03",
    label: "Participants may rename groups",
    hint: "Applies to groups participants create (and the numbered groups of fixed-group sorts), never to your predefined groups.",
  },
  {
    key: "allowDeleteGroups",
    requirement: "PERM-04",
    label: "Participants may delete groups",
    hint: "Only groups they created. Cards in a deleted group return to the unsorted tray.",
  },
  {
    key: "requireAllSorted",
    requirement: "PERM-05",
    label: "All cards must be sorted before completing",
    hint: "“Complete” stays disabled while any card is left in the unsorted tray.",
  },
  {
    key: "requireGroupNames",
    requirement: "PERM-06",
    label: "Groups must be named before completing",
    hint: "Blocks completion while a non-empty participant group has no name or still has its default name.",
  },
  {
    key: "allowEmptyGroups",
    requirement: "PERM-07",
    label: "Empty groups are allowed on completion",
    hint: "When off, participants must fill or delete their empty groups. Predefined groups may always be empty.",
  },
  {
    key: "randomizeCardOrder",
    requirement: "PERM-08",
    label: "Randomise card order",
    hint: "Each board gets its own shuffled order (stable for that board). When off, your card order is used.",
  },
  {
    key: "showCardDescriptions",
    requirement: "PERM-09",
    label: "Show card descriptions",
    hint: "Cards with a description show it on hover or focus.",
  },
];

export type SettingsContext = {
  sortType: SortType;
  groupMode: GroupMode;
  settings: Pick<StudySettings, "allowParticipantCards">;
};

/** Whether a setting has any effect for this sort type / group mode (DESIGN §5). */
export function isSettingApplicable(key: SettingKey, ctx: SettingsContext): boolean {
  const { sortType, groupMode } = ctx;
  const openFixed = sortType === "open" && groupMode === "fixed";
  // Groups participants create themselves exist in open-unbounded and hybrid sorts.
  const ownGroups = sortType === "hybrid" || (sortType === "open" && groupMode === "unbounded");
  switch (key) {
    case "allowEditOwnCards":
      return ctx.settings.allowParticipantCards;
    case "allowRenameGroups":
    case "requireGroupNames":
    case "allowEmptyGroups":
      // Closed sorts only have predefined groups, which participants never rename and which
      // may always be empty.
      return ownGroups || openFixed;
    case "allowDeleteGroups":
      return ownGroups;
    default:
      return true;
  }
}

export function visibleSettings(ctx: SettingsContext): SettingMeta[] {
  return SETTINGS_META.filter((m) => isSettingApplicable(m.key, ctx));
}
