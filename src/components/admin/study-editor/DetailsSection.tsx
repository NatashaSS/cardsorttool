"use client";
// STU-02: title, admin-only description, participant instructions. Always editable (STU-03).
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { LIMITS } from "@/lib/types";
import {
  ErrorNotice,
  SavedHint,
  Section,
  patchStudy,
  useAction,
  type SectionProps,
} from "./shared";

export function DetailsSection({ study, onStudyChange }: SectionProps) {
  const [title, setTitle] = useState(study.title);
  const [description, setDescription] = useState(study.description);
  const [instructions, setInstructions] = useState(study.instructions);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  const dirty =
    title !== study.title ||
    description !== study.description ||
    instructions !== study.instructions;
  const titleError = !title.trim() ? "Title is required" : undefined;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (titleError) return;
    const updated = await run(() =>
      patchStudy(study.id, { title: title.trim(), description, instructions }),
    );
    if (updated) {
      onStudyChange(updated);
      setTitle(updated.title);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <Section
      title="Details"
      description="These can be changed at any time, even after the study is live."
    >
      <form onSubmit={save} className="flex flex-col gap-5" noValidate>
        <ErrorNotice error={error} />
        <Field label="Title" required error={titleError} hint="Shown to participants.">
          {(p) => (
            <Input
              {...p}
              name="title"
              value={title}
              maxLength={LIMITS.studyTitle}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Participant instructions"
          hint="Shown at the top of every participant's board."
        >
          {(p) => (
            <Textarea
              {...p}
              name="instructions"
              value={instructions}
              maxLength={LIMITS.studyInstructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Please add the cards to groups where you feel they naturally belong."
            />
          )}
        </Field>
        <Field label="Description (admin only)" hint="Private notes — participants never see this.">
          {(p) => (
            <Textarea
              {...p}
              name="description"
              value={description}
              maxLength={LIMITS.studyDescription}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="flex items-center justify-end gap-3">
          <SavedHint show={saved && !dirty} />
          <Button type="submit" disabled={busy || !dirty || Boolean(titleError)}>
            Save details
          </Button>
        </div>
      </form>
    </Section>
  );
}
