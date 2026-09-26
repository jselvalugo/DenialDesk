import { describe, expect, it } from "vitest";
import type { CustomFieldRow } from "@/domain/settings/queries";
import { CustomFieldValueError, parseValue, serializeValue } from "./values";

// docs/specs/settings-and-custom-fields.md S2: per-type validation and canonical strings.

function field(overrides: Partial<CustomFieldRow> = {}): CustomFieldRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    entity: "patient",
    key: "notes",
    label: "Notes",
    fieldType: "text",
    options: [],
    required: false,
    helpText: null,
    sensitivity: null,
    position: 0,
    active: true,
    createdBy: "33333333-3333-3333-3333-333333333333",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CustomFieldRow;
}

describe("serializeValue / parseValue", () => {
  it("trims and round-trips short text within the 200-char limit", () => {
    const f = field({ fieldType: "text" });
    expect(serializeValue(f, "  Referring clinic  ")).toBe("Referring clinic");
    expect(serializeValue(f, "a".repeat(200))).toBe("a".repeat(200));
    expect(() => serializeValue(f, "a".repeat(201))).toThrow(CustomFieldValueError);
  });

  it("rejects long text over 4,000 chars and accepts exactly 4,000", () => {
    const f = field({ fieldType: "long_text" });
    expect(serializeValue(f, "a".repeat(4000))).toBe("a".repeat(4000));
    expect(() => serializeValue(f, "a".repeat(4001))).toThrow(CustomFieldValueError);
  });

  it("clears an empty, non-required value; requires a non-blank value when required", () => {
    const optional = field({ required: false });
    expect(serializeValue(optional, "")).toBeNull();
    expect(serializeValue(optional, undefined)).toBeNull();

    const required = field({ required: true });
    expect(() => serializeValue(required, "")).toThrow(/is required/);
    expect(() => serializeValue(required, null)).toThrow(/is required/);
  });

  it("does not require an inactive field even when marked required", () => {
    const f = field({ required: true, active: false });
    expect(serializeValue(f, "")).toBeNull();
  });

  it("validates numbers: finite, parses, and round-trips", () => {
    const f = field({ fieldType: "number" });
    expect(serializeValue(f, "42")).toBe("42");
    expect(parseValue(f, "42")).toBe(42);
    expect(() => serializeValue(f, "not-a-number")).toThrow(CustomFieldValueError);
    expect(() => serializeValue(f, Number.POSITIVE_INFINITY)).toThrow(CustomFieldValueError);
  });

  it("rejects non-string, non-number input outright", () => {
    const f = field({ fieldType: "number" });
    expect(() => serializeValue(f, true)).toThrow(CustomFieldValueError);
    expect(() => serializeValue(f, {})).toThrow(CustomFieldValueError);
    expect(() => serializeValue(f, ["42"])).toThrow(CustomFieldValueError);
  });

  it("rejects a number with more than 15 significant digits", () => {
    const f = field({ fieldType: "number" });
    expect(serializeValue(f, "123456789012345")).toBe("123456789012345"); // exactly 15: ok
    expect(() => serializeValue(f, "1234567890123456")).toThrow(/too many digits/);
    expect(() => serializeValue(f, "1e30")).toThrow(/too many digits/);
  });

  it("validates ISO dates", () => {
    const f = field({ fieldType: "date" });
    expect(serializeValue(f, "2026-09-26")).toBe("2026-09-26");
    expect(() => serializeValue(f, "09/26/2026")).toThrow(CustomFieldValueError);
    expect(() => serializeValue(f, "2026-13-40")).toThrow(CustomFieldValueError);
  });

  it("rejects impossible calendar dates even in YYYY-MM-DD shape", () => {
    const f = field({ fieldType: "date" });
    expect(() => serializeValue(f, "2026-02-29")).toThrow(CustomFieldValueError); // not a leap year
    expect(() => serializeValue(f, "2026-04-31")).toThrow(CustomFieldValueError); // April has 30 days
    expect(serializeValue(f, "2028-02-29")).toBe("2028-02-29"); // 2028 is a leap year: ok
  });

  it("stores checkboxes as true/false and parses back to boolean", () => {
    const f = field({ fieldType: "checkbox" });
    expect(serializeValue(f, true)).toBe("true");
    expect(serializeValue(f, false)).toBe("false");
    expect(serializeValue(f, "on")).toBe("true");
    expect(parseValue(f, "true")).toBe(true);
    expect(parseValue(f, "false")).toBe(false);
  });

  it("requires a select value to be a current option", () => {
    const f = field({ fieldType: "select", options: ["Gold", "Silver"] });
    expect(serializeValue(f, "Gold")).toBe("Gold");
    expect(() => serializeValue(f, "Bronze")).toThrow(/current option/);
  });
});
