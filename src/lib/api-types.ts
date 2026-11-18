// DTOs exchanged between server and client. These are the contracts between
// parallel streams — change them only via the coordinator (IMPLEMENTATION_PLAN §2).
import type {
  BoardStatus,
  CardOrigin,
  GroupKind,
  GroupMode,
  ParticipantAnswers,
  SortType,
  StudyStatus,
} from "./types";
import type { ParticipantFieldConfig, StudySettings } from "./schemas";

/** Error body returned by every endpoint on failure. */
export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; details?: unknown };
};

export type ErrorCode =
  | "bad_request" // 400 invalid input
  | "unauthorized" // 401 no admin session
  | "forbidden" // 403 action not permitted by study settings
  | "not_found" // 404
  | "conflict" // 409 generic conflict (e.g. duplicate label)
  | "stale_revision" // 409 board revision mismatch (SAVE-03)
  | "board_completed" // 409 board is frozen (DONE-04)
  | "study_not_live" // 409 study draft/closed (PART-06)
  | "study_locked" // 409 study config edited while not draft (STU-03)
  | "unprocessable" // 422 e.g. completion rules not met (DONE-05), cannot publish (STU-10)
  | "rate_limited" // 429
  | "internal"; // 500

// ---------------------------------------------------------------------------
// Study (shared pieces)
// ---------------------------------------------------------------------------

/** The study configuration the board rules need (permissions.ts / completion.ts). */
export type StudyRulesConfig = {
  status: StudyStatus;
  sortType: SortType;
  groupMode: GroupMode;
  fixedGroupCount: number | null;
  maxParticipantGroups: number | null;
  settings: StudySettings;
};

// ---------------------------------------------------------------------------
// Participant-facing
// ---------------------------------------------------------------------------

/** GET for the intro page /s/[slug] (PART-01). */
export type PublicStudyDTO = {
  slug: string;
  title: string;
  instructions: string;
  status: StudyStatus;
  participantFields: ParticipantFieldConfig[];
};

/** POST /api/s/[slug]/boards → */
export type CreateBoardResponse = { token: string };

export type CardDTO = {
  id: string;
  label: string;
  description: string | null;
  origin: CardOrigin;
};

export type GroupDTO = {
  id: string;
  name: string;
  kind: GroupKind;
  /** Ordered card ids in this group. */
  cardIds: string[];
};

/** GET /api/boards/[token] → full board state (also used for the admin read-only view). */
export type BoardStateDTO = {
  board: {
    id: string;
    token: string;
    status: BoardStatus;
    revision: number;
    participant: ParticipantAnswers;
    startedAt: string;
    lastActivityAt: string;
    completedAt: string | null;
  };
  study: StudyRulesConfig & {
    slug: string;
    title: string;
    instructions: string;
    participantFields: ParticipantFieldConfig[];
  };
  /** Every card on this board: predefined + this board's participant-created cards. */
  cards: CardDTO[];
  /** Ordered: predefined/placeholder groups by position, then participant groups by position. */
  groups: GroupDTO[];
  /** Ordered ids of cards in the unsorted tray. */
  unsortedCardIds: string[];
};

/** POST /api/boards/[token]/ops → */
export type BoardOpResponse = { revision: number; lastActivityAt: string };

/** POST /api/boards/[token]/complete → */
export type CompleteBoardResponse = { status: "completed"; completedAt: string };

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type StudySummaryDTO = {
  id: string;
  slug: string;
  title: string;
  sortType: SortType;
  status: StudyStatus;
  createdAt: string;
  updatedAt: string;
  boardCounts: { inProgress: number; completed: number };
};

export type AdminCardDTO = {
  id: string;
  label: string;
  description: string | null;
  position: number;
};

export type AdminGroupDTO = { id: string; name: string; position: number };

export type StudyDetailDTO = StudyRulesConfig & {
  id: string;
  slug: string;
  /** Absolute participant link (STU-11), built from PUBLIC_BASE_URL. */
  shareUrl: string;
  title: string;
  description: string;
  instructions: string;
  participantFields: ParticipantFieldConfig[];
  createdAt: string;
  updatedAt: string;
  /** Predefined cards, ordered by position. */
  cards: AdminCardDTO[];
  /** Predefined groups (closed/hybrid), ordered by position. */
  groups: AdminGroupDTO[];
  boardCounts: { inProgress: number; completed: number };
};

export type BulkAddCardsResponse = { added: AdminCardDTO[]; skipped: string[] };

export type BoardSummaryDTO = {
  id: string;
  status: BoardStatus;
  participant: ParticipantAnswers;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  excluded: boolean;
  sortedCount: number;
  totalCount: number;
};

// ---------------------------------------------------------------------------
// Analysis (ANL-*). Produced by src/server/analysis, rendered by stream I.
// ---------------------------------------------------------------------------

/** Plain input to the pure analysis functions. */
export type AnalysisInput = {
  /** Predefined cards in admin order. */
  cards: { id: string; label: string }[];
  /** Predefined groups (closed/hybrid) in admin order; [] for open sorts. */
  groups: { id: string; name: string }[];
  boards: AnalysisBoard[];
};

export type AnalysisBoard = {
  id: string;
  /** For every predefined card: where it was placed, or null if unsorted. */
  placements: Record<string, AnalysisPlacement | null>;
  participantCards: { label: string; groupName: string | null }[];
};

export type AnalysisPlacement = { groupId: string; groupKind: GroupKind; groupName: string };

export type SimilarityMatrix = {
  cardIds: string[];
  /** together[i][j]: boards where cards i and j were in the same group. */
  together: number[][];
  /** both[i][j]: boards where both cards i and j were sorted. */
  both: number[][];
  /** together / both, or null when both = 0. Diagonal = 1 when card was ever sorted. */
  ratio: (number | null)[][];
};

export type PlacementColumn =
  | { kind: "group"; id: string; label: string }
  | { kind: "other"; id: "__other"; label: string }
  | { kind: "unsorted"; id: "__unsorted"; label: string };

export type PlacementMatrix = {
  cardIds: string[];
  columns: PlacementColumn[];
  /** counts[card][column] */
  counts: number[][];
  /** counts / n, or null when n = 0 */
  ratio: (number | null)[][];
  n: number;
};

export type DendrogramNode =
  | { type: "leaf"; cardId: string }
  | {
      type: "merge";
      left: DendrogramNode;
      right: DendrogramNode;
      /** Linkage distance (0..1) at which the two clusters merged. */
      distance: number;
      size: number;
    };

export type Dendrogram = { root: DendrogramNode | null; leafOrder: string[] };

export type GroupNameStat = {
  normalizedName: string;
  /** Most common original spelling. */
  displayName: string;
  boardCount: number;
  topCards: { cardId: string; count: number }[];
};

export type ParticipantCardRow = { boardId: string; label: string; groupName: string | null };

export type AnalysisResult = {
  n: number;
  similarity: SimilarityMatrix;
  /** null for open sorts */
  placement: PlacementMatrix | null;
  dendrogram: Dendrogram;
  groupNames: GroupNameStat[];
  participantCards: ParticipantCardRow[];
};
