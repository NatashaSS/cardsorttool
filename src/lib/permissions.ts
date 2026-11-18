// The participant permission matrix (DESIGN §5). Single source of truth used by
// the server (enforcement) and the client (showing/hiding controls).
import type { StudyRulesConfig } from "./api-types";
import type { BoardStatus, CardOrigin, GroupKind } from "./types";

export type BoardContext = {
  study: StudyRulesConfig;
  boardStatus: BoardStatus;
  /** Number of participant-created groups currently on the board. */
  participantGroupCount: number;
};

export type BoardCapabilities = {
  /** Board is in progress and study is live. When false, everything else is false. */
  canEdit: boolean;
  canMoveCards: boolean;
  canAddGroup: boolean;
  /** True when the study allows adding groups but the limit (STU-06) is reached. */
  groupLimitReached: boolean;
  canAddCard: boolean;
};

/** Whether this sort type / group mode lets participants create groups at all. */
export function participantGroupsAllowed(study: StudyRulesConfig): boolean {
  if (study.sortType === "hybrid") return true;
  if (study.sortType === "open") return study.groupMode === "unbounded";
  return false;
}

export function isBoardEditable(ctx: BoardContext): boolean {
  return ctx.boardStatus === "in_progress" && ctx.study.status === "live";
}

export function getBoardCapabilities(ctx: BoardContext): BoardCapabilities {
  const canEdit = isBoardEditable(ctx);
  const groupsAllowed = participantGroupsAllowed(ctx.study);
  const max = ctx.study.maxParticipantGroups;
  const groupLimitReached = groupsAllowed && max !== null && ctx.participantGroupCount >= max;
  return {
    canEdit,
    canMoveCards: canEdit,
    canAddGroup: canEdit && groupsAllowed && !groupLimitReached,
    groupLimitReached,
    canAddCard: canEdit && ctx.study.settings.allowParticipantCards, // PERM-01
  };
}

/** PERM-03: predefined groups are never renamable; placeholders only in fixed-mode open sorts. */
export function canRenameGroup(ctx: BoardContext, kind: GroupKind): boolean {
  if (!isBoardEditable(ctx) || !ctx.study.settings.allowRenameGroups) return false;
  if (kind === "participant") return participantGroupsAllowed(ctx.study);
  if (kind === "placeholder") return ctx.study.sortType === "open" && ctx.study.groupMode === "fixed";
  return false;
}

/** PERM-04: only participant-created groups can be deleted. */
export function canDeleteGroup(ctx: BoardContext, kind: GroupKind): boolean {
  if (!isBoardEditable(ctx) || !ctx.study.settings.allowDeleteGroups) return false;
  return kind === "participant" && participantGroupsAllowed(ctx.study);
}

/** PERM-02: only the participant's own cards, and only when allowed. */
export function canEditCard(ctx: BoardContext, origin: CardOrigin): boolean {
  if (!isBoardEditable(ctx)) return false;
  const { allowParticipantCards, allowEditOwnCards } = ctx.study.settings;
  return origin === "participant" && allowParticipantCards && allowEditOwnCards;
}

export const canDeleteCard = canEditCard;
