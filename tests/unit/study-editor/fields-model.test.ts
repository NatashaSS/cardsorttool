import { describe, expect, it } from "vitest";
import {
  addCustomField,
  catalogue,
  fieldLabel,
  moveField,
  newCustomFieldKey,
  renameCustomField,
  setFieldMode,
  validateCustomLabel,
} from "@/components/admin/study-editor/fields-model";
import { BUILT_IN_FIELD_KEYS } from "@/lib/participant-fields";
import {
  CustomFieldConfigSchema,
  DEFAULT_PARTICIPANT_FIELDS,
  ParticipantFieldsSchema,
} from "@/lib/schemas";

describe("participant field editor model", () => {
  it("PFLD-01: catalogue lists every built-in field with its mode (default: name required)", () => {
    const rows = catalogue(DEFAULT_PARTICIPANT_FIELDS);
    expect(rows.map((r) => r.key)).toEqual([...BUILT_IN_FIELD_KEYS]);
    expect(rows.find((r) => r.key === "name")?.mode).toBe("required");
    expect(rows.filter((r) => r.mode === "off")).toHaveLength(BUILT_IN_FIELD_KEYS.length - 1);
  });

  it("PFLD-01: turning a field on appends it; changing mode keeps position; off removes it", () => {
    let f = setFieldMode(DEFAULT_PARTICIPANT_FIELDS, "email", "optional");
    expect(f).toEqual([
      { key: "name", mode: "required" },
      { key: "email", mode: "optional" },
    ]);
    f = setFieldMode(f, "name", "optional");
    expect(f[0]).toEqual({ key: "name", mode: "optional" });
    f = setFieldMode(f, "name", "off");
    expect(f).toEqual([{ key: "email", mode: "optional" }]);
    expect(setFieldMode(f, "country", "off")).toBe(f);
    expect(ParticipantFieldsSchema.safeParse(f).success).toBe(true);
  });

  it("PFLD-03: moves a field to a new position (clamped)", () => {
    const f = [
      { key: "name", mode: "required" },
      { key: "email", mode: "optional" },
      { key: "role", mode: "optional" },
    ] as const;
    expect(moveField([...f], 2, 0).map((x) => x.key)).toEqual(["role", "name", "email"]);
    expect(moveField([...f], 0, 99).map((x) => x.key)).toEqual(["email", "role", "name"]);
    expect(moveField([...f], 5, 0).map((x) => x.key)).toEqual(["name", "email", "role"]);
  });

  it("PFLD-04: adds, renames and removes custom questions with valid keys", () => {
    const key = newCustomFieldKey();
    expect(CustomFieldConfigSchema.safeParse({ key, label: "x", mode: "optional" }).success).toBe(
      true,
    );
    let f = addCustomField(
      DEFAULT_PARTICIPANT_FIELDS,
      "  Favourite tool?  ",
      "required",
      "custom_abc",
    );
    expect(f[1]).toEqual({ key: "custom_abc", label: "Favourite tool?", mode: "required" });
    expect(fieldLabel(f[1])).toBe("Favourite tool?");
    expect(fieldLabel(f[0])).toBe("Name");
    f = renameCustomField(f, "custom_abc", "Main tool");
    expect(fieldLabel(f[1])).toBe("Main tool");
    f = setFieldMode(f, "custom_abc", "optional");
    expect(f[1].mode).toBe("optional");
    expect(ParticipantFieldsSchema.safeParse(f).success).toBe(true);
    f = setFieldMode(f, "custom_abc", "off");
    expect(f).toEqual(DEFAULT_PARTICIPANT_FIELDS);
  });

  it("PFLD-04: custom question labels are required and limited in length", () => {
    expect(validateCustomLabel("  ")).toMatch(/Enter/);
    expect(validateCustomLabel("x".repeat(201))).toMatch(/at most/);
    expect(validateCustomLabel("Fine")).toBeNull();
  });
});
