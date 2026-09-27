// Plain (non-client) module: server pages call `toCustomFieldOptions` while rendering, which a
// function exported from a "use client" file can't be (Next.js throws at render time).
import type { CustomFieldType } from "@/domain/settings/custom-fields";
import type { CustomFieldRow } from "@/domain/settings/queries";

/** Active field rows (`activeCustomFields`) to the plain shape this component and its form action
 * need, dropping columns (tenant, sensitivity, position, timestamps) it has no business seeing. */
export function toCustomFieldOptions(fields: CustomFieldRow[]): CustomFieldOption[] {
  return fields.map((f) => ({
    fieldId: f.id,
    key: f.key,
    label: f.label,
    type: f.fieldType as CustomFieldType,
    helpText: f.helpText,
    required: f.required,
    options: f.options,
  }));
}

export interface CustomFieldOption {
  fieldId: string;
  key: string;
  label: string;
  type: CustomFieldType;
  helpText: string | null;
  required: boolean;
  options: string[];
}
