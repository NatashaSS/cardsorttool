// ANL-09: analysis filters by participant details. Pure (shared by the analysis service, the
// route handlers, the server page and the dashboard), so no Node/DB imports here.
//
// URL form: repeated `filter=<fieldKey>:<value>` parameters (split at the first ":"); the value
// "" means "not answered". Values within a field combine with OR, fields combine with AND.
import { formatAnswer, isBuiltInKey, resolveFields } from "@/lib/participant-fields";
import type { ParticipantFieldConfig } from "@/lib/schemas";
import type { ParticipantAnswers } from "@/lib/types";

/** fieldKey → accepted values ("" = not answered). Empty / absent keys don't filter. */
export type AnalysisFilter = Record<string, string[]>;

/** The value standing for "no answer" (missing or blank). */
export const NOT_ANSWERED = "";
export const NOT_ANSWERED_LABEL = "(not answered)";

/** Text fields list at most this many distinct answers (selected ones are always kept). */
export const TEXT_OPTION_LIMIT = 100;
/** Bounds on what a URL may carry (anything beyond is ignored). */
const MAX_PARAMS = 500;
const MAX_VALUE_LENGTH = 500;

export type FilterFieldInput = "text" | "select";

/** A participant field the analysis can filter on (enabled field, in configured order). */
export type FilterField = { key: string; label: string; input: FilterFieldInput };

export type FilterValueOption = {
  /** Value used in the URL: the option value (select) or the most common spelling (text). */
  value: string;
  label: string;
  /** Boards (passing status / exclusion rules, before participant filters) with this answer. */
  count: number;
};

export type FilterFieldOptions = FilterField & {
  values: FilterValueOption[];
  /** Distinct text answers left out of `values` because of TEXT_OPTION_LIMIT. */
  hiddenValues: number;
};

/** The study's enabled participant fields as filterable fields. */
export function filterFields(config: ParticipantFieldConfig[]): FilterField[] {
  return resolveFields(config).map((d) => ({
    key: d.key,
    label: d.label,
    input: d.input === "select" ? "select" : "text",
  }));
}

