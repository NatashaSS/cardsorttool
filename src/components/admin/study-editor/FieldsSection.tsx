"use client";
// PFLD-01 catalogue (off / optional / required), PFLD-03 order, PFLD-04 custom questions.
// Every change is saved immediately as the whole `participantFields` array.
import { useState, type FormEvent } from "react";
import { Button, Input, Select } from "@/components/ui";
import type { FieldMode, ParticipantFieldConfig } from "@/lib/schemas";
import { LIMITS } from "@/lib/types";
import {
  MAX_PARTICIPANT_FIELDS,
  addCustomField,
  catalogue,
  fieldLabel,
  isCustomField,
  moveField,
  renameCustomField,
  setFieldMode,
  validateCustomLabel,
  type FieldModeOrOff,
} from "./fields-model";
import { SortableList } from "./SortableList";
import {
  ErrorNotice,
  LockedHint,
  Section,
  patchStudy,
  useAction,
  type SectionProps,
} from "./shared";

const MODE_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "optional", label: "Optional" },
  { value: "required", label: "Required" },
];
const ENABLED_MODE_OPTIONS = MODE_OPTIONS.slice(1);

export function FieldsSection({ study, locked, onStudyChange }: SectionProps) {
  const fields = study.participantFields;
  const { busy, error, setError, run } = useAction();
  const [newLabel, setNewLabel] = useState("");
  const [newMode, setNewMode] = useState<FieldMode>("optional");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  async function save(next: ParticipantFieldConfig[]) {
    const previous = fields;
    onStudyChange((prev) => ({ ...prev, participantFields: next }));
    const updated = await run(() => patchStudy(study.id, { participantFields: next }));
    if (updated) onStudyChange(updated);
    else onStudyChange((prev) => ({ ...prev, participantFields: previous }));
    return Boolean(updated);
  }

  async function addCustom(e: FormEvent) {
    e.preventDefault();
    const problem = validateCustomLabel(newLabel);
    if (problem) {
      setError({ message: problem, lines: [] });
      return;
    }
    const sent = newLabel;
    if (await save(addCustomField(fields, newLabel, newMode))) {
      setNewLabel((current) => (current === sent ? "" : current));
      setNewMode("optional");
    }
  }

  async function saveLabel(key: string) {
    const problem = validateCustomLabel(editLabel);
    if (problem) {
      setError({ message: problem, lines: [] });
      return;
    }
    if (await save(renameCustomField(fields, key, editLabel))) setEditingKey(null);
  }

  const items = fields.map((f) => ({ ...f, id: f.key }));
  const full = fields.length >= MAX_PARTICIPANT_FIELDS;

  return (
    <div className="flex flex-col gap-6">
      <ErrorNotice error={error} />
      <Section
        title="Participant details"
        description="What participants are asked before they start sorting. If nothing is enabled, they go straight to the board."
      >
        {locked && <LockedHint />}
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {catalogue(fields).map((row) => (
              <tr key={row.key}>
                <td className="py-2 pr-4">
                  <label htmlFor={`field-${row.key}`}>{row.label}</label>
                </td>
                <td className="w-40 py-2">
                  <Select
                    id={`field-${row.key}`}
                    options={MODE_OPTIONS}
                    value={row.mode}
                    disabled={locked || busy || (row.mode === "off" && full)}
                    onChange={(e) =>
                      save(setFieldMode(fields, row.key, e.target.value as FieldModeOrOff))
                    }
                    className="h-8 py-1"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Custom questions"
        description={`Free-text questions of your own (answers up to ${LIMITS.customAnswer} characters).`}
      >
        {!locked && (
          <form onSubmit={addCustom} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="new-custom-question" className="text-sm font-medium">
                Question
              </label>
              <Input
                id="new-custom-question"
                value={newLabel}
                maxLength={LIMITS.customFieldLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Which product do you use most?"
              />
            </div>
            <div className="flex w-36 flex-col gap-1">
              <label htmlFor="new-custom-mode" className="text-sm font-medium">
                Answer
              </label>
              <Select
                id="new-custom-mode"
                options={ENABLED_MODE_OPTIONS}
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as FieldMode)}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={busy || full}>
              Add question
            </Button>
          </form>
        )}
        {locked && !fields.some(isCustomField) && (
          <p className="text-sm text-muted">No custom questions.</p>
        )}
        {!locked && (
          <p className="mt-2 text-xs text-muted">
            Custom questions appear in the order list below.
          </p>
        )}
      </Section>

      <Section
        title="Order on the form"
        description="Participants see the enabled questions in this order."
      >
        {fields.length === 0 ? (
          <p className="text-sm text-muted">No participant details are collected.</p>
        ) : (
          <SortableList
            label="Participant field order"
            items={items}
            itemName={(f) => fieldLabel(f)}
            onMove={(from, to) => save(moveField(fields, from, to))}
            disabled={locked || busy}
            renderItem={(f) => {
              const custom = isCustomField(f);
              if (custom && editingKey === f.key) {
                return (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveLabel(f.key);
                    }}
                  >
                    <Input
                      aria-label={`Question text for ${fieldLabel(f)}`}
                      value={editLabel}
                      maxLength={LIMITS.customFieldLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setEditingKey(null)}
                      autoFocus
                      className="h-8"
                    />
                    <Button type="submit" size="sm" disabled={busy}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>
                      Cancel
                    </Button>
                  </form>
                );
              }
              return (
                <div className="flex items-center gap-2" data-testid="field-order-item">
                  <span className="flex-1 py-1 text-sm">
                    {fieldLabel(f)}
                    {custom && <span className="ml-2 text-xs text-muted">custom</span>}
                  </span>
                  {locked ? (
                    <span className="text-xs text-muted">
                      {f.mode === "required" ? "Required" : "Optional"}
                    </span>
                  ) : (
                    <>
                      <Select
                        aria-label={`${fieldLabel(f)} answer`}
                        options={ENABLED_MODE_OPTIONS}
                        value={f.mode}
                        disabled={busy}
                        onChange={(e) =>
                          save(setFieldMode(fields, f.key, e.target.value as FieldMode))
                        }
                        className="h-8 w-32 py-1"
                      />
                      {custom && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit ${fieldLabel(f)}`}
                          onClick={() => {
                            setEditingKey(f.key);
                            setEditLabel(fieldLabel(f));
                          }}
                        >
                          Edit
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        aria-label={`Remove ${fieldLabel(f)}`}
                        disabled={busy}
                        onClick={() => save(setFieldMode(fields, f.key, "off"))}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              );
            }}
          />
        )}
      </Section>
    </div>
  );
}
