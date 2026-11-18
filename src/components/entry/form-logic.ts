// Pure helpers for the participant details form (PFLD-02, PFLD-04, PFLD-05).
// Kept free of React so they can be unit tested directly.
import { z } from "zod";
import type { ApiErrorBody } from "@/lib/api-types";
import {
  buildParticipantSchema,
  GENDER_SELF_DESCRIBE_KEY,
  resolveFields,
  type FieldDefinition,
} from "@/lib/participant-fields";
import type { ParticipantFieldConfig } from "@/lib/schemas";
import type { ParticipantAnswers } from "@/lib/types";

export type ResolvedField = FieldDefinition & { required: boolean };
export type FormValues = Record<string, string>;
export type FieldErrors = Record<string, string>;

export type ValidationResult =
  | { ok: true; data: ParticipantAnswers }
  | { ok: false; errors: FieldErrors };

/** PFLD-05: a study with no enabled fields skips the details form. */
export function hasDetailsForm(config: ParticipantFieldConfig[]): boolean {
  return config.length > 0;
}

/** Keys in display order, including the gender self-describe input right after gender. */
export function fieldOrder(fields: ResolvedField[]): string[] {
  return fields.flatMap((f) => (f.selfDescribeValue ? [f.key, GENDER_SELF_DESCRIBE_KEY] : [f.key]));
}

export function emptyValues(fields: ResolvedField[]): FormValues {
  return Object.fromEntries(fieldOrder(fields).map((k) => [k, ""]));
}

/** Take the first message per key from a zod flattenError() fieldErrors map. */
export function firstErrors(fieldErrors: Record<string, string[] | undefined> | undefined): FieldErrors {
  const out: FieldErrors = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages && messages.length > 0) out[key] = messages[0];
  }
  return out;
}

/** Client-side validation with the same schema the server uses (PFLD-02). */
export function validateAnswers(config: ParticipantFieldConfig[], values: FormValues): ValidationResult {
  const result = buildParticipantSchema(config).safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const flat = z.flattenError(result.error);
  const errors = firstErrors(flat.fieldErrors as Record<string, string[] | undefined>);
  if (Object.keys(errors).length === 0) errors._form = flat.formErrors[0] ?? "Please check your answers";
  return { ok: false, errors };
}

/** Key of the first field (in display order) that has an error, for focusing. */
export function firstErrorKey(fields: ResolvedField[], errors: FieldErrors): string | null {
  return fieldOrder(fields).find((k) => errors[k]) ?? null;
}

export { resolveFields };

// ---------------------------------------------------------------------------
// POST /api/s/[slug]/boards
// ---------------------------------------------------------------------------

export type CreateBoardResult =
  | { ok: true; token: string }
  | { ok: false; kind: "invalid"; errors: FieldErrors; message?: string }
  | { ok: false; kind: "not_live" | "not_found" | "error"; message: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** PART-02: create a board for the participant. Never throws. */
export async function createBoardRequest(
  slug: string,
  participant: ParticipantAnswers,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateBoardResult> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/s/${encodeURIComponent(slug)}/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant }),
    });
  } catch {
    return { ok: false, kind: "error", message: "We couldn't reach the server. Check your connection and try again." };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (res.status === 201 || res.ok) {
    const token = (body as { token?: unknown } | null)?.token;
    if (typeof token === "string" && token) return { ok: true, token };
    return { ok: false, kind: "error", message: GENERIC_ERROR };
  }

  const error = (body as ApiErrorBody | null)?.error;
  if (res.status === 400) {
    const details = error?.details as
      | { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> }
      | undefined;
    return {
      ok: false,
      kind: "invalid",
      errors: firstErrors(details?.fieldErrors),
      message: details?.formErrors?.[0] ?? "Please check the highlighted answers.",
    };
  }
  if (res.status === 409 && error?.code === "study_not_live") {
    return { ok: false, kind: "not_live", message: "This study is no longer accepting responses." };
  }
  if (res.status === 404) {
    return { ok: false, kind: "not_found", message: "This study could not be found." };
  }
  return { ok: false, kind: "error", message: error?.message ?? GENERIC_ERROR };
}

export const boardPath = (slug: string, token: string) =>
  `/s/${encodeURIComponent(slug)}/b/${encodeURIComponent(token)}`;