/** Text answers compare trimmed and case-insensitively. */
export function normaliseText(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

/** The comparable form of a filter value or answer for a field. */
function normaliseValue(field: FilterField, value: string): string {
  return field.input === "text" ? normaliseText(value) : value.trim();
}

/** The comparable answer of a board for a field ("" when missing or blank). */
export function answerKey(
  field: FilterField,
  answers: ParticipantAnswers | null | undefined,
): string {
  const raw = answers?.[field.key];
  return typeof raw === "string" ? normaliseValue(field, raw) : NOT_ANSWERED;
}

/**
 * Raw `filter=key:value` strings → filter. Entries without ":" or with an empty key are
 * ignored, exact duplicates are dropped. Field keys are not checked here (see sanitizeFilter).
 */
export function parseFilterParams(values: Iterable<string>): AnalysisFilter {
  const out: AnalysisFilter = {};
  let seen = 0;
  for (const entry of values) {
    if (++seen > MAX_PARAMS) break;
    const i = entry.indexOf(":");
    if (i <= 0) continue;
    const key = entry.slice(0, i);
    const value = entry.slice(i + 1);
    if (value.length > MAX_VALUE_LENGTH) continue;
    const list = (out[key] ??= []);
    if (!list.includes(value)) list.push(value);
  }
  return out;
}

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function getAll(params: SearchParamsLike, name: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(name);
  const v = params[name];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** `includeInProgress=1|true` and repeated `filter` params from a URL or page searchParams. */
export function analysisQueryFromParams(params: SearchParamsLike): {
  includeInProgress: boolean;
  filter: AnalysisFilter;
} {
  const v = getAll(params, "includeInProgress")[0];
  return {
    includeInProgress: v === "1" || v === "true",
    filter: parseFilterParams(getAll(params, "filter")),
  };
}

/**
 * Keep only the study's enabled fields (in configured order), trim values, drop values that
 * duplicate another one of the same field (text fields: case-insensitively) and empty fields.
 */
export function sanitizeFilter(filter: AnalysisFilter, fields: FilterField[]): AnalysisFilter {
  const out: AnalysisFilter = {};
  for (const field of fields) {
    const values = filter[field.key];
    if (!values?.length) continue;
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const v of values) {
      const norm = normaliseValue(field, v);
      if (seen.has(norm)) continue;
      seen.add(norm);
      kept.push(v.trim());
    }
    if (kept.length) out[field.key] = kept;
  }
  return out;
}

export function isFilterActive(filter: AnalysisFilter): boolean {
  return Object.values(filter).some((v) => v.length > 0);
}

/**
 * Predicate for boards' participant answers (OR within a field, AND across fields). Expects a
 * sanitised filter; keys without a matching field are ignored.
 */
export function makeFilterMatcher(
  filter: AnalysisFilter,
  fields: FilterField[],
): (answers: ParticipantAnswers | null | undefined) => boolean {
  const tests = fields
    .filter((f) => filter[f.key]?.length)
    .map((f) => ({ field: f, wanted: new Set(filter[f.key].map((v) => normaliseValue(f, v))) }));
  if (tests.length === 0) return () => true;
  return (answers) => tests.every((t) => t.wanted.has(answerKey(t.field, answers)));
}

/** Query string (with leading "?", or "") for the page URL, the analysis API and CSVs. */
export function analysisQueryString(opts: {
  includeInProgress: boolean;
  filter: AnalysisFilter;
}): string {
  const params = new URLSearchParams();
  if (opts.includeInProgress) params.set("includeInProgress", "1");
  for (const [key, values] of Object.entries(opts.filter)) {
    for (const v of values) params.append("filter", `${key}:${v}`);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Add or remove one value of a field (immutably). */
export function toggleFilterValue(
  filter: AnalysisFilter,
  key: string,
  value: string,
  on: boolean,
): AnalysisFilter {
  const current = filter[key] ?? [];
  const next = on
    ? current.includes(value)
      ? current
      : [...current, value]
    : current.filter((v) => v !== value);
  const out = { ...filter };
  if (next.length) out[key] = next;
  else delete out[key];
  return out;
}

/** Label of a filter value, using the options when they know it. */
export function filterValueLabel(field: FilterFieldOptions | FilterField, value: string): string {
  if (value === NOT_ANSWERED) return NOT_ANSWERED_LABEL;
  if ("values" in field) {
    const norm = normaliseValue(field, value);
    const hit = field.values.find((o) => normaliseValue(field, o.value) === norm);
    if (hit) return hit.label;
  }
  return field.input === "select" && isBuiltInKey(field.key)
    ? formatAnswer(field.key, value)
    : value.trim();
}

/** Short human description, e.g. "Seniority: Senior, Lead / Principal; Country: France". */
export function describeFilter(
  filter: AnalysisFilter,
  fields: (FilterFieldOptions | FilterField)[],
): string {
  return fields
    .filter((f) => filter[f.key]?.length)
    .map((f) => `${f.label}: ${filter[f.key].map((v) => filterValueLabel(f, v)).join(", ")}`)
    .join("; ");
}

/**
 * Filter options with board counts (ANL-09), computed over the given answers (boards passing
 * the status / exclusion rules, before participant filters).
 * - select fields: options that occur, in option order, labelled like everywhere else
 *   (gender "self_describe" answers count under "Prefer to self-describe");
 * - text fields: answers grouped trimmed + case-insensitively, labelled with the most common
 *   spelling (ties by character code), by count desc then alphabetically, capped at
 *   TEXT_OPTION_LIMIT;
 * - "(not answered)" last, whenever a board lacks the answer.
 * Selected values are always listed (count 0 if no board has them).
 */
export function buildFilterOptions(
  fields: FilterField[],
  answersList: (ParticipantAnswers | null | undefined)[],
  filter: AnalysisFilter = {},
): FilterFieldOptions[] {
  return fields.map((field) => {
    const counts = new Map<string, number>();
    const spellings = new Map<string, Map<string, number>>();
    for (const answers of answersList) {
      const key = answerKey(field, answers);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (field.input === "text" && key !== NOT_ANSWERED) {
        const spelling = (answers?.[field.key] ?? "").trim();
        const m = spellings.get(key) ?? new Map<string, number>();
        m.set(spelling, (m.get(spelling) ?? 0) + 1);
        spellings.set(key, m);
      }
    }
    const selected = (filter[field.key] ?? []).map((v) => normaliseValue(field, v));
    for (const s of selected) if (!counts.has(s)) counts.set(s, 0);
    const selectedSet = new Set(selected);
    const notAnswered = counts.get(NOT_ANSWERED);
    counts.delete(NOT_ANSWERED);

    let values: FilterValueOption[];
    let hiddenValues = 0;
    if (field.input === "select") {
      const order = selectOrder(field.key);
      values = [...counts.entries()]
        .map(([value, count]) => ({ value, label: formatAnswer(field.key, value), count }))
        .sort((a, b) => {
          const ia = order.get(a.value) ?? Number.MAX_SAFE_INTEGER;
          const ib = order.get(b.value) ?? Number.MAX_SAFE_INTEGER;
          return ia - ib || a.label.localeCompare(b.label, "en");
        });
    } else {
      const rawSelected = new Map(
        (filter[field.key] ?? []).map((v) => [normaliseValue(field, v), v.trim()]),
      );
      const all = [...counts.entries()]
        .map(([key, count]) => {
          const label = mostCommon(spellings.get(key)) ?? rawSelected.get(key) ?? key;
          return { value: label, label, count, key };
        })
        .sort(
          (a, b) =>
            b.count - a.count ||
            a.label.localeCompare(b.label, "en", { sensitivity: "base" }) ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
        );
      const kept = all.filter((o, i) => i < TEXT_OPTION_LIMIT || selectedSet.has(o.key));
      hiddenValues = all.length - kept.length;
      values = kept.map(({ value, label, count }) => ({ value, label, count }));
    }
    if (notAnswered !== undefined) {
      values.push({ value: NOT_ANSWERED, label: NOT_ANSWERED_LABEL, count: notAnswered });
    }
    return { ...field, values, hiddenValues };
  });
}

function mostCommon(m: Map<string, number> | undefined): string | undefined {
  if (!m) return undefined;
  let best: string | undefined;
  let bestCount = -1;
  for (const [s, c] of m) {
    if (c > bestCount || (c === bestCount && best !== undefined && s < best)) {
      best = s;
      bestCount = c;
    }
  }
  return best;
}

const orderCache = new Map<string, Map<string, number>>();
function selectOrder(key: string): Map<string, number> {
  const cached = orderCache.get(key);
  if (cached) return cached;
  const m = new Map<string, number>();
  if (isBuiltInKey(key)) {
    const [def] = resolveFields([{ key, mode: "optional" }]);
    def.options?.forEach((o, i) => m.set(o.value, i));
  }
  orderCache.set(key, m);
  return m;
}
