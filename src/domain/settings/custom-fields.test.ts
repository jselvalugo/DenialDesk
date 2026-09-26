import { describe, expect, it } from "vitest";
import { customFieldChangesSchema, keyFromLabel, newCustomFieldSchema, parseOptions } from "./custom-fields";

const base = {
  entity: "patient",
  label: "Referring clinic",
  key: "referring_clinic",
  fieldType: "text",
  options: [],
  required: false,
  helpText: "",
};

describe("keyFromLabel", () => {
  it("makes a lowercase key that starts with a letter", () => {
    expect(keyFromLabel("Referring clinic #")).toBe("referring_clinic");
    expect(keyFromLabel("  2nd Opinion?  ")).toBe("nd_opinion");
    expect(keyFromLabel("!!!")).toBe("field");
    expect(keyFromLabel("x".repeat(80))).toHaveLength(40);
  });
});

describe("parseOptions", () => {
  it("keeps one choice per line, dropping blanks and case-insensitive duplicates", () => {
    expect(parseOptions("Gold\n\n silver \r\ngold\nBronze")).toEqual(["Gold", "silver", "Bronze"]);
  });
});

describe("newCustomFieldSchema", () => {
  it("accepts a valid field and turns blank help into null", () => {
    expect(newCustomFieldSchema.parse(base)).toMatchObject({ key: "referring_clinic", helpText: null });
  });

  it("rejects bad keys, unknown record types, and empty labels", () => {
    expect(newCustomFieldSchema.safeParse({ ...base, key: "Bad Key" }).success).toBe(false);
    expect(newCustomFieldSchema.safeParse({ ...base, key: "1abc" }).success).toBe(false);
    expect(newCustomFieldSchema.safeParse({ ...base, entity: "users" }).success).toBe(false);
    expect(newCustomFieldSchema.safeParse({ ...base, label: "  " }).success).toBe(false);
  });

  it("requires choices for a choice list and drops them for other types", () => {
    expect(newCustomFieldSchema.safeParse({ ...base, fieldType: "select" }).success).toBe(false);
    expect(newCustomFieldSchema.parse({ ...base, fieldType: "select", options: ["A"] }).options).toEqual([
      "A",
    ]);
    expect(newCustomFieldSchema.parse({ ...base, options: ["A"] }).options).toEqual([]);
  });
});

describe("customFieldChangesSchema", () => {
  it("applies the stored type's choice rules", () => {
    const edit = { label: "Tier", options: [], required: true, helpText: "" };
    expect(customFieldChangesSchema.safeParse({ ...edit, fieldType: "select" }).success).toBe(false);
    expect(customFieldChangesSchema.parse({ ...edit, fieldType: "number" })).toEqual({
      label: "Tier",
      options: [],
      required: true,
      helpText: null,
    });
  });
});

describe("canConfigureSettings", () => {
  it("allows administrators only", async () => {
    const { canConfigureSettings } = await import("@/auth/permissions");
    expect(canConfigureSettings("admin")).toBe(true);
    for (const role of ["manager", "specialist", "compliance"] as const)
      expect(canConfigureSettings(role)).toBe(false);
  });
});

describe("choice limits", () => {
  it("refuses more than 50 choices or a choice over 60 characters", () => {
    const select = { ...base, fieldType: "select" };
    const many = Array.from({ length: 51 }, (_, i) => `C${i}`);
    expect(newCustomFieldSchema.safeParse({ ...select, options: many }).success).toBe(false);
    expect(newCustomFieldSchema.safeParse({ ...select, options: ["x".repeat(61)] }).success).toBe(false);
  });
});
