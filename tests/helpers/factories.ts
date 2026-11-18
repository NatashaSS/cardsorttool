// Insert rows directly for tests (and the seed script) without depending on services.
import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import type { DB } from "@/server/db/open";
import {
  boards,
  cards,
  groups,
  placements,
  studies,
  type BoardRow,
  type CardRow,
  type GroupRow,
  type StudyRow,
} from "@/server/db/schema";
import { DEFAULT_PARTICIPANT_FIELDS, DEFAULT_SETTINGS, type StudySettings } from "@/lib/schemas";

const now = () => new Date().toISOString();

export type StudyOverrides = Partial<Omit<StudyRow, "settings">> & {
  settings?: Partial<StudySettings>;
};

/** Defaults: a LIVE closed study with default settings. */
export function makeStudy(db: DB, overrides: StudyOverrides = {}): StudyRow {
  const { settings, ...rest } = overrides;
  const row: StudyRow = {
    id: nanoid(),
    slug: nanoid(12).toLowerCase().replace(/[^a-z0-9]/g, "x"),
    title: "Test study",
    description: "",
    instructions: "Please add the cards to groups where you feel they naturally belong",
    status: "live",
    sortType: "closed",
    groupMode: "unbounded",
    fixedGroupCount: null,
    maxParticipantGroups: null,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    participantFields: DEFAULT_PARTICIPANT_FIELDS,
    createdAt: now(),
    updatedAt: now(),
    ...rest,
  };
  db.insert(studies).values(row).run();
  return row;
}

/** Predefined card by default; pass boardId for a participant-created card. */
export function makeCard(db: DB, studyId: string, overrides: Partial<CardRow> = {}): CardRow {
  const row: CardRow = {
    id: nanoid(),
    studyId,
    boardId: null,
    label: `Card ${nanoid(4)}`,
    description: null,
    position: 0,
    createdAt: now(),
    ...overrides,
  };
  db.insert(cards).values(row).run();
  return row;
}

export function makeCards(db: DB, studyId: string, labels: string[]): CardRow[] {
  return labels.map((label, position) => makeCard(db, studyId, { label, position }));
}

/** Predefined group by default; pass boardId + kind for placeholder/participant groups. */
export function makeGroup(db: DB, studyId: string, overrides: Partial<GroupRow> = {}): GroupRow {
  const row: GroupRow = {
    id: nanoid(),
    studyId,
    boardId: null,
    kind: "predefined",
    name: `Group ${nanoid(4)}`,
    position: 0,
    ...overrides,
  };
  db.insert(groups).values(row).run();
  return row;
}

export function makeGroups(db: DB, studyId: string, names: string[]): GroupRow[] {
  return names.map((name, position) => makeGroup(db, studyId, { name, position }));
}

/** In-progress board. cardOrder defaults to [] — pass the study's card ids if needed. */
export function makeBoard(db: DB, studyId: string, overrides: Partial<BoardRow> = {}): BoardRow {
  const row: BoardRow = {
    id: nanoid(),
    studyId,
    token: randomBytes(18).toString("base64url"),
    status: "in_progress",
    participant: { name: "Test Participant" },
    cardOrder: [],
    revision: 0,
    excluded: false,
    startedAt: now(),
    lastActivityAt: now(),
    completedAt: null,
    ...overrides,
  };
  db.insert(boards).values(row).run();
  return row;
}

export function place(db: DB, boardId: string, cardId: string, groupId: string, position = 0): void {
  db.insert(placements).values({ boardId, cardId, groupId, position }).run();
}
