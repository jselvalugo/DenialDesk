/** Messages for the patients pages. Flat keys, dotted for grouping; values are the English source text. */
export const patients = {
  // Patient list
  "list.title": "Patients",
  "list.description":
    "Every claim and denial belongs to a patient. Open a patient to see their coverage, claims, and denials in one place.",
  "list.register": "Register patient",
  "list.emptyTitle": "No patients yet",
  "list.emptyDescriptionCanEdit": "Register a patient to start their record. Claims and denials link to it.",
  "list.emptyDescriptionReadOnly": "Patients appear here once your team registers them.",

  // Patient table (list and search results) and badges
  "badge.restricted": "Restricted",
  "badge.selfPay": "Self-pay",

  // Search
  "search.label": "Find a patient",
  "search.placeholder": "Last, First · name · MRN",
  "search.searching": "Searching…",
  "search.resultsLabel": "Search results",
  "search.noMatches": "No patients match.",
  "search.matchCount": "{count, plural, one {# match} other {# matches}}",
  "search.truncatedHint": "(first 25; refine the search)",
  "search.resultsCaption": "Patient search results",

  // Field names, shared by form labels, table headers, and validation messages
  "field.mrn": "MRN",
  "field.firstName": "First name",
  "field.lastName": "Last name",
  "field.birthDate": "Date of birth",
  "field.sex": "Sex",
  "field.address": "Address",
  "field.city": "City",
  "field.state": "State",
  "field.zip": "ZIP",
  "field.phone": "Phone",
  "field.primaryPayer": "Primary payer",
  "field.memberId": "Member ID",
  "field.sensitivityTags": "Sensitivity tags",

  // Sex
  "sex.female": "Female",
  "sex.male": "Male",
  "sex.unknown": "Unknown",

  // Record-level sensitivity tags (R-3.5.1)
  "sensitivity.hiv": "HIV",
  "sensitivity.mentalHealth": "Mental health",
  "sensitivity.sud": "Substance use (42 CFR Part 2)",
  "sensitivity.genetic": "Genetic testing",
  "sensitivity.minor": "Minor",
  "sensitivity.reproductiveHealth": "Reproductive health",

  // Register / edit form
  "form.mrnHint": "Leave blank to assign the next number.",
  "form.payerPlaceholder": "No insurance on file (self-pay)",
  "form.payerNoMatch": "No payer matches “{query}”. Pick one from the list, or clear the field for self-pay.",
  "form.payerUnverifiedOption": "{name} (unverified)",
  "form.payerUnverifiedHint": "Unverified payer — no payer ID or regulatory regime on file yet.",
  "form.memberIdHintOnFile": "On file: •••• {last4}. Leave blank to keep it.",
  "form.memberIdHintNew": "Stored encrypted; only the last 4 are shown.",
  "form.reasonLabel": "Reason for the change (required, saved in the audit trail)",
  "form.reasonHint": "Don't put patient details in the reason.",
  "form.syntheticNotice":
    "Synthetic data only. Never enter a real patient here; MRNs and member IDs must start with SYN.",
  "form.syntheticAttestation": "I confirm this record is synthetic test data, not a real patient.",
  "form.saveChanges": "Save changes",

  // Validation (patientSchema)
  "validation.enterFirstName": "Enter the first name.",
  "validation.firstNameMaxLength": "The first name can be at most {max} characters.",
  "validation.firstNameFormat":
    "The first name can only have letters, spaces, periods, apostrophes, and hyphens.",
  "validation.enterLastName": "Enter the last name.",
  "validation.lastNameMaxLength": "The last name can be at most {max} characters.",
  "validation.lastNameFormat":
    "The last name can only have letters, spaces, periods, apostrophes, and hyphens.",
  "validation.mrnMaxLength": "The MRN can be at most {max} characters.",
  "validation.mrnFormat": "The MRN can only have letters, digits, and hyphens.",
  "validation.birthDateInvalid": "Enter a valid date of birth.",
  "validation.birthDateTooOld": "Enter a date of birth after 1900.",
  "validation.birthDateFuture": "The date of birth can't be in the future.",
  "validation.chooseSex": "Choose the patient's sex.",
  "validation.addressMaxLength": "The address can be at most {max} characters.",
  "validation.cityMaxLength": "The city can be at most {max} characters.",
  "validation.stateFormat": "Enter the two-letter state.",
  "validation.postalFormat": "Enter a 5-digit ZIP or ZIP+4.",
  "validation.phoneFormat": "Enter a 10-digit phone number.",
  "validation.memberIdMinLength": "The member ID must be at least {min} characters.",
  "validation.memberIdMaxLength": "The member ID can be at most {max} characters.",
  "validation.memberIdFormat": "The member ID can only have letters, digits, and hyphens.",
  "validation.syntheticPrefix": "{field} must start with {marker} (synthetic data only).",
  "validation.memberIdNeedsPayer": "Choose the payer this member ID belongs to.",

  // Patient record errors (domain/patients/queries.ts)
  "error.choosePayer": "Choose a payer from the list.",
  "error.enterMemberIdForPayer": "Enter the member ID for this payer.",
  "error.duplicateMrn": "Another patient already has this MRN.",
  "error.patientNotFound": "Patient not found.",
  "error.staleRecord": "This patient changed since you opened the form. Reload and try again.",
  "error.notFound": "Not found.",
  "error.noMemberIdOnFile": "No member ID on file.",

  // Server action errors (app/(app)/patients/actions.ts)
  "error.roleReadOnly": "Your role can view patients but not change them.",
  "error.syntheticRequired": "Confirm this patient is synthetic. Real patient data is not allowed here.",
  "error.reload": "Reload the page and try again.",
  "error.reasonLength": "Say why the record is changing (5 to 500 characters).",
  "error.searchTooShort": "Enter at least 2 characters of a name or MRN.",
  "error.cantViewMemberId": "Your role can't view full member IDs.",
  "error.chooseReason": "Choose a reason.",

  // Navigation
  "nav.breadcrumb": "Breadcrumb",
  "nav.edit": "Edit",
  "nav.register": "Register",

  // Patient chart (detail page)
  "detail.totalsLabel": "Patient totals",
  "detail.bornOn": "born {date}",
  "detail.noInsurance": "No insurance on file (self-pay).",
  "detail.editRecord": "Edit record",
  "detail.claims": "Claims",
  "detail.billed": "Billed",
  "detail.paid": "Paid",
  "detail.openDenied": "Open denied",
  "detail.openDenialsCount": "{count, plural, one {# open denial} other {# open denials}}",
  "detail.denials": "Denials",
  "detail.noClaimsTitle": "No claims for this patient",
  "detail.noClaimsDescription": "Claims appear here once they are created or imported for this patient.",
  "detail.noDenialsTitle": "No denials for this patient",
  "detail.noDenialsDescription": "Denials on this patient's claims appear here.",
  "detail.dateOfService": "Date of service",
  "detail.notice": "Notice",
  "detail.appealBy": "Appeal by",
  "detail.denied": "Denied",
  "detail.demographics": "Demographics",
  "detail.notOnFile": "Not on file",
  "detail.primaryInsurance": "Primary insurance",

  // Edit page
  "edit.title": "Edit patient",
  "edit.description":
    "Changes are saved with your reason in the audit trail. Claims already sent keep what was billed.",

  // Register (new) page
  "new.title": "Register patient",
  "new.description": "Demographics and primary insurance. Claims for this patient will link to this record.",
  "new.readOnlyNotice": "Your role can view patients but not register them.",
  "new.backToPatients": "Back to patients",

  // Masked member ID reveal (components/patients/MaskedMemberId)
  "reveal.hide": "Hide",
  "reveal.endingIn": "Member ID ending in {last4}",
  "reveal.reasonLabel": "Reason for viewing",
  "reveal.reasonAppeal": "Preparing appeal",
  "reveal.reasonEligibility": "Checking eligibility",
  "reveal.reasonPayerCall": "Payer phone call",
  "reveal.reasonOther": "Other",
  "reveal.reveal": "Reveal",
  "reveal.error": "Couldn't reveal.",
} as const;
