import { describe, expect, it } from "vitest";
import { placementCsv, similarityCsv } from "@/components/admin/analysis/csv";
import {
  analysisQueryFromParams,
  analysisQueryString,
  buildFilterOptions,
  describeFilter,
  filterFields,
  filterValueLabel,
  isFilterActive,
  makeFilterMatcher,
  NOT_ANSWERED_LABEL,
  parseFilterParams,
  sanitizeFilter,
  TEXT_OPTION_LIMIT,
  toggleFilterValue,
} from "@/lib/analysis-filter";
import type { AnalysisResult } from "@/lib/api-types";
import type { ParticipantAnswers } from "@/lib/types";

const fields = filterFields([
  { key: "seniority", mode: "optional" },
  { key: "organisation", mode: "optional" },
  { key: "gender", mode: "optional" },
  { key: "country", mode: "optional" },
  { key: "custom_q1", label: "Team", mode: "optional" },
]);

describe("filter parsing and serialising", () => {
  it("ANL-09: parses repeated filter params, splitting at the first colon", () => {
    expect(
      parseFilterParams([
        "seniority:senior",
        "seniority:lead",
        "seniority:senior",
        "organisation:Acme: Labs",
        "organisation:",
        "nocolon",
        ":value",
      ]),
    ).toEqual({
      seniority: ["senior", "lead"],
      organisation: ["Acme: Labs", ""],
    });
  });

  it("ANL-09: reads includeInProgress and filters from URLSearchParams and page searchParams", () => {
    const url = new URL(
      "http://x/a?includeInProgress=1&filter=seniority%3Asenior&filter=country:GB",
    );
    expect(analysisQueryFromParams(url.searchParams)).toEqual({
      includeInProgress: true,
      filter: { seniority: ["senior"], country: ["GB"] },
    });
    expect(
      analysisQueryFromParams({ includeInProgress: "true", filter: "seniority:lead" }),
    ).toEqual({ includeInProgress: true, filter: { seniority: ["lead"] } });
    expect(analysisQueryFromParams({ filter: ["a:1", "a:2"] })).toEqual({
      includeInProgress: false,
      filter: { a: ["1", "2"] },
    });
    expect(analysisQueryFromParams({})).toEqual({ includeInProgress: false, filter: {} });
  });

  it("ANL-09: serialises to a query string that parses back to the same filter", () => {
    const filter = { seniority: ["senior", "lead"], organisation: ["Acme & Co: R&D", ""] };
    const qs = analysisQueryString({ includeInProgress: true, filter });
    expect(qs.startsWith("?includeInProgress=1&filter=")).toBe(true);
    expect(analysisQueryFromParams(new URLSearchParams(qs.slice(1)))).toEqual({
      includeInProgress: true,
      filter,
    });
    expect(analysisQueryString({ includeInProgress: false, filter: {} })).toBe("");
  });

  it("ANL-09: sanitising drops unknown/disabled keys, empty lists and duplicate values", () => {
    expect(
      sanitizeFilter(
        {
          name: ["x"], // not enabled
          bogus: ["y"],
          country: [],
          organisation: [" Acme ", "acme", "ACME", "Globex", ""],
          seniority: ["senior", "senior"],
        },
        fields,
      ),
    ).toEqual({ seniority: ["senior"], organisation: ["Acme", "Globex", ""] });
  });

  it("ANL-09: toggle / isFilterActive helpers", () => {
    let f = toggleFilterValue({}, "seniority", "senior", true);
    f = toggleFilterValue(f, "seniority", "lead", true);
    f = toggleFilterValue(f, "seniority", "lead", true);
    expect(f).toEqual({ seniority: ["senior", "lead"] });
    expect(isFilterActive(f)).toBe(true);
    f = toggleFilterValue(
      toggleFilterValue(f, "seniority", "senior", false),
      "seniority",
      "lead",
      false,
    );
    expect(f).toEqual({});
    expect(isFilterActive(f)).toBe(false);
    expect(isFilterActive({ seniority: [] })).toBe(false);
  });
});

describe("filter matching", () => {
  const match = (filter: Record<string, string[]>) =>
    makeFilterMatcher(sanitizeFilter(filter, fields), fields);

  it("ANL-09: OR within a field, AND across fields", () => {
    const m = match({ seniority: ["senior", "lead"], country: ["GB"] });
    expect(m({ seniority: "senior", country: "GB" })).toBe(true);
    expect(m({ seniority: "lead", country: "GB" })).toBe(true);
    expect(m({ seniority: "lead", country: "FR" })).toBe(false);
    expect(m({ seniority: "junior", country: "GB" })).toBe(false);
    expect(match({})({})).toBe(true);
  });

  it("ANL-09: text answers compare trimmed and case-insensitively; selects by stored value", () => {
    const m = match({ organisation: ["acme"] });
    expect(m({ organisation: "  ACME " })).toBe(true);
    expect(m({ organisation: "Acme Labs" })).toBe(false);
    expect(match({ custom_q1: ["Design "] })({ custom_q1: "design" })).toBe(true);
    expect(match({ seniority: ["Senior"] })({ seniority: "senior" })).toBe(false);
  });

  it("ANL-09: a missing or blank answer matches (not answered)", () => {
    const m = match({ organisation: [""] });
    expect(m({})).toBe(true);
    expect(m({ organisation: "   " })).toBe(true);
    expect(m(null)).toBe(true);
    expect(m({ organisation: "Acme" })).toBe(false);
    expect(match({ organisation: ["", "acme"] })({ organisation: "Acme" })).toBe(true);
  });
});

