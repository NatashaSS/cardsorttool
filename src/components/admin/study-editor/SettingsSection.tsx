"use client";
// PERM-01..09 participant permissions. Settings that have no effect for the study's sort
// type are hidden (DESIGN §5, see settings-model.ts) and keep their stored value.
import type { StudySettings } from "@/lib/schemas";
import { SORT_TYPE_LABELS } from "./labels";
import { visibleSettings, type SettingKey } from "./settings-model";
import {
  ErrorNotice,
  LockedHint,
  Section,
  patchStudy,
  useAction,
  type SectionProps,
} from "./shared";

export function SettingsSection({ study, locked, onStudyChange }: SectionProps) {
  const { busy, error, run } = useAction();
  const settings = study.settings;
  const visible = visibleSettings(study);

  async function toggle(key: SettingKey, value: boolean) {
    const previous = settings;
    const next: StudySettings = { ...settings, [key]: value };
    onStudyChange((prev) => ({ ...prev, settings: next }));
    const updated = await run(() => patchStudy(study.id, { settings: next }));
    if (updated) onStudyChange(updated);
    else onStudyChange((prev) => ({ ...prev, settings: previous }));
  }

  const mode =
    study.sortType === "open"
      ? study.groupMode === "fixed"
        ? " (fixed number of groups)"
        : " (participants add groups)"
      : "";

  return (
    <Section
      title="Participant permissions"
      description={`What participants may do on their board. Only settings that apply to a ${SORT_TYPE_LABELS[study.sortType].toLowerCase()} sort${mode} are shown.`}
    >
      {locked && <LockedHint />}
      <ErrorNotice error={error} className="mb-4" />
      <ul className="flex flex-col divide-y divide-line">
        {visible.map((meta) => {
          const id = `setting-${meta.key}`;
          return (
            <li key={meta.key} className="flex items-start gap-3 py-3">
              <input
                id={id}
                type="checkbox"
                checked={settings[meta.key]}
                disabled={locked || busy}
                onChange={(e) => toggle(meta.key, e.target.checked)}
                aria-describedby={`${id}-hint`}
                className="mt-0.5 size-4 accent-accent"
              />
              <div>
                <label htmlFor={id} className="text-sm font-medium">
                  {meta.label}
                </label>
                <p id={`${id}-hint`} className="mt-0.5 text-sm text-muted">
                  {meta.hint}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
