// Stream C — study management (STU-*, PERM config, PFLD config). DESIGN §4–6.
// All functions are synchronous (better-sqlite3) and take the db handle first.
import "server-only";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type {
  AdminCardDTO,
  AdminGroupDTO,
  BulkAddCardsResponse,
  StudyDetailDTO,
  StudySummaryDTO,
} from "@/lib/api-types";
import {
  DEFAULT_PARTICIPANT_FIELDS,
  DEFAULT_SETTINGS,
  ParticipantFieldsSchema,
  StudySettingsSchema,
  type CardInput,
  type CreateStudyInput,
  type GroupInput,
  type ParticipantFieldConfig,
  type StudySettings,
  type UpdateStudyInput,
} from "@/lib/schemas";
import {
  LIMITS,
  STUDY_STATUS_TRANSITIONS,
  type GroupMode,
  type SortType,
  type StudyStatus,
} from "@/lib/types";
import type { DB } from "../db/client";
import {
  boards,
  cardImages,
  cards,
  groups,
  studies,
  type CardRow,
  type GroupRow,
  type StudyRow,
} from "../db/schema";
import { env } from "../env";
import { ServiceError, badRequest, notFound } from "../errors";
import { newId, newStudySlug, nowIso } from "../ids";
import { copyCardImages, imageUrlOf } from "./card-images";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BoardCounts = { inProgress: number; completed: number };

/** The db handle or a transaction on it; helpers accept either. */
type Conn = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

function loadStudy(db: Conn, studyId: string): StudyRow {
  const row = db.select().from(studies).where(eq(studies.id, studyId)).get();
  if (!row) throw notFound("Study not found");
  return row;
}

function assertDraft(study: StudyRow, what = "This change"): void {
  if (study.status !== "draft") {
    throw new ServiceError(
      "study_locked",
      `${what} is only possible while the study is a draft (it is ${study.status}).`,
    );
  }
}

/** Settings are JSON; validate on read and fill defaults for keys added later. */
function readSettings(raw: unknown): StudySettings {
  const parsed = StudySettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

function readParticipantFields(raw: unknown): ParticipantFieldConfig[] {
  const parsed = ParticipantFieldsSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : [...DEFAULT_PARTICIPANT_FIELDS];
}

function validated<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw badRequest(`Invalid ${what}`);
  return parsed.data;
}

function boardCountsFor(db: Conn, studyId: string): BoardCounts {
  const rows = db
    .select({ status: boards.status, n: count() })
    .from(boards)
    .where(eq(boards.studyId, studyId))
    .groupBy(boards.status)
    .all();
  const counts: BoardCounts = { inProgress: 0, completed: 0 };
  for (const r of rows) {
    if (r.status === "in_progress") counts.inProgress = r.n;
    else if (r.status === "completed") counts.completed = r.n;
  }
  return counts;
}

function predefinedCards(db: Conn, studyId: string): CardRow[] {
  return db
    .select()
    .from(cards)
    .where(and(eq(cards.studyId, studyId), isNull(cards.boardId)))
    .orderBy(asc(cards.position), asc(cards.createdAt))
    .all();
}

function predefinedGroups(db: Conn, studyId: string): GroupRow[] {
  return db
    .select()
    .from(groups)
    .where(and(eq(groups.studyId, studyId), isNull(groups.boardId), eq(groups.kind, "predefined")))
    .orderBy(asc(groups.position))
    .all();
}

/** A card row plus its image's updated_at (null = no image), from a left join. */
type CardWithImage = CardRow & { imageUpdatedAt: string | null };

/** Predefined cards with image info: one left join that never reads the BLOB (STU-13). */
function predefinedCardsWithImages(db: Conn, studyId: string): CardWithImage[] {
  return db
    .select({ card: cards, imageUpdatedAt: cardImages.updatedAt })
    .from(cards)
    .leftJoin(cardImages, eq(cardImages.cardId, cards.id))
    .where(and(eq(cards.studyId, studyId), isNull(cards.boardId)))
    .orderBy(asc(cards.position), asc(cards.createdAt))
    .all()
    .map((r) => ({ ...r.card, imageUpdatedAt: r.imageUpdatedAt }));
}

function imageUpdatedAtOf(db: Conn, cardId: string): string | null {
  return (
    db
      .select({ updatedAt: cardImages.updatedAt })
      .from(cardImages)
      .where(eq(cardImages.cardId, cardId))
      .get()?.updatedAt ?? null
  );
}

