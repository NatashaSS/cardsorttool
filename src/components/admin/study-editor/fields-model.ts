// Pure helpers for editing a study's participant field config (PFLD-01/03/04).
// The config is an ordered array; order = display order; absent = "off" (DESIGN §6).
import { customAlphabet } from "nanoid";
import {
  BUILT_IN_FIELD_KEYS,
  BUILT_IN_FIELDS,
  isBuiltInKey,
  type BuiltInFieldKey,
} from "@/lib/participant-fields";
import type { FieldMode, ParticipantFieldConfig } from "@/lib/schemas";
import { LIMITS } from "@/lib/types";

export type FieldModeOrOff = FieldMode | "off";

export const MAX_PARTICIPANT_FIELDS = 30;

const customId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  10,
);

export function newCustomFieldKey(): string {
  return `custom_${customId()}`;
}

export function builtInLabel(key: BuiltInFieldKey): string {
  return BUILT_IN_FIELDS[key]().label;
}

export function fieldLabel(field: ParticipantFieldConfig): string {
  if (isBuiltInKey(field.key)) return builtInLabel(field.key);
  return "label" in field ? field.label : field.key;
}

export function isCustomField(
  field: ParticipantFieldConfig,
): field is ParticipantFieldConfig & { label: string } {
  return !isBuiltInKey(field.key) && "label" in field;
}

export function builtInMode(
  fields: ParticipantFieldConfig[],
  key: BuiltInFieldKey,
): FieldModeOrOff {
  return fields.find((f) => f.key === key)?.mode ?? "off";
}

/** The catalogue, in catalogue order, with each field's current mode. */
export function catalogue(fields: ParticipantFieldConfig[]) {
  return BUILT_IN_FIELD_KEYS.map((key) => ({
    key,
    label: builtInLabel(key),
    mode: builtInMode(fields, key),
  }));
}

/** Set a field's mode; "off" removes it, turning one on appends it at the end. */
export function setFieldMode(
  fields: ParticipantFieldConfig[],
  key: string,
  mode: FieldModeOrOff,
): ParticipantFieldConfig[] {
  const index = fields.findIndex((f) => f.key === key);
  if (mode === "off") return index === -1 ? fields : fields.filter((f) => f.key !== key);
  if (index !== -1) return fields.map((f) => (f.key === key ? { ...f, mode } : f));
  if (!isBuiltInKey(key)) return fields; // custom fields are added with addCustomField
  return [...fields, { key, mode }];
}

/** Move the field at `from` to index `to` (clamped). */
export function moveField(
  fields: ParticipantFieldConfig[],
  from: number,
  to: number,
): ParticipantFieldConfig[] {
  return arrayMove(fields, from, to);
}

export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

export function validateCustomLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return "Enter the question";
  if (trimmed.length > LIMITS.customFieldLabel) {
    return `Questions must be at most ${LIMITS.customFieldLabel} characters`;
  }
  return null;
}

export function addCustomField(
  fields: ParticipantFieldConfig[],
  label: string,
  mode: FieldMode = "optional",
  key: string = newCustomFieldKey(),
): ParticipantFieldConfig[] {
  return [...fields, { key, label: label.trim(), mode }];
}

export function renameCustomField(
  fields: ParticipantFieldConfig[],
  key: string,
  label: string,
): ParticipantFieldConfig[] {
  return fields.map((f) =>
    f.key === key && !isBuiltInKey(f.key) ? { ...f, label: label.trim() } : f,
  );
}
