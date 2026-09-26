"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  keyFromLabel,
  type CustomFieldEntity,
  type CustomFieldType,
} from "@/domain/settings/custom-fields";
import { addCustomField, saveCustomField, type CustomFieldFormState } from "./actions";

const selectClass =
  "h-9 rounded-control border border-border-strong bg-surface px-2.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus disabled:bg-surface-muted";

export interface CustomFieldValues {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  required: boolean;
  helpText: string | null;
  updatedAt: string;
}

/** Add a field (no `field`) or edit one. Record type, key, and type are fixed once created. */
export function CustomFieldForm({ field, entity }: { field?: CustomFieldValues; entity: CustomFieldEntity }) {
  const editing = Boolean(field);
  const [state, action] = useActionState<CustomFieldFormState, FormData>(
    editing ? saveCustomField : addCustomField,
    {},
  );
  const [label, setLabel] = useState(field?.label ?? "");
  const [key, setKey] = useState(field?.key ?? "");
  const [fieldType, setFieldType] = useState<CustomFieldType>(field?.fieldType ?? "text");
  const errorFor = (name: string) => (state.field === name ? state.error : undefined);

  return (
    <form action={action} className="flex max-w-[720px] flex-col gap-4" noValidate>
      <FormAlert message={state.field ? undefined : state.error} />
      {field && (
        <>
          <input type="hidden" name="id" value={field.id} />
          <input type="hidden" name="updatedAt" value={field.updatedAt} />
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="field-entity" className="text-label font-medium text-text">
            Add to
          </label>
          <select
            id="field-entity"
            name="entity"
            defaultValue={field?.entity ?? entity}
            disabled={editing}
            className={selectClass}
          >
            {Object.entries(CUSTOM_FIELD_ENTITIES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="field-fieldType" className="text-label font-medium text-text">
            Field type
          </label>
          <select
            id="field-fieldType"
            name="fieldType"
            value={fieldType}
            onChange={(event) => setFieldType(event.target.value as CustomFieldType)}
            disabled={editing}
            className={selectClass}
          >
            {Object.entries(CUSTOM_FIELD_TYPES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <TextField
        label="Label"
        name="label"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        maxLength={60}
        required
        hint="What people see on the form, e.g. “Referring clinic”. Never put patient information in a label."
        error={errorFor("label")}
      />
      <TextField
        label="Key"
        name="key"
        value={editing ? key : key || ""}
        placeholder={keyFromLabel(label)}
        onChange={(event) => setKey(event.target.value)}
        maxLength={40}
        disabled={editing}
        className="font-mono"
        hint={
          editing
            ? "The key can't change once the field exists."
            : "Used in exports and integrations. Leave blank to use the suggestion. It can't change later."
        }
        error={errorFor("key")}
      />
      {fieldType === "select" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="field-options" className="text-label font-medium text-text">
            Choices
          </label>
          <textarea
            id="field-options"
            name="options"
            rows={5}
            defaultValue={field?.options.join("\n")}
            aria-describedby="field-options-hint"
            aria-invalid={errorFor("options") ? true : undefined}
            className="rounded-control border border-border-strong bg-surface px-3 py-2 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
          />
          <p id="field-options-hint" className="text-label text-muted">
            One choice per line, in the order to show them (up to 50).
          </p>
          {errorFor("options") && (
            <p className="text-label font-medium text-danger-fg">{errorFor("options")}</p>
          )}
        </div>
      )}
      <TextField
        label="Help text (optional)"
        name="helpText"
        defaultValue={field?.helpText ?? ""}
        maxLength={200}
        hint="Shown under the field on the form."
        error={errorFor("helpText")}
      />
      <label className="flex items-center gap-2 text-body text-text">
        <input type="checkbox" name="required" defaultChecked={field?.required ?? false} className="size-4" />
        Required: the record can&apos;t be saved without it
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton variant="primary" pendingLabel={editing ? "Saving…" : "Adding…"}>
          {editing ? "Save field" : "Add field"}
        </SubmitButton>
        <Link
          href={`/settings/fields?records=${field?.entity ?? entity}`}
          className="text-body font-medium text-link hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