const toCardDTO = (c: CardRow, imageUpdatedAt: string | null = null): AdminCardDTO => ({
  id: c.id,
  label: c.label,
  description: c.description,
  position: c.position,
  imageUrl: imageUrlOf(c.id, imageUpdatedAt),
});

const withImageToDTO = (c: CardWithImage): AdminCardDTO => toCardDTO(c, c.imageUpdatedAt);

const toGroupDTO = (g: GroupRow): AdminGroupDTO => ({
  id: g.id,
  name: g.name,
  position: g.position,
});

const normalizeKey = (s: string) => s.trim().toLowerCase();

const normalizeDescription = (d: string | null | undefined): string | null => {
  const trimmed = (d ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

function touch(db: Conn, studyId: string): void {
  db.update(studies).set({ updatedAt: nowIso() }).where(eq(studies.id, studyId)).run();
}

function toDetail(db: Conn, row: StudyRow): StudyDetailDTO {
  return {
    id: row.id,
    slug: row.slug,
    shareUrl: `${env.publicBaseUrl}/s/${row.slug}`,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    status: row.status,
    sortType: row.sortType,
    groupMode: row.groupMode,
    fixedGroupCount: row.fixedGroupCount,
    maxParticipantGroups: row.maxParticipantGroups,
    settings: readSettings(row.settings),
    participantFields: readParticipantFields(row.participantFields),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cards: predefinedCardsWithImages(db, row.id).map(withImageToDTO),
    groups: predefinedGroups(db, row.id).map(toGroupDTO),
    boardCounts: boardCountsFor(db, row.id),
  };
}

type SortConfig = {
  sortType: SortType;
  groupMode: GroupMode;
  fixedGroupCount: number | null;
  maxParticipantGroups: number | null;
};

/**
 * Validate and normalise the sort type / group mode combination (STU-04/05/06):
 * - "fixed" requires an open sort and a fixedGroupCount in 1..30;
 * - closed/hybrid store groupMode "unbounded" and fixedGroupCount null;
 * - maxParticipantGroups only applies to open-unbounded and hybrid (null otherwise).
 * `explicitGroupMode` is the group mode the caller asked for (if any): asking for "fixed" on a
 * closed/hybrid sort is an error, whereas a stale stored "fixed" is silently normalised.
 */
function normalizeSortConfig(cfg: SortConfig, explicitGroupMode?: GroupMode): SortConfig {
  const { sortType } = cfg;
  if (sortType !== "open") {
    if (explicitGroupMode === "fixed") {
      throw new ServiceError(
        "unprocessable",
        "A fixed number of groups is only available for open sorts.",
      );
    }
    return {
      sortType,
      groupMode: "unbounded",
      fixedGroupCount: null,
      maxParticipantGroups: sortType === "hybrid" ? checkMax(cfg.maxParticipantGroups) : null,
    };
  }
  if (cfg.groupMode === "fixed") {
    const n = cfg.fixedGroupCount;
    if (n === null || !Number.isInteger(n) || n < 1 || n > LIMITS.maxFixedGroups) {
      throw new ServiceError(
        "unprocessable",
        `A fixed-group open sort needs a number of groups between 1 and ${LIMITS.maxFixedGroups}.`,
      );
    }
    return { sortType, groupMode: "fixed", fixedGroupCount: n, maxParticipantGroups: null };
  }
  return {
    sortType,
    groupMode: "unbounded",
    fixedGroupCount: null,
    maxParticipantGroups: checkMax(cfg.maxParticipantGroups),
  };
}

function checkMax(max: number | null): number | null {
  if (max === null) return null;
  if (!Number.isInteger(max) || max < 1 || max > LIMITS.maxParticipantGroupsCap) {
    throw new ServiceError(
      "unprocessable",
      `The maximum number of participant groups must be between 1 and ${LIMITS.maxParticipantGroupsCap}.`,
    );
  }
  return max;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Studies
// ---------------------------------------------------------------------------

export function listStudies(db: DB): StudySummaryDTO[] {
  const rows = db.select().from(studies).orderBy(desc(studies.createdAt), asc(studies.id)).all();
  const countRows = db
    .select({ studyId: boards.studyId, status: boards.status, n: count() })
    .from(boards)
    .groupBy(boards.studyId, boards.status)
    .all();
  const countsByStudy = new Map<string, BoardCounts>();
  for (const r of countRows) {
    const c = countsByStudy.get(r.studyId) ?? { inProgress: 0, completed: 0 };
    if (r.status === "in_progress") c.inProgress = r.n;
    else if (r.status === "completed") c.completed = r.n;
    countsByStudy.set(r.studyId, c);
  }
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    sortType: row.sortType,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    boardCounts: countsByStudy.get(row.id) ?? { inProgress: 0, completed: 0 },
  }));
}

