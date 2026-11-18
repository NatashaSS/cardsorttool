"use client";
// Sort type (STU-04) + open-sort group mode (STU-05) controls, shared by the create form
// and the editor.
import { Input, cn } from "@/components/ui";
import { GROUP_MODES, LIMITS, SORT_TYPES, type GroupMode, type SortType } from "@/lib/types";
import { GROUP_MODE_LABELS, SORT_TYPE_HINTS, SORT_TYPE_LABELS } from "./labels";

export type SortTypeValue = {
  sortType: SortType;
  groupMode: GroupMode;
  /** Text so the input can be blank while typing. */
  fixedGroupCount: string;
};

export function fixedCountError(value: SortTypeValue): string | null {
  if (value.sortType !== "open" || value.groupMode !== "fixed") return null;
  const n = Number(value.fixedGroupCount);
  if (!value.fixedGroupCount.trim() || !Number.isInteger(n) || n < 1 || n > LIMITS.maxFixedGroups) {
    return `Enter a whole number from 1 to ${LIMITS.maxFixedGroups}`;
  }
  return null;
}

export function SortTypeFields({
  value,
  onChange,
  disabled,
  disabledTypes = {},
}: {
  value: SortTypeValue;
  onChange: (value: SortTypeValue) => void;
  disabled?: boolean;
  /** Sort types that can't be chosen, with the reason shown. */
  disabledTypes?: Partial<Record<SortType, string>>;
}) {
  const countError = fixedCountError(value);
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-2 text-sm font-medium">Sort type</legend>
        <div className="grid grid-cols-3 gap-3">
          {SORT_TYPES.map((type) => {
            const reason = disabledTypes[type];
            const checked = value.sortType === type;
            return (
              <label
                key={type}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-md border bg-surface p-3 text-sm",
                  checked ? "border-accent ring-1 ring-accent" : "border-line hover:border-muted",
                  (disabled || reason) && "cursor-not-allowed opacity-60",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="sortType"
                    value={type}
                    checked={checked}
                    disabled={disabled || Boolean(reason)}
                    onChange={() => onChange({ ...value, sortType: type })}
                    aria-label={SORT_TYPE_LABELS[type]}
                    aria-describedby={`sort-type-hint-${type}`}
                    className="accent-accent"
                  />
                  {SORT_TYPE_LABELS[type]}
                </span>
                <span id={`sort-type-hint-${type}`} className="text-muted">
                  {SORT_TYPE_HINTS[type]}
                  {reason && <span className="mt-1 block text-xs italic">{reason}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {value.sortType === "open" && (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="mb-2 text-sm font-medium">Groups</legend>
          {GROUP_MODES.slice()
            .reverse()
            .map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="groupMode"
                  value={mode}
                  checked={value.groupMode === mode}
                  onChange={() =>
                    onChange({
                      ...value,
                      groupMode: mode,
                      fixedGroupCount: value.fixedGroupCount || "4",
                    })
                  }
                  className="accent-accent"
                />
                {GROUP_MODE_LABELS[mode]}
              </label>
            ))}
          {value.groupMode === "fixed" && (
            <div className="mt-1 ml-6 flex max-w-xs flex-col gap-1">
              <label htmlFor="fixedGroupCount" className="text-sm font-medium">
                Number of groups
              </label>
              <Input
                id="fixedGroupCount"
                type="number"
                min={1}
                max={LIMITS.maxFixedGroups}
                value={value.fixedGroupCount}
                aria-invalid={countError ? true : undefined}
                onChange={(e) => onChange({ ...value, fixedGroupCount: e.target.value })}
                className="w-28"
              />
              <p className={cn("text-xs", countError ? "text-danger" : "text-muted")}>
                {countError ??
                  "Every board starts with this many empty groups (“Group 1”, “Group 2”, …). Participants can't add or delete groups."}
              </p>
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
