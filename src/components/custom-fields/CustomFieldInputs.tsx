"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import type { CustomFieldType } from "@/domain/settings/custom-fields";
import type { CustomFieldRow } from "@/domain/settings/queries";
import type { CustomFieldTypedValue, LoadedCustomFieldValue } from "@/domain/custom-fields/values";

const fieldClass =
  "h-9 rounded-control border border-border-strong bg-surface px-3 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";
const textareaClass =
  "rounded-control border border-border-strong bg-surface px-3 py-2 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";

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

/** One field's control: text, long_text, number, date, checkbox, or select. Its `name` is
 * `cf.<fieldId>` (parsed server-side in the record's own create/update action). */
function TypedInput({
  field,
  defaultValue,
  error,
}: {
  field: CustomFieldOption;
  defaultValue?: CustomFieldTypedValue;
  error?: string;
}) {
  const name = `cf.${field.fieldId}`;
  const id = `field-${name}`;
  switch (field.type) {
    case "long_text":
      return (
        <textarea
          id={id}
          name={name}
          rows={3}
          maxLength={4000}
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          aria-invalid={error ? true : undefined}
          className={textareaClass}
        />
      );
    case "number":
      return (
        <input
          id={id}
          name={name}
          type="number"
          step="any"
          defaultValue={typeof defaultValue === "number" ? defaultValue : ""}
          aria-invalid={error ? true : undefined}
          className={fieldClass}
        />
      );
    case "date":
      return (
        <input
          id={id}
          name={name}
          type="date"
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          aria-invalid={error ? true : undefined}
          className={fieldClass}
        />
      );
    case "checkbox":
      return (
        // A hidden "false" sharing the checkbox's name, rendered first, so an unchecked box still
        // submits a value: presence in the form data (not just truthiness) is how the server tells
        // "rendered but left unchecked" apart from "never rendered" (a masked field left locked).
        <span className="inline-flex items-center gap-2">
          <input type="hidden" name={name} value="false" />
          <input
            id={id}
            name={name}
            type="checkbox"
            value="true"
            defaultChecked={defaultValue === true}
            aria-invalid={error ? true : undefined}
            className="size-4 accent-primary"
          />
        </span>
      );
    case "select":
      return (
        <select
          id={id}
          name={name}
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          aria-invalid={error ? true : undefined}
          className={fieldClass}
        >
          <option value="" />
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          id={id}
          name={name}
          type="text"
          maxLength={200}
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          aria-invalid={error ? true : undefined}
          className={fieldClass}
        />
      );
  }
}

/** A masked (sensitive, or on a record with sensitivity tags) field: "Locked" until the user
 * clicks "Change", which reveals an empty input to replace the value — never prefilled, so an
 * unrelated edit to the record can never silently resubmit and overwrite a value the form never
 * saw. Leaving it collapsed omits the field entirely, which `saveValuesForRecord` reads as
 * "unchanged". */
function LockedFieldInput({ field, error }: { field: CustomFieldOption; error?: string }) {
  const t = useT("customFields");
  const [changing, setChanging] = useState(false);
  if (!changing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-body text-muted">{t("input.locked")}</span>
        <button
          type="button"
          onClick={() => setChanging(true)}
          className="text-label font-medium text-link hover:underline"
        >
          {t("input.change")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <TypedInput field={field} error={error} />
      <button
        type="button"
        onClick={() => setChanging(false)}
        className="text-label font-medium text-muted hover:underline"
      >
        {t("input.cancelChange")}
      </button>
    </div>
  );
}

/**
 * Renders a record's active custom fields for a form (docs/specs/settings-and-custom-fields.md
 * S2). `values` are the record's currently loaded values (empty for a new record); a masked entry
 * (`{ masked: true }`) renders locked and is never prefilled, sensitive or not.
 */
export function CustomFieldInputs({
  fields,
  values = [],
  errorFor,
}: {
  fields: CustomFieldOption[];
  values?: LoadedCustomFieldValue[];
  /** Keyed by the field's stable `key` (`cf.<key>` is what a save error's `field` carries), not
   * its id, since a `CustomFieldValueError` never carries the id. */
  errorFor?: (fieldKey: string) => string | undefined;
}) {
  const t = useT("customFields");
  if (fields.length === 0) return null;
  const byField = new Map(values.map((v) => [v.fieldId, v]));

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 text-heading font-semibold text-text">{t("section.title")}</legend>
      <div className="grid grid-cols-2 gap-4">
        {fields.map((field) => {
          const loaded = byField.get(field.fieldId);
          const error = errorFor?.(field.key);
          const masked = loaded?.masked ?? false;
          return (
            <div key={field.fieldId} className="flex flex-col gap-1.5">
              <label htmlFor={`field-cf.${field.fieldId}`} className="text-label font-medium text-text">
                {field.label}
                {field.required && (
                  <span aria-hidden className="ml-1 text-danger-fg">
                    *
                  </span>
                )}
                {field.required && <span className="sr-only"> ({t("input.required")})</span>}
              </label>
              {masked ? (
                <LockedFieldInput field={field} error={error} />
              ) : (
                <TypedInput field={field} defaultValue={loaded?.value} error={error} />
              )}
              {field.helpText && <p className="text-label text-muted">{field.helpText}</p>}
              {error && <p className="text-label font-medium text-danger-fg">{error}</p>}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
