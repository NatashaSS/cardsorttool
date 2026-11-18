// Database schema (DESIGN §4). Coordinator-owned: change only via a new migration
// (`npm run db:generate`), never by editing an applied migration.
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ParticipantFieldConfig, StudySettings } from "@/lib/schemas";
import {
  BOARD_STATUSES,
  GROUP_KINDS,
  GROUP_MODES,
  SORT_TYPES,
  STUDY_STATUSES,
  type ParticipantAnswers,
} from "@/lib/types";

export const studies = sqliteTable("study", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  status: text("status", { enum: STUDY_STATUSES }).notNull().default("draft"),
  sortType: text("sort_type", { enum: SORT_TYPES }).notNull(),
  groupMode: text("group_mode", { enum: GROUP_MODES }).notNull().default("unbounded"),
  fixedGroupCount: integer("fixed_group_count"),
  maxParticipantGroups: integer("max_participant_groups"),
  settings: text("settings", { mode: "json" }).$type<StudySettings>().notNull(),
  participantFields: text("participant_fields", { mode: "json" })
    .$type<ParticipantFieldConfig[]>()
    .notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const boards = sqliteTable(
  "board",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    status: text("status", { enum: BOARD_STATUSES }).notNull().default("in_progress"),
    participant: text("participant", { mode: "json" }).$type<ParticipantAnswers>().notNull(),
    /** Shuffled (or admin-ordered) predefined card ids for the tray (PERM-08). */
    cardOrder: text("card_order", { mode: "json" }).$type<string[]>().notNull(),
    revision: integer("revision").notNull().default(0),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    startedAt: text("started_at").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [index("board_study_idx").on(t.studyId, t.status)],
);

export const cards = sqliteTable(
  "card",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    /** null = predefined; set = participant-created on that board (PERM-01). */
    boardId: text("board_id").references(() => boards.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("card_study_idx").on(t.studyId), index("card_board_idx").on(t.boardId)],
);

/** "group" is an SQL keyword, hence "study_group". */
export const groups = sqliteTable(
  "study_group",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    /** null = predefined; set = belongs to one board (placeholder or participant). */
    boardId: text("board_id").references(() => boards.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: GROUP_KINDS }).notNull(),
    name: text("name").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("group_study_idx").on(t.studyId), index("group_board_idx").on(t.boardId)],
);

/** One row per sorted card; no row = card is in the unsorted tray. */
export const placements = sqliteTable(
  "placement",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.cardId] }), index("placement_group_idx").on(t.groupId)],
);

export type StudyRow = typeof studies.$inferSelect;
export type BoardRow = typeof boards.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
export type GroupRow = typeof groups.$inferSelect;
export type PlacementRow = typeof placements.$inferSelect;
