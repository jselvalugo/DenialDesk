// Pure `cf.<fieldId>` form parsing shared by record actions (patients today; claims, denials,
// payers in later PRs, per docs/specs/settings-and-custom-fields.md S2). No DB access here — the
// caller looks up the record type's active fields first, so a stray or unknown field id is never
// trusted as one to write against.

export interface ParsableField {
  id: string;
  fieldType: string;
}

/**
 * Pulls `cf.<fieldId>` entries for the given active fields out of submitted form data into the
 * map `saveValuesForRecord` expects. A field with no `cf.<id>` entry at all is left out of the map
 * (masked and never opened, or simply not on the form) so `saveValuesForRecord` leaves it
 * unchanged. A checkbox is read from `formData.getAll` (a hidden "false" fallback plus the box
 * itself, see `CustomFieldInputs`), since an unchecked box submits no value of its own.
 */
export function parseCustomFieldInputs(fields: ParsableField[], formData: FormData): Map<string, unknown> {
  const inputs = new Map<string, unknown>();
  for (const field of fields) {
    const key = `cf.${field.id}`;
    if (!formData.has(key)) continue;
    if (field.fieldType === "checkbox") {
      inputs.set(field.id, formData.getAll(key).includes("true"));
    } else {
      inputs.set(field.id, formData.get(key));
    }
  }
  return inputs;
}