/** @throws ServiceError not_found */
export function getStudy(db: DB, studyId: string): StudyDetailDTO {
  return toDetail(db, loadStudy(db, studyId));
}

/** New studies start as draft with DEFAULT_SETTINGS and DEFAULT_PARTICIPANT_FIELDS. */
export function createStudy(db: DB, input: CreateStudyInput): StudyDetailDTO {
  const title = input.title.trim();
  if (!title) throw badRequest("Title is required");
  const sort = normalizeSortConfig(
    {
      sortType: input.sortType,
      groupMode: input.groupMode ?? "unbounded",
      fixedGroupCount: input.fixedGroupCount ?? null,
      maxParticipantGroups: null,
    },
    input.groupMode,
  );
  const now = nowIso();
  const row: StudyRow = {
    id: newId(),
    slug: newStudySlug(),
    title,
    description: input.description ?? "",
    instructions: input.instructions ?? "",
    status: "draft",
    ...sort,
    settings: { ...DEFAULT_SETTINGS },
    participantFields: DEFAULT_PARTICIPANT_FIELDS.map((f) => ({ ...f })),
    createdAt: now,
    updatedAt: now,
  };
  db.insert(studies).values(row).run();
  return toDetail(db, row);
}

/**
 * Title/description/instructions are always editable; everything else only in draft
 * (STU-03, throws study_locked). Validates sort type / group mode combinations.
 *
 * A locked field sent with its current value is not a change and is accepted on a non-draft
 * study, so an editor can submit the whole form. Switching to an open sort while predefined
 * groups exist is rejected (unprocessable) rather than deleting the groups silently.
 */
export function updateStudy(db: DB, studyId: string, input: UpdateStudyInput): StudyDetailDTO {
  return db.transaction((tx) => {
    const study = loadStudy(tx, studyId);
    const patch: Partial<StudyRow> = {};

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw badRequest("Title is required");
      patch.title = title;
    }
    if (input.description !== undefined) patch.description = input.description;
    if (input.instructions !== undefined) patch.instructions = input.instructions;

    const settings =
      input.settings === undefined
        ? undefined
        : validated(StudySettingsSchema, input.settings, "settings");
    const participantFields =
      input.participantFields === undefined
        ? undefined
        : validated(ParticipantFieldsSchema, input.participantFields, "participant fields");

    const lockedChanges: string[] = [];
    if (input.sortType !== undefined && input.sortType !== study.sortType)
      lockedChanges.push("sort type");
    if (input.groupMode !== undefined && input.groupMode !== study.groupMode)
      lockedChanges.push("group mode");
    if (input.fixedGroupCount !== undefined && input.fixedGroupCount !== study.fixedGroupCount)
      lockedChanges.push("number of groups");
    if (
      input.maxParticipantGroups !== undefined &&
      input.maxParticipantGroups !== study.maxParticipantGroups
    )
      lockedChanges.push("maximum participant groups");
    if (settings !== undefined && !sameJson(settings, readSettings(study.settings)))
      lockedChanges.push("participant permissions");
    if (
      participantFields !== undefined &&
      !sameJson(participantFields, readParticipantFields(study.participantFields))
    )
      lockedChanges.push("participant fields");

    if (lockedChanges.length > 0) {
      assertDraft(study, `Changing the ${lockedChanges.join(", ")}`);

      const sort = normalizeSortConfig(
        {
          sortType: input.sortType ?? study.sortType,
          groupMode: input.groupMode ?? study.groupMode,
          fixedGroupCount:
            input.fixedGroupCount !== undefined ? input.fixedGroupCount : study.fixedGroupCount,
          maxParticipantGroups:
            input.maxParticipantGroups !== undefined
              ? input.maxParticipantGroups
              : study.maxParticipantGroups,
        },
        input.groupMode,
      );
      if (
        sort.sortType === "open" &&
        study.sortType !== "open" &&
        predefinedGroups(tx, studyId).length > 0
      ) {
        throw new ServiceError(
          "unprocessable",
          "Open sorts have no predefined groups. Remove the predefined groups before switching to an open sort.",
        );
      }
      Object.assign(patch, sort);
      if (settings !== undefined) patch.settings = settings;
      if (participantFields !== undefined) patch.participantFields = participantFields;
    }

    patch.updatedAt = nowIso();
    tx.update(studies).set(patch).where(eq(studies.id, studyId)).run();
    return toDetail(tx, loadStudy(tx, studyId));
  });
}

