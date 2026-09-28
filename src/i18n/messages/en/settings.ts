/** Messages for the settings pages. Flat keys, dotted for grouping; values are the English source text. */
export const settings = {
  // Settings shell (layout, tabs)
  "page.title": "Settings",
  "page.description":
    "How DenialDesk is set up for your practice: its profile, the fields on its records, and who can do what.",
  "tabs.general": "General",
  "tabs.customFields": "Custom fields",
  "tabs.payers": "Payers",
  "tabs.usersAndRoles": "Users and roles",
  "tabs.security": "Security",
  "tabs.notifications": "Notifications",
  "tabs.integrations": "Integrations",
  "tabs.sectionsLabel": "Settings sections",
  // Distinct from `tabs.sectionsLabel` on purpose: a record page's own breadcrumb trail is a
  // second `nav` landmark, and sharing the tab bar's label breaks an e2e locator that looks up a
  // `nav` by its accessible name (docs/specs/record-pages.md; matches claims/denials `nav.breadcrumb`).
  "nav.breadcrumb": "Breadcrumb",

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
  "form.showInListLabel": "Show in list: add a column for this field on the record list",
  "form.showInListDisabledHint": "Sensitive fields never appear in lists, search, or exports.",
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
  "error.tooManyListColumns":
    "At most {max} fields per record type can show in the list. Turn one off first.",

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
  "error.staleValues": "These fields changed since you opened them. Reload and try again.",
  "error.reload": "Reload the page and try again.",

  // Payers under Settings (docs/specs/settings-and-custom-fields.md S2 PR4; read-only record;
  // payer-catalog P2 will add verification and editing).
  "payers.metaTitle": "Payers",
  "payers.listTitle": "Payers",
  "payers.listDescription":
    "The insurers on file for your practice, loaded from the Florida starter catalog.",
  "payers.count": "{count, plural, one {# payer} other {# payers}}",
  "payers.tableCaption": "Payers",
  "payers.ediPayerId": "EDI payer ID",
  "payers.notVerified": "Not verified",
  "payers.source": "Source",
  "payers.sourceNotRecorded": "Not recorded",
  "payers.sourceOir": "Florida OIR licensee list",
  "payers.sourceSmmc": "AHCA Medicaid managed care plan list",
  "payers.sourceCms": "CMS",
  "payers.sourceReference": "Reference list (not yet verified)",
  "payers.emptyTitle": "No payers yet",
  "payers.emptyDescription": "Payers appear once your practice's starter catalog loads.",

  "payers.detailMetaTitle": "Payer",
  "payers.detailEyebrow": "Payer record",
  "payers.breadcrumbList": "Payers",
  "payers.badgeUnverified": "Unverified",
  "payers.detailsTitle": "Payer details",
  "payers.detailsDescription":
    "Name, EDI payer ID, and regulatory regime are verified in a later phase and can't be changed here.",
  "payers.field.ediPayerId": "EDI payer ID",
  "payers.field.regime": "Regulatory regime",
  "payers.field.source": "Source",
  "payers.field.added": "Added",
  "payers.editCustomFields": "Edit custom fields",

  "payers.fieldsMetaTitle": "Edit payer custom fields",
  "payers.fieldsPageTitle": "Edit custom fields",
  "payers.fieldsDescription": "Fields your practice added to payers.",
  "payers.fieldsBreadcrumb": "Custom fields",

  "error.notPayerEditor": "Only administrators and managers can change a payer's custom fields.",
  "error.recordNotFound": "Record not found.",

  // Integrations (docs/specs/patient-integrations.md "PI1b"): the practice's EHR/PM, connected
  // over FHIR R4 and synced read-only into the Patient Register.
  "integrations.metaTitle": "Integrations",
  "integrations.listTitle": "Integrations",
  "integrations.listDescription":
    "Connect your practice's EHR/PM so the Patient Register stays a synced, read-only copy instead of hand-typed records.",
  "integrations.newConnection": "New connection",
  "integrations.tableCaption": "Integrations",
  "integrations.field.name": "Name",
  "integrations.field.table": "Table",
  "integrations.field.status": "Status",
  "integrations.field.lastSync": "Last sync",
  "integrations.table.patients": "Patients",
  "integrations.neverSynced": "Never synced",
  "integrations.emptyTitle": "No integrations yet",
  "integrations.emptyDescriptionCanManage":
    "Connect your practice's EHR/PM so patients sync automatically instead of being typed by hand.",
  "integrations.emptyDescriptionReadOnly": "An administrator can connect your practice's EHR/PM here.",

  "integrations.status.draft": "Draft",
  "integrations.status.pending_approval": "Awaiting approval",
  "integrations.status.active": "Active",
  "integrations.status.paused": "Paused",
  "integrations.status.error": "Needs attention",
  "integrations.status.revoked": "Revoked",

  // New connection (own page, DESIGN.md §8)
  "integrations.new.metaTitle": "New connection",
  "integrations.new.title": "Connect an integration",
  "integrations.new.description":
    "Connect your practice's EHR/PM over HL7 FHIR R4. An administrator tests and submits it; the platform operator verifies it with your EHR administrator before sync starts.",
  "integrations.new.sandboxOption": "Use the synthetic sandbox",
  "integrations.new.sandboxHint":
    "Fills in the built-in sandbox's address so you can try the connection lifecycle with synthetic data only — no real EHR needed.",
  "integrations.new.sandboxNotice": "This form is filled with the built-in synthetic sandbox's address.",
  "integrations.new.save": "Create connection",
  "integrations.new.saving": "Creating…",

  // Connection form (new and edit; components/integrations/ConnectionForm.tsx)
  "integrations.form.displayName": "Connection name",
  "integrations.form.displayNameHint":
    "Shown to your team, e.g. “Athenahealth”. Never put patient information here.",
  "integrations.form.baseUrl": "Base URL",
  "integrations.form.baseUrlHint":
    "The FHIR R4 base address your EHR/PM gave you, e.g. https://ehr.example.com/r4.",
  "integrations.form.clientId": "Client ID",
  "integrations.form.clientIdHint": "The OAuth client ID your EHR/PM registered for DenialDesk.",
  "integrations.form.mrnIdentifierSystem": "MRN identifier system",
  "integrations.form.mrnIdentifierSystemHint":
    "The FHIR identifier system your EHR/PM uses for the medical record number (not a Social Security, Medicare, driver's license, or passport number).",
  "integrations.form.usResidencyAttested":
    "This EHR/PM endpoint stores and processes data only in the United States.",
  "integrations.form.endpointLocked": "The endpoint can't change once the connection is no longer a draft.",

  // Record page (settings/integrations/[id])
  "integrations.detailMetaTitle": "Integration",
  "integrations.detailEyebrow": "Integration",
  "integrations.breadcrumbList": "Integrations",
  "integrations.field.kind": "Connector",
  "integrations.field.kindFhir": "HL7 FHIR R4",
  "integrations.field.isSandbox": "Environment",
  "integrations.field.isSandboxValue": "Synthetic sandbox",
  "integrations.field.isRealValue": "Real EHR/PM",
  "integrations.field.attestation": "U.S. residency attestation",
  "integrations.field.attestedBy": "Attested {date}",
  "integrations.field.notAttested": "Not attested yet",
  "integrations.field.created": "Created",
  "integrations.field.submitted": "Submitted",
  "integrations.field.approved": "Approved",
  "integrations.field.revoked": "Revoked",
  "integrations.field.lastSuccess": "Last successful sync",
  "integrations.section.configuration": "Configuration",
  "integrations.section.lifecycle": "Lifecycle",

  "integrations.action.edit": "Edit",
  "integrations.action.withdraw": "Withdraw",
  "integrations.action.pause": "Pause",
  "integrations.action.resume": "Resume",
  "integrations.action.revoke": "Revoke",
  "integrations.action.submit": "Submit",
  "integrations.action.submitDisabledHint": "Test the connection first.",
  "integrations.action.activateSandbox": "Activate sandbox connection",
  "integrations.action.syncHistory": "Sync history",
  "integrations.action.verifyIdentity": "Verify your identity",

  "integrations.revoke.confirmTitle": "Revoke this connection?",
  "integrations.revoke.confirmDescription":
    "This can't be undone. Patients stop syncing and the Patient Register becomes editable by hand again. Deregister DenialDesk as a client in your EHR/PM afterward.",
  "integrations.revoke.reasonLabel": "Reason",
  "integrations.revoke.reasonNoLongerUsed": "No longer used",
  "integrations.revoke.reasonSwitchingSystems": "Switching EHR/PM systems",
  "integrations.revoke.reasonConfiguredInError": "Configured in error",
  "integrations.revoke.reasonSecurityConcern": "Security concern",
  "integrations.revoke.reasonOther": "Other",
  "integrations.revoke.confirm": "Revoke connection",
  "integrations.revoke.offboardingTitle": "Next: deregister DenialDesk at your EHR/PM",
  "integrations.revoke.offboardingBody":
    "DenialDesk no longer has a signing key for this connection, but the client registration itself lives at your EHR/PM. Ask your EHR administrator to remove or disable the DenialDesk client so it can't be reused.",

  "integrations.runs.metaTitle": "Sync history",
  "integrations.runs.title": "Sync history",
  "integrations.runs.description": "Counts and outcomes only — never patient data.",
  "integrations.runs.emptyTitle": "No syncs yet",
  "integrations.runs.emptyDescription": "Sync runs appear here once this connection starts syncing.",

  // Errors (domain/integrations/connections.ts)
  "integrations.error.notAdmin": "Only administrators can manage integrations.",
  "integrations.error.notFound": "Connection not found.",
  "integrations.error.invalidField": "Check the highlighted field.",
  "integrations.error.displayNameInvalid": "Enter a connection name of 1 to 80 characters.",
  "integrations.error.baseUrlRequired": "Enter the base URL.",
  "integrations.error.clientIdInvalid": "Enter a client ID of 1 to 255 characters.",
  "integrations.error.mrnSystemRequired": "Enter the MRN identifier system.",
  "integrations.error.sandboxRefused": "Only the synthetic sandbox can be created in this environment.",
  "integrations.error.realEndpointRefused":
    "Real EHR/PM endpoints aren't available in this environment. Use the synthetic sandbox instead.",
  "integrations.error.mrnSystemRefused":
    "This identifier system can't be used as the MRN: it names a Social Security, Medicare, driver's license, or passport number, not a medical record number.",
  "integrations.error.attestationRequired":
    "Attest that this endpoint stores and processes data only in the United States to connect a real endpoint.",
  "integrations.error.stepUpRequired": "Verify your identity again to continue.",
  "integrations.error.editLockedNotDraft": "This connection can only be edited while it's still a draft.",
  "integrations.error.cannotChangeConnectionType":
    "A connection's endpoint can't switch between the sandbox and a real EHR/PM. Create a new connection instead.",
  "integrations.error.invalidTransition": "This action isn't available for the connection's current status.",
  "integrations.error.chooseReason": "Choose a reason.",

  // URL rules (src/integrations/fhir/url-rules.ts)
  "integrations.error.urlInvalid": "Enter a valid URL.",
  "integrations.error.urlNotHttps": "The base URL must use https.",
  "integrations.error.urlHasUserinfo": "The base URL can't include a username or password.",
  "integrations.error.urlHasQuery": "The base URL can't include a query string.",
  "integrations.error.urlHasFragment": "The base URL can't include a fragment.",
  "integrations.error.urlIpLiteral": "The base URL must use a host name, not an IP address.",
  "integrations.error.urlBlockedHost": "This host isn't a real EHR/PM address.",
  "integrations.error.urlSingleLabel": "Enter a full host name (e.g. ehr.example.com).",
  "integrations.error.urlTrailingDot": "Remove the trailing dot from the host name.",
  "integrations.error.urlPortNotAllowed": "This port isn't allowed for an EHR/PM connection.",
} as const;
