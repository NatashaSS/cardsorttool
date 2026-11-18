import type { StudyRulesConfig } from "@/lib/api-types";
import { DEFAULT_SETTINGS, type StudySettings } from "@/lib/schemas";

/** Build a StudyRulesConfig for pure-rule tests. Defaults: live closed study. */
export function rulesConfig(
  overrides: Partial<Omit<StudyRulesConfig, "settings">> & { settings?: Partial<StudySettings> } = {},
): StudyRulesConfig {
  const { settings, ...rest } = overrides;
  return {
    status: "live",
    sortType: "closed",
    groupMode: "unbounded",
    fixedGroupCount: null,
    maxParticipantGroups: null,
    ...rest,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}