/** STU-01: boards, cards, groups and placements are removed by ON DELETE CASCADE. */
export function deleteStudy(db: DB, studyId: string): void {
  const res = db.delete(studies).where(eq(studies.id, studyId)).run();
  if (res.changes === 0) throw notFound("Study not found");
}

/** STU-03 transitions; publishing validates STU-09/STU-10 (throws unprocessable). */
export function setStudyStatus(db: DB, studyId: string, status: StudyStatus): StudyDetailDTO {
  return db.transaction((tx) => {
    const study = loadStudy(tx, studyId);
    if (!STUDY_STATUS_TRANSITIONS[study.status].includes(status)) {
      throw new ServiceError(
        "unprocessable",
        `A ${study.status} study cannot be changed to ${status}.`,
      );
    }
    if (status === "live") {
      const problems: string[] = [];
      if (predefinedCards(tx, studyId).length === 0)
        problems.push("Add at least one card before publishing.");
      if (study.sortType !== "open" && predefinedGroups(tx, studyId).length === 0) {
        problems.push(`A ${study.sortType} sort needs at least one group before publishing.`);
      }
      if (problems.length > 0) {
        throw new ServiceError("unprocessable", problems.join(" "), { problems });
      }
    }
    tx.update(studies).set({ status, updatedAt: nowIso() }).where(eq(studies.id, studyId)).run();
    return toDetail(tx, loadStudy(tx, studyId));
  });
}

/** STU-12: new draft copy with settings, cards, groups and fields; no boards. */
export function duplicateStudy(db: DB, studyId: string): StudyDetailDTO {
  return db.transaction((tx) => {
    const src = loadStudy(tx, studyId);
    const now = nowIso();
    const copy: StudyRow = {
      ...src,
      id: newId(),
      slug: newStudySlug(),
      title: `Copy of ${src.title}`.slice(0, LIMITS.studyTitle),
      status: "draft",
      settings: readSettings(src.settings),
      participantFields: readParticipantFields(src.participantFields),
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(studies).values(copy).run();
    const cardIdMap = new Map<string, string>();
    for (const c of predefinedCards(tx, studyId)) {
      const id = newId();
      cardIdMap.set(c.id, id);
      tx.insert(cards)
        .values({ ...c, id, studyId: copy.id, boardId: null, createdAt: now })
        .run();
    }
    copyCardImages(tx, cardIdMap);
    for (const g of predefinedGroups(tx, studyId)) {
      tx.insert(groups)
        .values({ ...g, id: newId(), studyId: copy.id, boardId: null })
        .run();
    }
    return toDetail(tx, copy);
  });
}

// --- Predefined cards (STU-07, STU-08) -------------------------------------

function cleanLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) throw badRequest("Label is required");
  if (trimmed.length > LIMITS.cardLabel)
    throw badRequest(`Label must be at most ${LIMITS.cardLabel} characters`);
  return trimmed;
}

function cleanCardDescription(description: string | null | undefined): string | null {
  const d = normalizeDescription(description);
  if (d !== null && d.length > LIMITS.cardDescription) {
    throw badRequest(`Description must be at most ${LIMITS.cardDescription} characters`);
  }
  return d;
}

function assertUniqueLabel(existing: CardRow[], label: string, exceptId?: string): void {
  const key = normalizeKey(label);
  if (existing.some((c) => c.id !== exceptId && normalizeKey(c.label) === key)) {
    throw new ServiceError("conflict", `A card labelled "${label}" already exists in this study.`);
  }
}

function loadPredefinedCard(db: Conn, studyId: string, cardId: string): CardRow {
  const card = db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.studyId, studyId), isNull(cards.boardId)))
    .get();
  if (!card) throw notFound("Card not found");
  return card;
}

