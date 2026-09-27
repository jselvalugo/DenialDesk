/** Messages for the settings pages. Flat keys, dotted for grouping; values are the English source text. */
export const settings = {
  // Settings shell (layout, tabs)
  "page.title": "Settings",
  "page.description":
    "How DenialDesk is set up for your practice: its profile, the fields on its records, and who can do what.",
  "tabs.general": "General",
  "tabs.customFields": "Custom fields",
  "tabs.usersAndRoles": "Users and roles",
  "tabs.security": "Security",
  "tabs.notifications": "Notifications",
  "tabs.integrations": "Integrations",
  "tabs.sectionsLabel": "Settings sections",

  // General settings page
  "general.profileTitle": "Practice profile",
  "general.profileDescription": "Set when DenialDesk created your practice.",
  "general.practiceName": "Practice name",
  "general.environment": "Environment",
  "general.production": "Production",
  "general.preProduction": "Pre-production",
  "general.syntheticDataOnly": "synthetic data only",
  "general.dataResidency": "Data residency",
  "general.dataResidencyValue": "United States only",
  "general.contactSupport": "To change the practice name, contact DenialDesk support.",
  "general.accountTitle": "Your account",
  "general.accountDescription": "The user you are signed in as.",
  "general.canChangeSettings": "Can change settings",
  "general.viewOnly": "No: view only",

  // Custom fields list
  "fields.metaTitle": "Custom fields",
  "fields.recordTypesLabel": "Record types",
  "fields.recordsHeading": "Records",
  "fields.panelTitle": "{entity} fields",
  "fields.panelDescription":
    "Fields your practice adds to {entity}, in form order. Deactivated fields are hidden from forms and keep their history.",
  "fields.addField": "Add field",
  "fields.emptyTitle": "No custom fields on {entity} yet",
  "fields.emptyDescriptionCanEdit":
    "Add a field to capture something DenialDesk doesn't track out of the box, such as a referring clinic or an internal account tier.",
  "fields.emptyDescriptionReadOnly":
    "An administrator can add fields to capture what your practice tracks beyond the standard record.",
  "fields.tableCaption": "{entity} custom fields",
  "fields.label": "Label",
  "fields.key": "Key",
  "fields.sensitivity": "Sensitivity",
  "fields.locked": "Locked · {category}",
  "fields.notSensitive": "Not sensitive",
  "fields.active": "Active",
  "fields.inactive": "Inactive",
  "fields.editAria": "Edit {label}",
  "fields.deactivate": "Deactivate",
  "fields.reactivate": "Reactivate",
  "fields.toggleAria": "{action} {label}",

  "fields.newMetaTitle": "Add custom field",
  "fields.newTitle": "Add a custom field",
  "fields.newDescription": "The field appears on every record of the chosen type.",
  "fields.editMetaTitle": "Edit custom field",
  "fields.editTitle": "Edit “{label}”",
  "fields.editDescription": "Record type, key, and field type are fixed once a field exists.",

  // Record types a custom field can belong to
  "entity.patient": "Patients",
  "entity.claim": "Claims",
  "entity.denial": "Denials",
  "entity.payer": "Payers",

  // Custom field types
  "type.text": "Short text",
  "type.longText": "Long text",
  "type.number": "Number",
  "type.date": "Date",
  "type.checkbox": "Checkbox (yes / no)",
  "type.select": "Choice list",
  "fields.choicesCount": "{count, plural, one {# choice} other {# choices}}",

  // Add / edit custom field form
  "form.addTo": "Add to",
  "form.fieldType": "Field type",
  "form.labelHint":
    "What people see on the form, e.g. “Referring clinic”. Never put patient information in a label.",
  "form.keyHintEditing": "The key can't change once the field exists.",
  "form.keyHintNew":
    "Used in exports and integrations. Leave blank to use the suggestion. It can't change later.",
  "form.choices": "Choices",
  "form.choicesHint": "One choice per line, in the order to show them (up to 50).",
  "form.helpText": "Help text (optional)",
  "form.helpTextHint": "Shown under the field on the form.",
  "form.sensitiveOption": "Sensitive: {name}",
  "form.sensitivityHint":
    "A sensitive field is locked on every record: its value stays hidden until someone opens it with a reason, and each opening is recorded in the audit log.",
  "form.requiredLabel": "Required: the record can't be saved without it",
  "form.saveField": "Save field",
  "form.adding": "Adding…",

  // Custom field server actions (app/(app)/settings/fields/actions.ts)
  "error.notAdmin": "Only administrators can change custom fields.",
  "error.duplicateKey": "Another field on these records already uses this key.",
  "error.fieldNotFound": "Field not found.",

  // Custom field definitions (domain/settings/custom-fields.ts)
  "validation.enterLabel": "Enter a label.",
  "validation.labelMaxLength": "Keep the label to 60 characters or fewer.",
  "validation.helpTextMaxLength": "Keep the help text to 200 characters or fewer.",
  "validation.choiceMaxLength": "Keep each choice to 60 characters or fewer.",
  "validation.choicesMax": "A choice list can have at most {max} choices.",
  "validation.chooseSensitivity": "Choose a sensitivity category from the list.",
  "validation.needOneChoice": "Add at least one choice, one per line.",
  "validation.chooseEntity": "Choose which records get this field.",
  "validation.keyFormat": "Use a lowercase key that starts with a letter: letters, numbers, and underscores.",
  "validation.chooseFieldType": "Choose a field type.",

  // Custom field storage (domain/settings/queries.ts)
  "error.tooManyFields":
    "This record type already has {max} active fields. Deactivate one you no longer use.",
  "error.staleField": "This field changed since you opened it. Reload and try again.",

  // Custom field values (domain/custom-fields/values.ts)
  "error.required": "{field} is required.",
  "error.maxLength": "{field} must be {max} characters or fewer.",
  "error.mustBeNumber": "{field} must be a number.",
  "error.tooManyDigits": "{field} has too many digits.",
  "error.mustBeDate": "{field} must be a valid date.",
  "error.chooseCurrentOption": "Choose a current option for {field}.",
  "error.unknownFieldType": "Unknown field type for {field}.",
  "error.cantChangeField": "Your role can't change {field}.",
  "error.cantReveal": "Your role can't reveal custom field values.",
  "error.notLocked": "This value isn't locked.",
  "error.noValueOnFile": "No value on file.",
  "error.valueUnavailable": "Value unavailable.",
} as const;
