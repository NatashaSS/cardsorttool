"use client";
// Participant details form generated from the field catalogue + the study's config
// (PFLD-02, PFLD-03 order, PFLD-04 custom questions). Validates on the client with the
// same zod schema the server uses; the parent handles the request.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { GENDER_SELF_DESCRIBE_KEY, isBuiltInKey } from "@/lib/participant-fields";
import type { ParticipantFieldConfig } from "@/lib/schemas";
import { LIMITS, type ParticipantAnswers } from "@/lib/types";
import {
  emptyValues,
  firstErrorKey,
  resolveFields,
  validateAnswers,
  type FieldErrors,
  type FormValues,
  type ResolvedField,
} from "./form-logic";

const AUTOCOMPLETE: Record<string, string> = {
  name: "name",
  email: "email",
  organisation: "organization",
  role: "organization-title",
};

export type DetailsFormProps = {
  config: ParticipantFieldConfig[];
  /** Errors returned by the server (400), keyed by field. */
  serverErrors?: FieldErrors;
  /** Form-level message (e.g. study closed meanwhile, network error). */
  formMessage?: string | null;
  submitting?: boolean;
  onSubmit: (answers: ParticipantAnswers) => void;
  onBack?: () => void;
};

export function DetailsForm({
  config,
  serverErrors,
  formMessage,
  submitting = false,
  onSubmit,
  onBack,
}: DetailsFormProps) {
  const fields = useMemo(() => resolveFields(config), [config]);
  const [values, setValues] = useState<FormValues>(() => emptyValues(fields));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const controls = useRef(new Map<string, HTMLInputElement | HTMLSelectElement>());

  const errors: FieldErrors = { ...serverErrors, ...clientErrors };

  // Server-side field errors arrive after a request: focus the first one.
  useEffect(() => {
    if (serverErrors && Object.keys(serverErrors).length > 0) {
      const key = firstErrorKey(fields, serverErrors);
      if (key) controls.current.get(key)?.focus();
    }
  }, [serverErrors, fields]);

  const register = (key: string) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    if (el) controls.current.set(key, el);
    else controls.current.delete(key);
  };

  const setValue = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    // Clear a field's error as soon as the participant edits it.
    if (clientErrors[key]) {
      setClientErrors((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const result = validateAnswers(config, values);
    if (!result.ok) {
      setClientErrors(result.errors);
      // Controls don't depend on errors, so the first invalid one already exists.
      const key = firstErrorKey(fields, result.errors);
      if (key) controls.current.get(key)?.focus();
      return;
    }
    setClientErrors({});
    onSubmit(result.data);
  };

  const renderControl = (field: ResolvedField) => {
    const error = errors[field.key];
    if (field.input === "select") {
      return (
        <Field label={field.label} required={field.required} error={error}>
          {(p) => (
            <Select
              {...p}
              ref={register(field.key)}
              name={field.key}
              aria-required={field.required || undefined}
              placeholder="Select…"
              options={field.options ?? []}
              value={values[field.key] ?? ""}
              onChange={(e) => setValue(field.key, e.target.value)}
              autoComplete={field.key === "country" ? "country" : "off"}
            />
          )}
        </Field>
      );
    }
    const max = isBuiltInKey(field.key) ? LIMITS.participantText : LIMITS.customAnswer;
    return (
      <Field label={field.label} required={field.required} error={error}>
        {(p) => (
          <Input
            {...p}
            ref={register(field.key)}
            name={field.key}
            type={field.input === "email" ? "email" : "text"}
            aria-required={field.required || undefined}
            maxLength={field.input === "email" ? 254 : max}
            autoComplete={AUTOCOMPLETE[field.key] ?? "off"}
            value={values[field.key] ?? ""}
            onChange={(e) => setValue(field.key, e.target.value)}
          />
        )}
      </Field>
    );
  };

  const hasRequired = fields.some((f) => f.required);

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5" aria-label="Your details">
      <div>
        <h2 className="text-lg font-semibold">A few details before you start</h2>
        {hasRequired && (
          <p className="mt-1 text-sm text-muted">
            Fields marked <span className="text-danger">*</span> are required.
          </p>
        )}
      </div>

      {formMessage && <Notice tone="error">{formMessage}</Notice>}

      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-3">
          {renderControl(field)}
          {field.selfDescribeValue && values[field.key] === field.selfDescribeValue && (
            <Field label="Please describe your gender" required error={errors[GENDER_SELF_DESCRIBE_KEY]}>
              {(p) => (
                <Input
                  {...p}
                  ref={register(GENDER_SELF_DESCRIBE_KEY)}
                  name={GENDER_SELF_DESCRIBE_KEY}
                  aria-required
                  maxLength={100}
                  autoComplete="off"
                  value={values[GENDER_SELF_DESCRIBE_KEY] ?? ""}
                  onChange={(e) => setValue(GENDER_SELF_DESCRIBE_KEY, e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      ))}

      <div className="mt-2 flex items-center justify-between gap-3">
        {onBack ? (
          <Button variant="ghost" onClick={onBack} disabled={submitting}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Starting…" : "Start sorting"}
        </Button>
      </div>
    </form>
  );
}