export function addCard(db: DB, studyId: string, input: CardInput): AdminCardDTO {
  return db.transaction((tx) => {
    assertDraft(loadStudy(tx, studyId), "Editing cards");
    const label = cleanLabel(input.label);
    const description = cleanCardDescription(input.description);
    const existing = predefinedCards(tx, studyId);
    if (existing.length >= LIMITS.maxCards) {
      throw new ServiceError("unprocessable", `A study can have at most ${LIMITS.maxCards} cards.`);
    }
    assertUniqueLabel(existing, label);
    const row: CardRow = {
      id: newId(),
      studyId,
      boardId: null,
      label,
      description,
      position: existing.length,
      createdAt: nowIso(),
    };
    tx.insert(cards).values(row).run();
    touch(tx, studyId);
    return toCardDTO(row);
  });
}

export function updateCard(
  db: DB,
  studyId: string,
  cardId: string,
  input: CardInput,
): AdminCardDTO {
  return db.transaction((tx) => {
    assertDraft(loadStudy(tx, studyId), "Editing cards");
    const card = loadPredefinedCard(tx, studyId, cardId);
    const label = cleanLabel(input.label);
    const description = cleanCardDescription(input.description);
    assertUniqueLabel(predefinedCards(tx, studyId), label, cardId);
    tx.update(cards).set({ label, description }).where(eq(cards.id, cardId)).run();
    touch(tx, studyId);
    return toCardDTO({ ...card, label, description }, imageUpdatedAtOf(tx, cardId));
  });
}

export function deleteCard(db: DB, studyId: string, cardId: string): void {
  db.transaction((tx) => {
    assertDraft(loadStudy(tx, studyId), "Editing cards");
    loadPredefinedCard(tx, studyId, cardId);
    tx.delete(cards).where(eq(cards.id, cardId)).run();
    predefinedCards(tx, studyId).forEach((c, i) => {
      if (c.position !== i) tx.update(cards).set({ position: i }).where(eq(cards.id, c.id)).run();
    });
    touch(tx, studyId);
  });
}

function assertPermutation(currentIds: string[], ids: string[], what: string): void {
  const current = new Set(currentIds);
  const given = new Set(ids);
  if (
    ids.length !== currentIds.length ||
    given.size !== ids.length ||
    ids.some((id) => !current.has(id))
  ) {
    throw badRequest(`Reorder must list every ${what} of the study exactly once`);
  }
}

/** `ids` must be exactly the study's predefined card ids, in the new order. */
export function reorderCards(db: DB, studyId: string, ids: string[]): AdminCardDTO[] {
  return db.transaction((tx) => {
    assertDraft(loadStudy(tx, studyId), "Reordering cards");
    assertPermutation(
      predefinedCards(tx, studyId).map((c) => c.id),
      ids,
      "card",
    );
    ids.forEach((id, position) => {
      tx.update(cards).set({ position }).where(eq(cards.id, id)).run();
    });
    touch(tx, studyId);
    return predefinedCardsWithImages(tx, studyId).map(withImageToDTO);
  });
}

/** One card per line; blank lines ignored; duplicates (case-insensitive) skipped. */
export function bulkAddCards(db: DB, studyId: string, text: string): BulkAddCardsResponse {
  return db.transaction((tx) => {
    assertDraft(loadStudy(tx, studyId), "Editing cards");
    const existing = predefinedCards(tx, studyId);
    const seen = new Set(existing.map((c) => normalizeKey(c.label)));
    const toAdd: string[] = [];
    const skipped: string[] = [];
    const tooLong: number[] = [];
    text.split(/\r\n|\r|\n/).forEach((line, index) => {
      const label = line.trim();
      if (!label) return;
      if (label.length > LIMITS.cardLabel) {
        tooLong.push(index + 1);
        return;
      }
      const key = normalizeKey(label);
      if (seen.has(key)) {
        skipped.push(label);
        return;
      }
      seen.add(key);
      toAdd.push(label);
    });
    if (tooLong.length > 0) {
      throw badRequest(
        `Card labels must be at most ${LIMITS.cardLabel} characters (line ${tooLong.join(", ")})`,
        {
          lines: tooLong,
        },
      );
    }
    if (existing.length + toAdd.length > LIMITS.maxCards) {
      throw new ServiceError(
        "unprocessable",
        `A study can have at most ${LIMITS.maxCards} cards; this would make ${existing.length + toAdd.length}.`,
      );
    }
    const now = nowIso();
    const added: AdminCardDTO[] = toAdd.map((label, i) => {
      const row: CardRow = {
        id: newId(),
        studyId,
        boardId: null,
        label,
        description: null,
        position: existing.length + i,
        createdAt: now,
      };
      tx.insert(cards).values(row).run();
      return toCardDTO(row);
    });
    if (added.length > 0) touch(tx, studyId);
    return { added, skipped };
  });
}

