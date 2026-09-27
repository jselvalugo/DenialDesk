import { z } from "zod";
import { en } from "@/i18n/messages/en";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import { SENSITIVITY_TAG_LABEL_KEYS, type SensitivityTag } from "@/domain/patients/record";

// Custom field definitions (docs/specs/settings-and-custom-fields.md). Pure rules shared by the
// settings form, the server actions, and the database checks in drizzle/0023.

type SettingsKey = MessageKey<"settings">;
type SettingsT = Translator<Messages["settings"]>;

/** English translator used when a caller doesn't have the request's language (e.g. unit tests). */
const englishSettingsT: SettingsT = createTranslator(en.settings, "en");

export const CUSTOM_FIELD_ENTITY_LABEL_KEYS = {
  patient: "entity.patient",
  claim: "entity.claim",
  denial: "entity.denial",
  payer: "entity.payer",
} as const satisfies Record<string, SettingsKey>;
export type CustomFieldEntity = keyof typeof CUSTOM_FIELD_ENTITY_LABEL_KEYS;

export function customFieldEntityLabel(entity: CustomFieldEntity, t: SettingsT = englishSettingsT): string {
  return t(CUSTOM_FIELD_ENTITY_LABEL_KEYS[entity]);
}

export const CUSTOM_FIELD_TYPE_LABEL_KEYS = {
  text: "type.text",
  long_text: "type.longText",
  number: "type.number",
  date: "type.date",
  checkbox: "type.checkbox",
  select: "type.select",
} as const satisfies Record<string, SettingsKey>;
export type CustomFieldType = keyof typeof CUSTOM_FIELD_TYPE_LABEL_KEYS;

export function customFieldTypeLabel(type: CustomFieldType, t: SettingsT = englishSettingsT): string {
  return t(CUSTOM_FIELD_TYPE_LABEL_KEYS[type]);
}

/** Per record type, so a practice can't bury its forms under hundreds of fields. */
export const MAX_FIELDS_PER_ENTITY = 50;
export const MAX_OPTIONS = 50;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Machine name from a label: "Referring clinic #" → "referring_clinic". */
export function keyFromLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return slug || "field";
}

/** One choice per line; blanks and duplicates dropped, order kept. */
export function parseOptions(raw: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const option = line.trim();
    if (option && !seen.has(option.toLowerCase())) {
      seen.add(option.toLowerCase());
      options.push(option);
    }
  }
  return options;
}

function checkOptions(t: SettingsT) {
  return (value: { fieldType: CustomFieldType; options: string[] }, ctx: z.RefinementCtx) => {
    if (value.fieldType === "select" && value.options.length === 0) {
      ctx.addIssue({ code: "custom", path: ["options"], message: t("validation.needOneChoice") });
    }
  };
}

/** A new field: its record type, key, and type are fixed once created. */
export function newCustomFieldSchema(t: SettingsT = englishSettingsT) {
  const label = z.string().trim().min(1, t("validation.enterLabel")).max(60, t("validation.labelMaxLength"));
  const helpText = z
    .string()
    .trim()
    .max(200, t("validation.helpTextMaxLength"))
    .transform((value) => value || null);
  const options = z
    .array(z.string().max(60, t("validation.choiceMaxLength")))
    .max(MAX_OPTIONS, t("validation.choicesMax", { max: MAX_OPTIONS }));
  /** Blank means ordinary; otherwise one of the record sensitivity categories (R-3.5.1). */
  const sensitivity = z
    .string()
    .trim()
    .refine((value) => value === "" || value in SENSITIVITY_TAG_LABEL_KEYS, t("validation.chooseSensitivity"))
    .transform((value) => (value ? (value as SensitivityTag) : null));

  return z
    .object({
      entity: z.enum(
        Object.keys(CUSTOM_FIELD_ENTITY_LABEL_KEYS) as [CustomFieldEntity, ...CustomFieldEntity[]],
        {
          message: t("validation.chooseEntity"),
        },
      ),
      label,
      key: z.string().trim().regex(KEY, t("validation.keyFormat")),
      fieldType: z.enum(
        Object.keys(CUSTOM_FIELD_TYPE_LABEL_KEYS) as [CustomFieldType, ...CustomFieldType[]],
        {
          message: t("validation.chooseFieldType"),
        },
      ),
      options,
      required: z.boolean(),
      helpText,
      sensitivity,
    })
    .superRefine(checkOptions(t))
    .transform((value) => ({ ...value, options: value.fieldType === "select" ? value.options : [] }));
}
export type NewCustomField = z.output<ReturnType<typeof newCustomFieldSchema>>;

/** What an edit may change. `fieldType` comes from the stored field, not the form. */
export function customFieldChangesSchema(t: SettingsT = englishSettingsT) {
  const label = z.string().trim().min(1, t("validation.enterLabel")).max(60, t("validation.labelMaxLength"));
  const helpText = z
    .string()
    .trim()
    .max(200, t("validation.helpTextMaxLength"))
    .transform((value) => value || null);
  const options = z
    .array(z.string().max(60, t("validation.choiceMaxLength")))
    .max(MAX_OPTIONS, t("validation.choicesMax", { max: MAX_OPTIONS }));
  const sensitivity = z
    .string()
    .trim()
    .refine((value) => value === "" || value in SENSITIVITY_TAG_LABEL_KEYS, t("validation.chooseSensitivity"))
    .transform((value) => (value ? (value as SensitivityTag) : null));

  return z
    .object({
      fieldType: z.enum(Object.keys(CUSTOM_FIELD_TYPE_LABEL_KEYS) as [CustomFieldType, ...CustomFieldType[]]),
      label,
      options,
      required: z.boolean(),
      helpText,
      sensitivity,
    })
    .superRefine(checkOptions(t))
    .transform(({ fieldType, ...value }) => ({
      ...value,
      options: fieldType === "select" ? value.options : [],
    }));
}
export type CustomFieldChanges = z.output<ReturnType<typeof customFieldChangesSchema>>;
