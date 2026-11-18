// Participant field catalogue + validator builder (PFLD-01, PFLD-02, PFLD-04, PFLD-05).
// Both the participant form (stream F2) and the server (stream D) are driven by this file.
import { z } from "zod";
import { COUNTRY_CODES, countryOptions } from "./countries";
import { LIMITS, type ParticipantAnswers } from "./types";
import type { ParticipantFieldConfig } from "./schemas";

export const BUILT_IN_FIELD_KEYS = [
  "name",
  "email",
  "organisation",
  "role",
  "seniority",
  "ageRange",
  "gender",
  "country",
  "nationality",
] as const;
export type BuiltInFieldKey = (typeof BUILT_IN_FIELD_KEYS)[number];

export type FieldOption = { value: string; label: string };
export type FieldInputType = "text" | "email" | "select";

export type FieldDefinition = {
  key: string;
  label: string;
  input: FieldInputType;
  /** For selects. Countries are resolved lazily so the list is built once. */
  options?: FieldOption[];
  /** gender only: the option value that reveals a free-text input. */
  selfDescribeValue?: string;
};

export const SENIORITY_OPTIONS: FieldOption[] = [
  { value: "intern", label: "Intern / Student" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-level" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead / Principal" },
  { value: "manager", label: "Manager" },
  { value: "director", label: "Director" },
  { value: "executive", label: "Executive" },
  { value: "other", label: "Other" },
];

export const AGE_RANGE_OPTIONS: FieldOption[] = [
  { value: "under18", label: "Under 18" },
  { value: "18-24", label: "18–24" },
  { value: "25-34", label: "25–34" },
  { value: "35-44", label: "35–44" },
  { value: "45-54", label: "45–54" },
  { value: "55-64", label: "55–64" },
  { value: "65plus", label: "65+" },
  { value: "na", label: "Prefer not to say" },
];

export const GENDER_SELF_DESCRIBE = "self_describe";
/** Answer key holding the free text when gender = self_describe. */
export const GENDER_SELF_DESCRIBE_KEY = "genderSelfDescribe";

export const GENDER_OPTIONS: FieldOption[] = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
  { value: GENDER_SELF_DESCRIBE, label: "Prefer to self-describe" },
  { value: "na", label: "Prefer not to say" },
];

let countryOpts: FieldOption[] | null = null;
const countries = () => (countryOpts ??= countryOptions());

export const BUILT_IN_FIELDS: Record<BuiltInFieldKey, () => FieldDefinition> = {
  name: () => ({ key: "name", label: "Name", input: "text" }),
  email: () => ({ key: "email", label: "Email", input: "email" }),
  organisation: () => ({ key: "organisation", label: "Organisation", input: "text" }),
  role: () => ({ key: "role", label: "Role / job title", input: "text" }),
  seniority: () => ({ key: "seniority", label: "Seniority", input: "select", options: SENIORITY_OPTIONS }),
  ageRange: () => ({ key: "ageRange", label: "Age range", input: "select", options: AGE_RANGE_OPTIONS }),
  gender: () => ({
    key: "gender",
    label: "Gender",
    input: "select",
    options: GENDER_OPTIONS,
    selfDescribeValue: GENDER_SELF_DESCRIBE,
  }),
  country: () => ({ key: "country", label: "Country of residence", input: "select", options: countries() }),
  nationality: () => ({ key: "nationality", label: "Nationality", input: "select", options: countries() }),
};

export function isBuiltInKey(key: string): key is BuiltInFieldKey {
  return (BUILT_IN_FIELD_KEYS as readonly string[]).includes(key);
}

/** Resolve a study's field config into renderable definitions, in display order. */
export function resolveFields(
  config: ParticipantFieldConfig[],
): (FieldDefinition & { required: boolean })[] {
  return config.map((field) => {
    const required = field.mode === "required";
    if (isBuiltInKey(field.key)) return { ...BUILT_IN_FIELDS[field.key](), required };
    const label = "label" in field ? field.label : field.key;
    return { key: field.key, label, input: "text" as const, required };
  });
}

/** Human label for an answer value (e.g. "GB" → "United Kingdom"), for tables/exports. */
export function formatAnswer(fieldKey: string, value: string | undefined): string {
  if (!value) return "";
  if (!isBuiltInKey(fieldKey)) return value;
  const def = BUILT_IN_FIELDS[fieldKey]();
  return def.options?.find((o) => o.value === value)?.label ?? value;
}

function valueSchema(def: FieldDefinition): z.ZodType<string, string> {
  const isCustom = !isBuiltInKey(def.key);
  const max = isCustom ? LIMITS.customAnswer : LIMITS.participantText;
  switch (def.input) {
    case "email":
      return z.string().trim().max(254).pipe(z.email("Enter a valid email address"));
    case "select": {
      const values =
        def.key === "country" || def.key === "nationality"
          ? (COUNTRY_CODES as readonly string[])
          : (def.options ?? []).map((o) => o.value);
      return z.string().refine((v) => values.includes(v), "Choose one of the options");
    }
    default:
      return z.string().trim().min(1).max(max);
  }
}

/**
 * Build a zod schema validating participant answers for a study's field config.
 * - Unknown keys are stripped.
 * - Optional fields accept missing or "" (stored as absent).
 * - gender = self_describe requires `genderSelfDescribe` (≤ 100 chars).
 */
export function buildParticipantSchema(
  config: ParticipantFieldConfig[],
): z.ZodType<ParticipantAnswers, Record<string, unknown>> {
  const defs = resolveFields(config);
  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const def of defs) {
    const base = valueSchema(def);
    shape[def.key] = def.required
      ? z.string({ error: `${def.label} is required` }).trim().min(1, `${def.label} is required`).pipe(base)
      : z
          .string()
          .trim()
          .optional()
          .transform((v) => (v === "" ? undefined : v))
          .pipe(base.optional());
  }
  const hasGender = defs.some((d) => d.key === "gender");
  if (hasGender) {
    shape[GENDER_SELF_DESCRIBE_KEY] = z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v === "" ? undefined : v));
  }

  return z
    .object(shape)
    .superRefine((val, ctx) => {
      if (hasGender && val.gender === GENDER_SELF_DESCRIBE && !val[GENDER_SELF_DESCRIBE_KEY]) {
        ctx.addIssue({
          code: "custom",
          path: [GENDER_SELF_DESCRIBE_KEY],
          message: "Please describe your gender, or choose another option",
        });
      }
    })
    .transform((val) => {
      const out: ParticipantAnswers = {};
      for (const [k, v] of Object.entries(val)) {
        if (typeof v === "string" && v !== "") out[k] = v;
      }
      if (out.gender !== GENDER_SELF_DESCRIBE) delete out[GENDER_SELF_DESCRIBE_KEY];
      return out;
    }) as unknown as z.ZodType<ParticipantAnswers, Record<string, unknown>>;
}