// --- Predefined groups (STU-09) ---------------------------------------------

function assertGroupsEditable(study: StudyRow): void {
  assertDraft(study, "Editing groups");
  if (study.sortType === "open") {
    throw new ServiceError(
      "unprocessable",
      "Open sorts have no predefined groups; participants create them.",
    );
  }
}

function cleanGroupName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("Name is required");
  if (trimmed.length > LIMITS.groupName)
    throw badRequest(`Name must be at most ${LIMITS.groupName} characters`);
  return trimmed;
}

function assertUniqueGroupName(existing: GroupRow[], name: string, exceptId?: string): void {
  const key = normalizeKey(name);
  if (existing.some((g) => g.id !== exceptId && normalizeKey(g.name) === key)) {
    throw new ServiceError("conflict", `A group named "${name}" already exists in this study.`);
  }
}

function loadPredefinedGroup(db: Conn, studyId: string, groupId: string): GroupRow {
  const group = db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, groupId),
        eq(groups.studyId, studyId),
        isNull(groups.boardId),
        eq(groups.kind, "predefined"),
      ),
    )
    .get();
  if (!group) throw notFound("Group not found");
  return group;
}

export function addGroup(db: DB, studyId: string, input: GroupInput): AdminGroupDTO {
  return db.transaction((tx) => {
    assertGroupsEditable(loadStudy(tx, studyId));
    const name = cleanGroupName(input.name);
    const existing = predefinedGroups(tx, studyId);
    if (existing.length >= LIMITS.maxPredefinedGroups) {
      throw new ServiceError(
        "unprocessable",
        `A study can have at most ${LIMITS.maxPredefinedGroups} groups.`,
      );
    }
    assertUniqueGroupName(existing, name);
    const row: GroupRow = {
      id: newId(),
      studyId,
      boardId: null,
      kind: "predefined",
      name,
      position: existing.length,
    };
    tx.insert(groups).values(row).run();
    touch(tx, studyId);
    return toGroupDTO(row);
  });
}

export function updateGroup(
  db: DB,
  studyId: string,
  groupId: string,
  input: GroupInput,
): AdminGroupDTO {
  return db.transaction((tx) => {
    assertGroupsEditable(loadStudy(tx, studyId));
    const group = loadPredefinedGroup(tx, studyId, groupId);
    const name = cleanGroupName(input.name);
    assertUniqueGroupName(predefinedGroups(tx, studyId), name, groupId);
    tx.update(groups).set({ name }).where(eq(groups.id, groupId)).run();
    touch(tx, studyId);
    return toGroupDTO({ ...group, name });
  });
}

export function deleteGroup(db: DB, studyId: string, groupId: string): void {
  db.transaction((tx) => {
    assertGroupsEditable(loadStudy(tx, studyId));
    loadPredefinedGroup(tx, studyId, groupId);
    tx.delete(groups).where(eq(groups.id, groupId)).run();
    predefinedGroups(tx, studyId).forEach((g, i) => {
      if (g.position !== i) tx.update(groups).set({ position: i }).where(eq(groups.id, g.id)).run();
    });
    touch(tx, studyId);
  });
}

export function reorderGroups(db: DB, studyId: string, ids: string[]): AdminGroupDTO[] {
  return db.transaction((tx) => {
    assertGroupsEditable(loadStudy(tx, studyId));
    assertPermutation(
      predefinedGroups(tx, studyId).map((g) => g.id),
      ids,
      "group",
    );
    ids.forEach((id, position) => {
      tx.update(groups).set({ position }).where(eq(groups.id, id)).run();
    });
    touch(tx, studyId);
    return predefinedGroups(tx, studyId).map(toGroupDTO);
  });
}
