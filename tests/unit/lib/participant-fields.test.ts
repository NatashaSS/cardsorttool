import { describe, expect, it } from "vitest";
import {
  BUILT_IN_FIELD_KEYS,
  buildParticipantSchema,
  formatAnswer,
  resolveFields,
} from "@/lib/participant-fields";
import { ParticipantFieldsSchema, type ParticipantFieldConfig } from "@/lib/schemas";

describe("participant field catalogue", () => {
  it("PFLD-01: the catalogue contains every built-in field", () => {
    expect([...BUILT_IN_FIELD_KEYS]).toEqual([
      "name", "email", "organisation", "role", "seniority", "ageRange", "gender", "country", "nationality",
    ]);
  });

  it("PFLD-03: fields resolve in configured order with required flags", () => {
    const config: ParticipantFieldConfig[] = [
      { key: "country", mode: "optional" },
      { key: "name", mode: "required" },
      { key: "custom_team", label: "Which team?", mode: "optional" },
    ];
    expect(resolveFields(config).map((f) => [f.key, f.label, f.required])).toEqual([
      ["country", "Country of residence", false],
      ["name", "Name", true],
      ["custom_team", "Which team?", false],
    ]);
  });

  it("PFLD-01: duplicate field keys are rejected", () => {
    const dup = [{ key: "name", mode: "required" }, { key: "name", mode: "optional" }];
    expect(ParticipantFieldsSchema.safeParse(dup).success).toBe(false);
  });
});

describe("buildParticipantSchema (PFLD-02)", () => {
  const schema = buildParticipantSchema([
    { key: "name", mode: "required" },
    { key: "email", mode: "optional" },
    { key: "seniority", mode: "optional" },
    { key: "gender", mode: "optional" },
    { key: "country", mode: "required" },
  ]);

  it("PFLD-02: accepts valid answers and strips unknown keys and blanks", () => {
    const r = schema.safeParse({ name: " Ada ", email: "", country: "GB", seniority: "senior", hacker: "x" });
    expect(r.success && r.data).toEqual({ name: "Ada", country: "GB", seniority: "senior" });
  });

  it("PFLD-02: required fields must be present", () => {
    expect(schema.safeParse({ country: "GB" }).success).toBe(false);
    expect(schema.safeParse({ name: "  ", country: "GB" }).success).toBe(false);
  });

  it("PFLD-02: validates email, select options and country codes", () => {
    expect(schema.safeParse({ name: "A", country: "GB", email: "nope" }).success).toBe(false);
    expect(schema.safeParse({ name: "A", country: "GB", seniority: "wizard" }).success).toBe(false);
    expect(schema.safeParse({ name: "A", country: "XX" }).success).toBe(false);
  });

  it("PFLD-02: text answers are limited to 200 characters", () => {
    expect(schema.safeParse({ name: "a".repeat(201), country: "GB" }).success).toBe(false);
  });

  it("PFLD-02: self-described gender requires the free text", () => {
    expect(schema.safeParse({ name: "A", country: "GB", gender: "self_describe" }).success).toBe(false);
    const ok = schema.safeParse({ name: "A", country: "GB", gender: "self_describe", genderSelfDescribe: "Agender" });
    expect(ok.success && ok.data.genderSelfDescribe).toBe("Agender");
    const dropped = schema.safeParse({ name: "A", country: "GB", gender: "woman", genderSelfDescribe: "x" });
    expect(dropped.success && dropped.data).toEqual({ name: "A", country: "GB", gender: "woman" });
  });

  it("PFLD-05: an empty config accepts an empty object", () => {
    expect(buildParticipantSchema([]).safeParse({}).success).toBe(true);
  });

  it("PFLD-04: custom questions allow up to 500 characters", () => {
    const custom = buildParticipantSchema([{ key: "custom_q1", label: "Q", mode: "required" }]);
    expect(custom.safeParse({ custom_q1: "a".repeat(500) }).success).toBe(true);
    expect(custom.safeParse({ custom_q1: "a".repeat(501) }).success).toBe(false);
  });

  it("formats answers for display", () => {
    expect(formatAnswer("country", "GB")).toBe("United Kingdom");
    expect(formatAnswer("seniority", "lead")).toBe("Lead / Principal");
    expect(formatAnswer("custom_x", "free text")).toBe("free text");
  });
});
