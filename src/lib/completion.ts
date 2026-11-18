// Completion rules (PERM-05..07, DONE-01, DONE-05). Used by the client to
// disable "Complete" and by the server to reject completion.
import type { GroupDTO, StudyRulesConfig } from "./api-types";
import type { BoardStatus } from "./types";
import { isBoardEditable } from "./permissions";

export type CompletionBlockerCode =
  | "not_editable"
  | "unsorted_cards"
  | "unnamed_groups"
  | "empty_groups";

export type CompletionBlocker = { code: CompletionBlockerCode; message: string };

export type CompletionState = {
  study: StudyRulesConfig;
  boardStatus: BoardStatus;
  groups: Pick<GroupDTO, "id" | "name" | "kind" | "cardIds">[];
  unsortedCardIds: string[];
};

/** Names that count as "not named yet": blank, "Group N" (placeholder default), "New group". */
export function isDefaultGroupName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "" || n === "new group" || /^group \d+$/.test(n);
}

/** Default placeholder group name for fixed-mode open sorts (STU-05). */
export function placeholderGroupName(index: number): string {
  return `Group ${index + 1}`;
}

export function getCompletionBlockers(state: CompletionState): CompletionBlocker[] {
  const { study, groups, unsortedCardIds } = state;
  const { settings } = study;

  if (!isBoardEditable({ study, boardStatus: state.boardStatus, participantGroupCount: 0 })) {
    return [{ code: "not_editable", message: "This card sort can no longer be changed." }];
  }

  const blockers: CompletionBlocker[] = [];

  if (settings.requireAllSorted && unsortedCardIds.length > 0) {
    const n = unsortedCardIds.length;
    blockers.push({
      code: "unsorted_cards",
      message: `Sort all cards before completing (${n} card${n === 1 ? "" : "s"} left).`,
    });
  }

  const ownGroups = groups.filter((g) => g.kind !== "predefined");

  // Naming is only required when participants can actually rename groups (PERM-03/06).
  if (settings.requireGroupNames && settings.allowRenameGroups && study.sortType !== "closed") {
    const unnamed = ownGroups.filter((g) => g.cardIds.length > 0 && isDefaultGroupName(g.name));
    if (unnamed.length > 0) {
      blockers.push({
        code: "unnamed_groups",
        message: `Give every group a name (${unnamed.length} group${unnamed.length === 1 ? "" : "s"} still unnamed).`,
      });
    }
  }

  if (!settings.allowEmptyGroups) {
    const empty = ownGroups.filter((g) => g.cardIds.length === 0);
    if (empty.length > 0) {
      blockers.push({
        code: "empty_groups",
        message: `Remove or fill empty groups (${empty.length} empty).`,
      });
    }
  }

  return blockers;
}
