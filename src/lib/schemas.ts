// zod schemas shared by client forms and server endpoints (NFR-06).
import { z } from "zod";
import { GROUP_MODES, LIMITS, SORT_TYPES, STUDY_STATUSES } from "./types";
import { BUILT_IN_FIELD_KEYS } from "./participant-fields";

/** Client- or server-generated entity id (nanoid alphabet). */
export const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid id");

// ---------------------------------------------------------------------------
// Study settings (PERM-*). See DESIGN §5.
// ---------------------------------------------------------------------------

export const StudySettingsSchema = z.object({
  allowParticipantCards: z.boolean().default(false), // PERM-01
  allowEditOwnCards: z.boolean().default(true), // PERM-02
  allowRenameGroups: z.boolean().default(true), // PERM-03
  allowDeleteGroups: z.boolean().default(true), // PERM-04
  requireAllSorted: z.boolean().default(false), // PERM-05
  requireGroupNames: z.boolean().default(true), // PERM-06
  allowEmptyGroups: z.boolean().default(true), // PERM-07
  randomizeCardOrder: z.boolean().default(true), // PERM-08
  showCardDescriptions: z.boolean().default(true), // PERM-09
});
export type StudySettings = z.infer<typeof StudySettingsSchema>;
export const DEFAULT_SETTINGS: StudySettings = StudySettingsSchema.parse({});

// ---------------------------------------------------------------------------
// Participant field configuration (PFLD-*). See DESIGN §6.
// ---------------------------------------------------------------------------

export const FieldModeSchema = z.enum(["optional", "required"]);
export type FieldMode = z.infer<typeof FieldModeSchema>;

export const BuiltInFieldConfigSchema = z.object({
  key: z.enum(BUILT_IN_FIELD_KEYS),
  mode: FieldModeSchema,
});

export const CustomFieldConfigSchema = z.object({
  key: z.string().regex(/^custom_[A-Za-z0-9]{1,32}$/, "Custom field keys look like custom_xxx"),
  label: z.string().trim().min(1).max(LIMITS.customFieldLabel),
  mode: FieldModeSchema,
});

export const ParticipantFieldConfigSchema = z.union([
  BuiltInFieldConfigSchema,
  CustomFieldConfigSchema,
]);
export type ParticipantFieldConfig = z.infer<typeof ParticipantFieldConfigSchema>;

/** Ordered list; order = display order (PFLD-03); absent = "off". Keys must be unique. */
export const ParticipantFieldsSchema = z
  .array(ParticipantFieldConfigSchema)
  .max(30)
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
    message: "Duplicate participant field",
  });

export const DEFAULT_PARTICIPANT_FIELDS: ParticipantFieldConfig[] = [
  { key: "name", mode: "required" },
];

// ---------------------------------------------------------------------------
// Admin inputs (stream C validates combinations in the service layer).
// ---------------------------------------------------------------------------

const title = z.string().trim().min(1, "Title is required").max(LIMITS.studyTitle);
const groupName = z.string().trim().min(1, "Name is required").max(LIMITS.groupName);
const cardLabel = z.string().trim().min(1, "Label is required").max(LIMITS.cardLabel);
const cardDescription = z.string().trim().max(LIMITS.cardDescription);

export const CreateStudyInputSchema = z.object({
  title,
  description: z.string().max(LIMITS.studyDescription).default(""),
  instructions: z.string().max(LIMITS.studyInstructions).default(""),
  sortType: z.enum(SORT_TYPES),
  groupMode: z.enum(GROUP_MODES).default("unbounded"),
  fixedGroupCount: z.number().int().min(1).max(LIMITS.maxFixedGroups).nullable().default(null),
});
export type CreateStudyInput = z.infer<typeof CreateStudyInputSchema>;

export const UpdateStudyInputSchema = z
  .object({
    title,
    description: z.string().max(LIMITS.studyDescription),
    instructions: z.string().max(LIMITS.studyInstructions),
    sortType: z.enum(SORT_TYPES),
    groupMode: z.enum(GROUP_MODES),
    fixedGroupCount: z.number().int().min(1).max(LIMITS.maxFixedGroups).nullable(),
    maxParticipantGroups: z
      .number()
      .int()
      .min(1)
      .max(LIMITS.maxParticipantGroupsCap)
      .nullable(),
    settings: StudySettingsSchema,
    participantFields: ParticipantFieldsSchema,
  })
  .partial();
export type UpdateStudyInput = z.infer<typeof UpdateStudyInputSchema>;

export const StudyStatusInputSchema = z.object({ status: z.enum(STUDY_STATUSES) });

export const CardInputSchema = z.object({
  label: cardLabel,
  description: cardDescription.nullable().default(null),
});
export type CardInput = z.infer<typeof CardInputSchema>;

export const BulkCardsInputSchema = z.object({ text: z.string().max(100_000) });

export const GroupInputSchema = z.object({ name: groupName });
export type GroupInput = z.infer<typeof GroupInputSchema>;

export const ReorderInputSchema = z.object({ ids: z.array(IdSchema).max(500) });

export const BoardExcludedInputSchema = z.object({ excluded: z.boolean() });

// ---------------------------------------------------------------------------
// Participant board operations (SAVE-*, BRD-*). See DESIGN §7–8.
// IDs for new groups/cards are generated by the client (nanoid) so the UI can
// apply ops optimistically; the server validates format and uniqueness.
// ---------------------------------------------------------------------------

/** Participant group names may be blank while editing (PERM-06 blocks completion). */
const boardGroupName = z.string().trim().max(LIMITS.groupName);

export const BoardOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("moveCard"),
    cardId: IdSchema,
    toGroupId: IdSchema.nullable(), // null = unsorted tray
    toIndex: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("addGroup"),
    groupId: IdSchema,
    name: boardGroupName,
    withCardId: IdSchema.optional(), // BRD-07: create the group containing this card
  }),
  z.object({ type: z.literal("renameGroup"), groupId: IdSchema, name: boardGroupName }),
  z.object({ type: z.literal("deleteGroup"), groupId: IdSchema }),
  z.object({
    type: z.literal("addCard"),
    cardId: IdSchema,
    label: cardLabel,
    description: cardDescription.nullable().default(null),
  }),
  z.object({
    type: z.literal("editCard"),
    cardId: IdSchema,
    label: cardLabel,
    description: cardDescription.nullable().default(null),
  }),
  z.object({ type: z.literal("deleteCard"), cardId: IdSchema }),
]);
export type BoardOp = z.infer<typeof BoardOpSchema>;
export type BoardOpInput = z.input<typeof BoardOpSchema>;

/** Body of POST /api/boards/[token]/ops */
export const BoardOpRequestSchema = z.object({
  revision: z.number().int().min(0),
  op: BoardOpSchema,
});
export type BoardOpRequest = z.infer<typeof BoardOpRequestSchema>;

/** Body of POST /api/s/[slug]/boards — validated further by buildParticipantSchema(). */
export const CreateBoardRequestSchema = z.object({
  participant: z.record(z.string(), z.string().max(LIMITS.customAnswer)).default({}),
});
