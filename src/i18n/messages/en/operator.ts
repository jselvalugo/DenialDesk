/** Messages for the operator pages. Flat keys, dotted for grouping; values are the English source text. */
export const operator = {
  // Shared status words (practices list and practice detail)
  "status.active": "Active",
  "status.suspended": "Suspended",
  "status.archived": "Archived",
  "status.demo": "Demo",
  "status.customer": "Customer",

  // Business Associate Agreement status for a practice (AgreementStatusBadge)
  "badge.missing": "No BAA",
  "badge.notYetEffective": "Not yet effective",
  "badge.expiringSoon": "Expiring soon",
  "badge.expired": "Expired",

  // Status of one agreement record (practice detail table)
  "recordStatus.superseded": "Superseded",
  "recordStatus.historical": "Historical",
  "recordStatus.voided": "Recorded in error",

  // Shared navigation
  "nav.allPractices": "All practices",
  "nav.breadcrumbLabel": "Breadcrumb",

  // Practices list (page.tsx)
  "list.title": "Practices",
  "list.description":
    "Every practice on this DenialDesk environment. Practice-level details only; patient data stays inside each practice.",
  "list.newPractice": "New practice",
  "list.totalsLabel": "Platform totals",
  "list.stat.customers": "Customer practices",
  "list.stat.withoutBaa": "Without a current BAA",
  "list.stat.openDenials": "Open denials (all practices)",
  "list.panelTitle": "All practices",
  "list.tableCaption": "All practices on this environment",
  "list.columns.team": "Team",
  "list.columns.openDenials": "Open denials",
  "list.columns.baa": "BAA",
  "list.suspend": "Suspend",
  "list.reactivate": "Reactivate",
  "list.suspendAria": "Suspend {name}",
  "list.reactivateAria": "Reactivate {name}",

  // New practice (practices/new)
  "newPractice.title": "New practice",
  "newPractice.description":
    "Creates the practice and its first administrator, who can then add their team. Record the signed BAA on the practice's page next.",
  "newPractice.practiceNameLabel": "Practice name",
  "newPractice.adminNameLabel": "Admin's full name",
  "newPractice.adminEmailLabel": "Admin's work email",
  "newPractice.submit": "Create practice",
  "newPractice.creating": "Creating…",
  "newPractice.createdHeading": "{name} created",
  "newPractice.sendDetails":
    "Send the admin their sign-in details through a secure channel. This password is shown only once.",
  "newPractice.temporaryPasswordLabel": "Temporary password",
  "newPractice.mfaHint": "They'll set up two-step verification on first sign-in.",
  "newPractice.openPractice": "Open practice",
  "newPractice.createAnother": "Create another",

  // Practice detail (practices/[tenantId])
  "practice.metaTitle": "Practice",
  "practice.descriptionCustomer": "Customer practice. Practice-level details only.",
  "practice.descriptionDemo": "Demo practice on synthetic data.",
  "practice.panelTitle": "Practice",
  "practice.baaTitle": "Business Associate Agreement (BAA)",
  "practice.baaDescription": "The signed agreement on file for this practice, and every earlier version.",
  "practice.noAgreement":
    "No agreement on file. Record the signed BAA below before this practice handles patient data.",
  "practice.tableCaption": "Agreements on file",
  "practice.columns.effective": "Effective",
  "practice.columns.expires": "Expires",
  "practice.columns.signed": "Signed",
  "practice.columns.practiceSigner": "Practice signer",
  "practice.columns.ourSigner": "DenialDesk signer",
  "practice.columns.recorded": "Recorded",
  "practice.columns.file": "File",
  "practice.untilTerminated": "Until terminated",
  "practice.voidedNote": "Recorded in error: {reason}",
  "practice.fileHashTitle": "SHA-256 {sha}",
  "practice.recordTitleRenew": "Record a renewed agreement",
  "practice.recordTitleNew": "Record the signed agreement",
  "practice.recordDescription":
    "Stored with the practice for the retention period; agreements are never edited or deleted.",
  "practice.correctTitle": "Correct the record",
  "practice.correctDescription":
    "A wrong upload or a typo can't be edited. Mark the agreement as recorded in error, then record the correct one; both stay on file.",

  // Record agreement form
  "agreementForm.replacesActive":
    "Recording a new agreement replaces the current active one. The current one stays on file as superseded.",
  "agreementForm.fileLabel": "Signed agreement (PDF, up to 5 MB)",
  "agreementForm.effectiveDateLabel": "Effective date",
  "agreementForm.expiresOnLabel": "Expires on",
  "agreementForm.expiresOnHint": "Leave blank if it runs until terminated.",
  "agreementForm.signedOnLabel": "Date signed",
  "agreementForm.practiceSignerLabel": "Signed for the practice by",
  "agreementForm.ourSignerLabel": "Signed for DenialDesk by",
  "agreementForm.nameAndTitleHint": "Name and title.",
  "agreementForm.noteLabel": "Note",
  "agreementForm.noteHint": "Optional. No patient information.",
  "agreementForm.syntheticAttestation":
    "This is a synthetic test document, not a real agreement. Its file name starts with <code>{prefix}</code>; real agreements are rejected in this environment.",
  "agreementForm.submit": "Record agreement",
  "agreementForm.recording": "Recording…",
  "agreementForm.recorded": "{filename} recorded as the active agreement.",
  "agreementForm.recordedSuperseded":
    "{filename} recorded as the active agreement; the previous agreement is kept as superseded.",

  // Void (record in error) agreement form
  "voidForm.recordedNotice":
    "The agreement is marked as recorded in error. It stays on file and no longer counts.",
  "voidForm.agreementLabel": "Agreement",
  "voidForm.choosePlaceholder": "Choose an agreement",
  "voidForm.optionLabel": "{filename} · effective {date} · {status}",
  "voidForm.reasonLabel": "Why it was recorded in error",
  "voidForm.reasonHint": "Kept with the record and in the audit trail. No patient information.",
  "voidForm.submit": "Mark as recorded in error",
  "voidForm.marking": "Marking…",

  // Server-action and domain errors
  "errors.createFormInvalid": "Enter a practice name, the admin's name, and a valid email.",
  "errors.invalidRequest": "Invalid request.",
  "errors.agreementFormInvalid": "Enter the effective and signed dates and both signers.",
  "errors.voidFormInvalid": "Choose the agreement and say why it was recorded in error.",
  "errors.chooseFile": "Choose the signed agreement as a PDF file.",
  "errors.fileTooLarge": "The file is larger than 5 MB. Export the signed PDF at a lower resolution.",
  "errors.fileNameInvalid": "The file name is too long or contains unusual characters. Rename the file.",
  "errors.fileNotPdf": "The file isn't a PDF. Upload the signed agreement as a PDF.",
  "errors.syntheticPrefixRequired":
    "This environment holds synthetic practices only. Name test files {prefix}… and never upload a real agreement here.",
  "errors.attestSyntheticRequired": "Confirm that the file is a synthetic test document.",
  "errors.expiresBeforeEffective": "The expiration date can't be before the effective date.",
  "errors.signedInFuture": "The signed date can't be in the future.",
  "errors.practiceNotFound": "That practice no longer exists or isn't a customer practice.",
  "errors.agreementRace": "Another agreement was just recorded for this practice. Reload the page to see it.",
  "errors.voidReasonTooShort": "Say why the agreement was recorded in error (at least a few words).",
  "errors.agreementNotFound":
    "That agreement isn't on file for this practice, or is already marked as recorded in error.",
  "errors.emailExists": "An account with that email already exists.",

  // University access panel (practice page; specs/denialdesk-university.md "Access")
  "university.title": "DenialDesk University",
  "university.description":
    "Access to the University courses is recorded here once the practice has bought it. The courses stay locked until then; the Wiki is always open.",
  "university.status.none": "Not requested",
  "university.status.requested": "Requested",
  "university.status.granted": "Access granted",
  "university.status.revoked": "Revoked",
  "university.requestedOn": "Requested by the practice on {date}",
  "university.grantedOn": "Granted on {date}",
  "university.revokedOn": "Revoked on {date}: {reason}",
  "university.noteLabel": "Order or invoice reference",
  "university.noteHint": "Optional. No patient information.",
  "university.grant": "Grant access",
  "university.granting": "Granting…",
  "university.granted": "Access granted. The practice's courses are unlocked.",
  "university.revokeReasonLabel": "Why access is revoked",
  "university.revokeReasonHint": "Kept with the record and in the audit trail.",
  "university.revoke": "Revoke access",
  "university.revoking": "Revoking…",
  "university.revoked": "Access revoked. The practice's courses are locked again.",
  "errors.universityFormInvalid": "Check the form and try again.",
  "errors.universityRevokeReasonTooShort": "Give a reason of at least five characters.",
  "errors.universityNotGranted": "This practice has no access to revoke.",
  "errors.universityAlreadyGranted": "This practice already has access. Reload the page to see it.",
} as const;