describe("filter options", () => {
  const answers: ParticipantAnswers[] = [
    {
      seniority: "senior",
      organisation: "Acme",
      gender: "self_describe",
      genderSelfDescribe: "agender",
      country: "GB",
    },
    { seniority: "junior", organisation: " acme ", gender: "woman", country: "FR" },
    { seniority: "senior", organisation: "ACME", country: "GB" },
    { organisation: "Globex", gender: "self_describe", genderSelfDescribe: "fluid" },
    {},
  ];

  it("ANL-09: select fields use option labels and order; (not answered) last", () => {
    const [seniority, , gender, country] = buildFilterOptions(fields, answers);
    expect(seniority).toMatchObject({ key: "seniority", label: "Seniority", input: "select" });
    expect(seniority.values).toEqual([
      { value: "junior", label: "Junior", count: 1 },
      { value: "senior", label: "Senior", count: 2 },
      { value: "", label: NOT_ANSWERED_LABEL, count: 2 },
    ]);
    // Self-described genders count under the "Prefer to self-describe" option.
    expect(gender.values).toEqual([
      { value: "woman", label: "Woman", count: 1 },
      { value: "self_describe", label: "Prefer to self-describe", count: 2 },
      { value: "", label: NOT_ANSWERED_LABEL, count: 2 },
    ]);
    expect(country.values.map((v) => v.label)).toEqual([
      "France",
      "United Kingdom",
      NOT_ANSWERED_LABEL,
    ]);
    expect(fields.map((f) => f.key)).not.toContain("genderSelfDescribe");
  });

  it("ANL-09: text answers grouped case-insensitively, most common spelling, count desc then A–Z", () => {
    const [, organisation, , , team] = buildFilterOptions(fields, [
      ...answers,
      { organisation: "acme" },
      { organisation: "Initech" },
    ]);
    expect(organisation.values).toEqual([
      { value: "acme", label: "acme", count: 4 },
      { value: "Globex", label: "Globex", count: 1 },
      { value: "Initech", label: "Initech", count: 1 },
      { value: "", label: NOT_ANSWERED_LABEL, count: 1 },
    ]);
    expect(organisation.hiddenValues).toBe(0);
    // Nobody answered → only "(not answered)".
    expect(team.values).toEqual([{ value: "", label: NOT_ANSWERED_LABEL, count: 7 }]);
    // No board lacks the answer → no "(not answered)".
    expect(buildFilterOptions(fields, [{ seniority: "lead" }])[0].values).toEqual([
      { value: "lead", label: "Lead / Principal", count: 1 },
    ]);
  });

  it("ANL-09: long text lists are capped, but selected values are always listed", () => {
    const many = Array.from({ length: TEXT_OPTION_LIMIT + 20 }, (_, i) => ({
      organisation: `Org ${String(i).padStart(3, "0")}`,
    }));
    const [, org] = buildFilterOptions(fields, many, { organisation: ["org 119", "Nobody Inc"] });
    expect(org.values.length).toBe(TEXT_OPTION_LIMIT + 2);
    expect(org.hiddenValues).toBe(19);
    expect(org.values.some((v) => v.label === "Org 119")).toBe(true);
    expect(org.values.find((v) => v.label === "Nobody Inc")?.count).toBe(0);
    // A selected select value that no board has stays listed with 0.
    const [sen] = buildFilterOptions(fields, [], { seniority: ["lead"] });
    expect(sen.values).toEqual([{ value: "lead", label: "Lead / Principal", count: 0 }]);
  });

  it("ANL-09: labels and descriptions of active filters", () => {
    const options = buildFilterOptions(fields, answers);
    const filter = { seniority: ["senior", ""], organisation: ["ACME"], country: ["GB"] };
    // Spellings tie (1 each) → the smallest by character code.
    expect(filterValueLabel(options[1], "acme ")).toBe("ACME");
    expect(describeFilter(filter, options)).toBe(
      "Seniority: Senior, (not answered); Organisation: ACME; Country of residence: United Kingdom",
    );
    // Without options, select values still get their option labels.
    expect(describeFilter({ seniority: ["lead"] }, fields)).toBe("Seniority: Lead / Principal");
  });
});

describe("CSV header with filters", () => {
  const result = {
    n: 2,
    similarity: { cardIds: ["a"], ratio: [[1]], together: [[2]], bothSorted: [[2]] },
    dendrogram: { leafOrder: ["a"], root: null },
    placement: { n: 2, cardIds: ["a"], columns: [{ label: "G" }], ratio: [[1]], counts: [[2]] },
  } as unknown as AnalysisResult;
  const cards = [{ id: "a", label: "A" }];

  it("ANL-09 ANL-07: the header cell states n and the active filter", () => {
    expect(similarityCsv(cards, result)).toContain("Similarity % (n = 2),A");
    expect(similarityCsv(cards, result, "Seniority: Senior, Lead")).toContain(
      '"Similarity % (n = 2; Seniority: Senior, Lead)",A',
    );
    expect(placementCsv(cards, result, "Country: France")).toContain(
      "Placement % (n = 2; Country: France),G",
    );
  });
});
