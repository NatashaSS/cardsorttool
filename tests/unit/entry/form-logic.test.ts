import { describe, expect, it, vi } from "vitest";
import {
  createBoardRequest,
  emptyValues,
  fieldOrder,
  firstErrorKey,
  hasDetailsForm,
  resolveFields,
  validateAnswers,
} from "@/components/entry/form-logic";
import type { ParticipantFieldConfig } from "@/lib/schemas";

const config: ParticipantFieldConfig[] = [
  { key: "name", mode: "required" },
  { key: "email", mode: "optional" },
  { key: "gender", mode: "optional" },
  { key: "custom_team", label: "Which team are you in?", mode: "required" },
];

describe("entry form logic", () => {
  it("PFLD-05: a study with no enabled fields has no details form", () => {
    expect(hasDetailsForm([])).toBe(false);
    expect(hasDetailsForm(config)).toBe(true);
  });

  it("PFLD-03: field order follows the config, with the self-describe input after gender", () => {
    expect(fieldOrder(resolveFields(config))).toEqual([
      "name",
      "email",
      "gender",
      "genderSelfDescribe",
      "custom_team",
    ]);
  });

  it("PFLD-02: required fields and invalid emails produce per-field errors", () => {
    const fields = resolveFields(config);
    const result = validateAnswers(config, { ...emptyValues(fields), email: "not-an-email" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe("Name is required");
    expect(result.errors.email).toBe("Enter a valid email address");
    expect(result.errors.custom_team).toBe("Which team are you in? is required");
    expect(firstErrorKey(fields, result.errors)).toBe("name");
  });

  it("PFLD-02: self-described gender requires the free-text answer", () => {
    const fields = resolveFields(config);
    const values = { ...emptyValues(fields), name: "Ada", custom_team: "Core", gender: "self_describe" };
    const bad = validateAnswers(config, values);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors)).toEqual(["genderSelfDescribe"]);

    const good = validateAnswers(config, { ...values, genderSelfDescribe: "Agender" });
    expect(good).toEqual({
      ok: true,
      data: { name: "Ada", custom_team: "Core", gender: "self_describe", genderSelfDescribe: "Agender" },
    });
  });

  it("PFLD-04: custom answers are limited to 500 characters", () => {
    const result = validateAnswers(config, { name: "Ada", custom_team: "x".repeat(501) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.custom_team).toBeTruthy();
  });

  it("PFLD-02: optional empty answers are omitted", () => {
    const fields = resolveFields(config);
    const result = validateAnswers(config, { ...emptyValues(fields), name: " Ada ", custom_team: "Core" });
    expect(result).toEqual({ ok: true, data: { name: "Ada", custom_team: "Core" } });
  });
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("createBoardRequest", () => {
  it("PART-02: posts the answers and returns the token on 201", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { token: "tok123" }));
    const result = await createBoardRequest("abc", { name: "Ada" }, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, token: "tok123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/s/abc/boards",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ participant: { name: "Ada" } }) }),
    );
  });

  it("PFLD-02: maps server 400 field errors", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, {
        error: {
          code: "bad_request",
          message: "Invalid input",
          details: { formErrors: [], fieldErrors: { email: ["Enter a valid email address"] } },
        },
      }),
    );
    const result = await createBoardRequest("abc", {}, fetchMock as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, kind: "invalid", errors: { email: "Enter a valid email address" } });
  });

  it("PART-01: maps 409 study_not_live to a closed message", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, { error: { code: "study_not_live", message: "Study is not live" } }),
    );
    const result = await createBoardRequest("abc", {}, fetchMock as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, kind: "not_live" });
  });

  it("reports network failures without throwing", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const result = await createBoardRequest("abc", {}, fetchMock as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, kind: "error" });
  });
});
