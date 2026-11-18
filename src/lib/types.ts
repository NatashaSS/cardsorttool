// Core domain enums and types shared by client and server. See docs/DESIGN.md §4.

export const SORT_TYPES = ["open", "closed", "hybrid"] as const;
export type SortType = (typeof SORT_TYPES)[number];

/** Only meaningful for open sorts (STU-05). Closed/hybrid studies store "unbounded". */
export const GROUP_MODES = ["fixed", "unbounded"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

export const STUDY_STATUSES = ["draft", "live", "closed"] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export const BOARD_STATUSES = ["in_progress", "completed"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/**
 * predefined  = defined by the admin (closed / hybrid), shared by all boards
 * placeholder = one of the N groups pre-created per board in fixed-mode open sorts
 * participant = created by the participant on their board
 */
export const GROUP_KINDS = ["predefined", "placeholder", "participant"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const CARD_ORIGINS = ["predefined", "participant"] as const;
export type CardOrigin = (typeof CARD_ORIGINS)[number];

/** Allowed status transitions (STU-03). */
export const STUDY_STATUS_TRANSITIONS: Record<StudyStatus, readonly StudyStatus[]> = {
  draft: ["live"],
  live: ["closed"],
  closed: ["live"],
};

/** Participant answers, keyed by field key (see src/lib/participant-fields.ts). */
export type ParticipantAnswers = Record<string, string>;

/** Length limits from docs/REQUIREMENTS.md. */
export const LIMITS = {
  studyTitle: 200,
  studyDescription: 5000,
  studyInstructions: 2000,
  cardLabel: 200,
  cardDescription: 1000,
  groupName: 100,
  participantText: 200,
  customAnswer: 500,
  customFieldLabel: 200,
  maxFixedGroups: 30,
  maxCards: 200,
  maxPredefinedGroups: 30,
  maxParticipantGroupsCap: 100,
  maxParticipantCards: 100,
} as const;
