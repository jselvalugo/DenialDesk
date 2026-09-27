import { describe, expect, it } from "vitest";
import { parseCustomFieldInputs, type ParsableField } from "./form-inputs";

const textField: ParsableField = { id: "11111111-1111-1111-1111-111111111111", fieldType: "text" };
const checkboxField: ParsableField = { id: "22222222-2222-2222-2222-222222222222", fieldType: "checkbox" };
const numberField: ParsableField = { id: "33333333-3333-3333-3333-333333333333", fieldType: "number" };

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("parseCustomFieldInputs (docs/specs/settings-and-custom-fields.md S2)", () => {
  it("reads a submitted text field by its cf.<fieldId> name", () => {
    const inputs = parseCustomFieldInputs([textField], form([[`cf.${textField.id}`, "Dr. Lee"]]));
    expect(inputs.get(textField.id)).toBe("Dr. Lee");
  });

  it("leaves a field out entirely when its cf.<fieldId> entry is absent (masked, never opened)", () => {
    const inputs = parseCustomFieldInputs([textField], form([]));
    expect(inputs.has(textField.id)).toBe(false);
  });

  it("ignores cf.* entries for fields not in the active list, never trusting a stray id", () => {
    const strangerId = "99999999-9999-9999-9999-999999999999";
    const inputs = parseCustomFieldInputs([textField], form([[`cf.${strangerId}`, "smuggled"]]));
    expect(inputs.size).toBe(0);
  });

  it("reads an unchecked checkbox as false via its hidden fallback, not as absent", () => {
    // CustomFieldInputs renders <input type=hidden value=false> before the box itself.
    const inputs = parseCustomFieldInputs([checkboxField], form([[`cf.${checkboxField.id}`, "false"]]));
    expect(inputs.get(checkboxField.id)).toBe(false);
  });

  it("reads a checked checkbox as true", () => {
    const inputs = parseCustomFieldInputs(
      [checkboxField],
      form([
        [`cf.${checkboxField.id}`, "false"],
        [`cf.${checkboxField.id}`, "true"],
      ]),
    );
    expect(inputs.get(checkboxField.id)).toBe(true);
  });

  it("parses several fields from one submission independently", () => {
    const inputs = parseCustomFieldInputs(
      [textField, checkboxField, numberField],
      form([
        [`cf.${textField.id}`, "Referral note"],
        [`cf.${checkboxField.id}`, "false"],
        [`cf.${checkboxField.id}`, "true"],
        [`cf.${numberField.id}`, "42"],
      ]),
    );
    expect(inputs.get(textField.id)).toBe("Referral note");
    expect(inputs.get(checkboxField.id)).toBe(true);
    expect(inputs.get(numberField.id)).toBe("42");
  });
});
