/** Messages for rendering and storing custom field values on record forms and detail pages
 * (docs/specs/settings-and-custom-fields.md S2). Shared across patients, claims, denials, payers. */
export const customFields = {
  "section.title": "Custom fields",
  "input.locked": "Locked",
  "input.change": "Change",
  "input.cancelChange": "Cancel",
  "input.checkboxYes": "Yes",
  "input.required": "Required",

  "value.locked": "Locked",
  "value.open": "Open",
  "value.hide": "Hide",
  "value.unavailable": "Value unavailable",
  "value.notOnFile": "Not on file",
  "value.reasonLabel": "Reason for viewing",
  "value.reasonAppeal": "Preparing appeal",
  "value.reasonEligibility": "Checking eligibility",
  "value.reasonPayerCall": "Payer phone call",
  "value.reasonOther": "Other",
  "value.error": "Couldn't open.",

  "error.cantView": "You don't have permission to view this field.",
  "error.chooseReason": "Choose a reason.",

  // Standalone "edit custom fields" form footer (record-pages.md: every edit form's footer
  // carries an audit note), same wording as the patient form's.
  "form.actionsNote": "Saving records your name and the time in the audit trail.",
} as const;
