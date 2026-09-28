"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormActions, FormNotices, FormRow, FormSection } from "@/components/records/FormShell";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SelectField } from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextareaField } from "@/components/ui/TextareaField";
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
  showInList: boolean;
  updatedAt: string;
}

/**
 * Add a field (no `field`) or edit one, sectioned per the record pattern (docs/specs/record-pages.md).
 * Record type, key, and type are fixed once created. Rendered inside `<Panel flush>`.
 */
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
  const [sensitivity, setSensitivity] = useState<string>(field?.sensitivity ?? "");
  const errorFor = (name: string) => (state.field === name ? state.error : undefined);

  return (
    <form action={action} className="flex flex-col" noValidate>
      {field && (
        <>
          <input type="hidden" name="id" value={field.id} />
          <input type="hidden" name="updatedAt" value={field.updatedAt} />
        </>
      )}
      <FormNotices>
        <FormAlert message={state.field ? undefined : state.error} />
      </FormNotices>
      <FormSection
        title={editing ? t("fields.editTitle", { label: field!.label }) : t("fields.newTitle")}
        description={editing ? t("fields.editDescription") : t("fields.newDescription")}
      >
        <FormRow columns="sm:grid-cols-2">
          <SelectField
            label={t("form.addTo")}
            name="entity"
            defaultValue={field?.entity ?? entity}
            disabled={editing}
            options={(Object.keys(CUSTOM_FIELD_ENTITY_LABEL_KEYS) as CustomFieldEntity[]).map((value) => ({
              value,
              label: customFieldEntityLabel(value, t),
            }))}
          />
          <SelectField
            label={t("form.fieldType")}
            name="fieldType"
            value={fieldType}
            onChange={(event) => setFieldType(event.target.value as CustomFieldType)}
            disabled={editing}
            options={(Object.keys(CUSTOM_FIELD_TYPE_LABEL_KEYS) as CustomFieldType[]).map((value) => ({
              value,
              label: customFieldTypeLabel(value, t),
            }))}
          />
        </FormRow>
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
          <TextareaField
            label={t("form.choices")}
            name="options"
            rows={5}
            defaultValue={field?.options.join("\n")}
            hint={t("form.choicesHint")}
            error={errorFor("options")}
          />
        )}
        <TextField
          label={t("form.helpText")}
          name="helpText"
          defaultValue={field?.helpText ?? ""}
          maxLength={200}
          hint={t("form.helpTextHint")}
          error={errorFor("helpText")}
        />
        <SelectField
          label={t("fields.sensitivity")}
          name="sensitivity"
          value={sensitivity}
          onChange={(event) => setSensitivity(event.target.value)}
          hint={t("form.sensitivityHint")}
          error={errorFor("sensitivity")}
          options={[
            { value: "", label: t("fields.notSensitive") },
            ...(Object.keys(SENSITIVITY_TAG_LABEL_KEYS) as SensitivityTag[]).map((value) => ({
              value,
              label: t("form.sensitiveOption", { name: sensitivityTagLabel(value, tp) }),
            })),
          ]}
        />
        <label className="flex items-center gap-2 text-body text-text">
          <input
            type="checkbox"
            name="required"
            defaultChecked={field?.required ?? false}
            className="size-4"
          />
          {t("form.requiredLabel")}
        </label>
        <label className="flex items-center gap-2 text-body text-text">
          <input
            type="checkbox"
            name="showInList"
            defaultChecked={field?.showInList ?? false}
            disabled={Boolean(sensitivity)}
            className="size-4"
          />
          {t("form.showInListLabel")}
        </label>
        {Boolean(sensitivity) && <p className="text-label text-muted">{t("form.showInListDisabledHint")}</p>}
      </FormSection>
      <FormActions>
        <SubmitButton variant="primary" pendingLabel={editing ? tc("action.saving") : t("form.adding")}>
          {editing ? t("form.saveField") : t("fields.addField")}
        </SubmitButton>
        <Link href={`/settings/fields?records=${field?.entity ?? entity}`} className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
