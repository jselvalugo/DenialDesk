"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import {
  sensitivityTagLabel,
  SENSITIVITY_TAG_LABEL_KEYS,
  type SensitivityTag,
} from "@/domain/patients/record";
import {
  CUSTOM_FIELD_ENTITY_LABEL_KEYS,
  CUSTOM_FIELD_TYPE_LABEL_KEYS,
  customFieldEntityLabel,
  customFieldTypeLabel,
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
  sensitivity: string | null;
  updatedAt: string;
}

/** Add a field (no `field`) or edit one. Record type, key, and type are fixed once created. */
export function CustomFieldForm({ field, entity }: { field?: CustomFieldValues; entity: CustomFieldEntity }) {
  const t = useT("settings");
  const tp = useT("patients");
  const tc = useT("common");
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
            {t("form.addTo")}
          </label>
          <select
            id="field-entity"
            name="entity"
            defaultValue={field?.entity ?? entity}
            disabled={editing}
            className={selectClass}
          >
            {(Object.keys(CUSTOM_FIELD_ENTITY_LABEL_KEYS) as CustomFieldEntity[]).map((value) => (
              <option key={value} value={value}>
                {customFieldEntityLabel(value, t)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="field-fieldType" className="text-label font-medium text-text">
            {t("form.fieldType")}
          </label>
          <select
            id="field-fieldType"
            name="fieldType"
            value={fieldType}
            onChange={(event) => setFieldType(event.target.value as CustomFieldType)}
            disabled={editing}
            className={selectClass}
          >
            {(Object.keys(CUSTOM_FIELD_TYPE_LABEL_KEYS) as CustomFieldType[]).map((value) => (
              <option key={value} value={value}>
                {customFieldTypeLabel(value, t)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <TextField
        label={t("fields.label")}
        name="label"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        maxLength={60}
        required
        hint={t("form.labelHint")}
        error={errorFor("label")}
      />
      <TextField
        label={t("fields.key")}
        name="key"
        value={editing ? key : key || ""}
        placeholder={keyFromLabel(label)}
        onChange={(event) => setKey(event.target.value)}
        maxLength={40}
        disabled={editing}
        className="font-mono"
        hint={editing ? t("form.keyHintEditing") : t("form.keyHintNew")}
        error={errorFor("key")}
      />
      {fieldType === "select" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="field-options" className="text-label font-medium text-text">
            {t("form.choices")}
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
            {t("form.choicesHint")}
          </p>
          {errorFor("options") && (
            <p className="text-label font-medium text-danger-fg">{errorFor("options")}</p>
          )}
        </div>
      )}
      <TextField
        label={t("form.helpText")}
        name="helpText"
        defaultValue={field?.helpText ?? ""}
        maxLength={200}
        hint={t("form.helpTextHint")}
        error={errorFor("helpText")}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="field-sensitivity" className="text-label font-medium text-text">
          {t("fields.sensitivity")}
        </label>
        <select
          id="field-sensitivity"
          name="sensitivity"
          defaultValue={field?.sensitivity ?? ""}
          aria-describedby="field-sensitivity-hint"
          aria-invalid={errorFor("sensitivity") ? true : undefined}
          className={selectClass}
        >
          <option value="">{t("fields.notSensitive")}</option>
          {(Object.keys(SENSITIVITY_TAG_LABEL_KEYS) as SensitivityTag[]).map((value) => (
            <option key={value} value={value}>
              {t("form.sensitiveOption", { name: sensitivityTagLabel(value, tp) })}
            </option>
          ))}
        </select>
        <p id="field-sensitivity-hint" className="text-label text-muted">
          {t("form.sensitivityHint")}
        </p>
        {errorFor("sensitivity") && (
          <p className="text-label font-medium text-danger-fg">{errorFor("sensitivity")}</p>
        )}
      </div>
      <label className="flex items-center gap-2 text-body text-text">
        <input type="checkbox" name="required" defaultChecked={field?.required ?? false} className="size-4" />
        {t("form.requiredLabel")}
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton variant="primary" pendingLabel={editing ? tc("action.saving") : t("form.adding")}>
          {editing ? t("form.saveField") : t("fields.addField")}
        </SubmitButton>
        <Link
          href={`/settings/fields?records=${field?.entity ?? entity}`}
          className="text-body font-medium text-link hover:underline"
        >
          {tc("action.cancel")}
        </Link>
      </div>
    </form>
  );
}
