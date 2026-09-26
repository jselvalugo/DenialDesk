import { z } from "zod";

// Custom field definitions (docs/specs/settings-and-custom-fields.md). Pure rules shared by the
// settings form, the server actions, and the database checks in drizzle/0023.

export const CUSTOM_FIELD_ENTITIES = {
  patient: "Patients",
  claim: "Claims",
  denial: "Denials",
  payer: "Payers",
} as const;
export type CustomFieldEntity = keyof typeof CUSTOM_FIELD_ENTITIES;

export const CUSTOM_FIELD_TYPES = {
  text: "Short text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox (yes / no)",
  select: "Choice list",
} as const;
export type CustomFieldType = keyof typeof CUSTOM_FIELD_TYPES;

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

const label = z.string().trim().min(1, "Enter a label.").max(60, "Keep the label to 60 characters or fewer.");
const helpText = z
  .string()
  .trim()
  .max(200, "Keep the help text to 200 characters or fewer.")
  .transform((value) => value || null);
const options = z
  .array(z.string().max(60, "Keep each choice to 60 characters or fewer."))
  .max(MAX_OPTIONS, `A choice list can have at most ${MAX_OPTIONS} choices.`);

function checkOptions(value: { fieldType: CustomFieldType; options: string[] }, ctx: z.RefinementCtx) {
  if (value.fieldType === "select" && value.options.length === 0) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least one choice, one per line." });
  }
}

/** A new field: its record type, key, and type are fixed once created. */
export const newCustomFieldSchema = z
  .object({
    entity: z.enum(Object.keys(CUSTOM_FIELD_ENTITIES) as [CustomFieldEntity, ...CustomFieldEntity[]], {
      message: "Choose which records get this field.",
    }),
    label,
    key: z
      .string()
      .trim()
      .regex(KEY, "Use a lowercase key that starts with a letter: letters, numbers, and underscores."),
    fieldType: z.enum(Object.keys(CUSTOM_FIELD_TYPES) as [CustomFieldType, ...CustomFieldType[]], {
      message: "Choose a field type.",
    }),
    options,
    required: z.boolean(),
    helpText,
  })
  .superRefine(checkOptions)
  .transform((value) => ({ ...value, options: value.fieldType === "select" ? value.options : [] }));
export type NewCustomField = z.output<typeof newCustomFieldSchema>;

/** What an edit may change. `fieldType` comes from the stored field, not the form. */
export const customFieldChangesSchema = z
  .object({
    fieldType: z.enum(Object.keys(CUSTOM_FIELD_TYPES) as [CustomFieldType, ...CustomFieldType[]]),
    label,
    options,
    required: z.boolean(),
    helpText,
  })
  .superRefine(checkOptions)
  .transform(({ fieldType, ...value }) => ({
    ...value,
    options: fieldType === "select" ? value.options : [],
  }));
export type CustomFieldChanges = z.output<typeof customFieldChangesSchema>;
