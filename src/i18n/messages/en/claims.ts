/** Messages for the claims pages. Flat keys, dotted for grouping; values are the English source text. */
export const claims = {
  "nav.breadcrumb": "Breadcrumb",
  "list.stat.sectionLabel": "Unsubmitted claim totals",

  // Claim list (app/(app)/claims/page.tsx)
  "list.title": "Claims",
  "list.description": "Unsubmitted claims first, the ones closest to losing their filing window at the top.",
  "list.stat.unsubmitted": "Unsubmitted",
  "list.stat.unsubmittedDetail": "Draft or rejected by the payer",
  "list.stat.unsubmittedBilled": "Unsubmitted billed",
  "list.stat.dueSoon": "Filing due in {days} days",
  "list.stat.dueSoonDetail": "Timely-filing window closing",
  "list.stat.pastDeadline": "Past filing deadline",
  "list.stat.pastDeadlineDetail": "Likely denied as untimely",
  "list.stat.notConfiguredDetail": "{count} with no filing rule configured",
  "list.stat.payerUnverifiedDetail": "{count} with an unverified payer",
  "list.filter.claims": "Claims",
  "list.filter.unsubmitted": "Unsubmitted",
  "list.filter.inProcess": "Sent to payer",
  "list.filter.allPayers": "All payers",
  "list.filter.filingDeadline": "Filing deadline",
  "list.filter.dueSoon": "Due in {days} days",
  "list.truncated":
    "More than {limit} unsubmitted claims: the list, filters, and totals cover the oldest {limit} by date of service only.",
  "list.empty.title.unsubmitted": "No unsubmitted claims",
  "list.empty.title.unsubmittedFiltered": "No unsubmitted claims match these filters",
  "list.empty.title.inProcess": "No claims sent to payer",
  "list.empty.title.inProcessFiltered": "No claims sent to payer match these filters",
  "list.empty.title.all": "No claims",
  "list.empty.title.allFiltered": "No claims match these filters",
  "list.empty.descriptionUnsubmitted": "Draft and rejected claims appear here until the payer accepts them.",
  "list.empty.descriptionOther": "Claims appear here once they are created or imported.",
  "list.table.captionUnsubmitted": "Unsubmitted claims",
  "list.table.captionInProcess": "Claims sent to payer",
  "list.table.captionAll": "All claims",
  "list.table.dateOfService": "Date of service",
  "list.table.filingDeadline": "Filing deadline",
  "list.table.noDeadlinePayerUnverified": "No deadline — payer not verified",

  // Filing status (domain/claims/status.ts FILING_STATE_LABEL_KEYS)
  "filing.state.pastDeadline": "Past deadline",
  "filing.state.notConfigured": "Not configured",
  "filing.state.payerUnverified": "Payer not verified",

  // Claim detail (app/(app)/claims/[id]/page.tsx)
  "detail.pageTitle": "Claim",
  "detail.eyebrow": "Claim record",
  "detail.details.title": "Claim details",
  "detail.lines.title": "Claim lines",
  "detail.filing.rolledNote":
    "(pending counsel: {date}; weekend/holiday extension not yet confirmed, so file by the date above)",
  "detail.breadcrumbClaims": "Claims",
  "detail.field.dateOfService": "Date of service",
  "detail.field.version": "Version",
  "detail.field.provider": "Provider",
  "detail.field.npi": "NPI {npi}",
  "detail.field.location": "Location",
  "detail.field.payer": "Payer",
  "detail.field.billed": "Billed",
  "detail.field.paid": "Paid",
  "detail.field.payerReceived": "Payer received",
  "detail.field.diagnosis": "Diagnosis",
  "detail.table.line": "Line",
  "detail.table.procedure": "Procedure",
  "detail.table.modifiers": "Modifiers",
  "detail.table.units": "Units",
  "detail.table.charge": "Charge",
  "detail.table.claimLinesCaption": "Claim lines",
  "detail.readOnlyNote": "You have read-only access to claims.",
  "detail.history.title": "Version history",
  "detail.history.listLabel": "Claim versions",
  "detail.history.description": "Every change to this claim: who, when, and why. History can't be edited.",
  "detail.history.version": "Version {version}",
  "detail.history.formerTeamMember": "Former team member",
  "detail.history.system": "System",
  "detail.history.changedTo": "changed to",
  "detail.filing.title": "Timely filing",
  "detail.filing.receivedNoLongerApplies": "Received by the payer {date}. Timely filing no longer applies.",
  "detail.filing.acceptedNoLongerApplies": "Accepted by the payer. Timely filing no longer applies.",
  "detail.filing.awaitingReceipt":
    "Sent; the claim is timely if it was submitted by the deadline, as the clearinghouse acknowledgement shows.",
  "detail.filing.pastDeadlineWarning":
    "The filing window has closed. The payer is likely to deny this claim as untimely unless an exception applies.",
  "detail.filing.fromServiceDate": "From the date of service ({citation}).",
  "detail.filing.pendingVerification": "Pending counsel verification",
  "detail.filing.payerUnverified":
    "No deadline — payer not verified. Once this payer's regulatory regime is verified, confirm the filing window manually with the payer contract or applicable law; DenialDesk cannot compute one until then.",
  "detail.filing.notConfigured":
    "DenialDesk has no filing rule configured for {regime} claims. Confirm the filing window with the payer contract or applicable law before it lapses.",
  "detail.patient.title": "Patient",
  "detail.patient.dob": "Date of birth",
  "detail.patient.mrn": "MRN",
  "detail.patient.memberId": "Member ID",
  "detail.patient.memberIdNone": "None on file",
  "detail.payments.title": "Payments",
  "detail.payments.none": "No remittance has paid or denied this claim yet.",
  "detail.payments.paidOn": "paid {date}",
  "detail.payments.promptPayLink": "Prompt-pay clock",
  "detail.denials.title": "Denials",
  "detail.denials.none": "No denials on this claim.",
  "detail.denials.notice": "notice {date}",
  "detail.editCustomFields": "Edit custom fields",

  // Custom fields edit page (app/(app)/claims/[id]/fields/page.tsx)
  "fields.pageTitle": "Custom fields",
  "fields.breadcrumb": "Custom fields",
  "fields.description":
    "Practice-defined fields on this claim. They aren't part of the billed claim and saving them never creates a new claim version.",

  // Correction form (app/(app)/claims/[id]/CorrectionForm.tsx)
  "correction.button": "Correct claim",
  "correction.savedAs": "Saved as version {version}.",
  "correction.form.dateOfService": "Date of service",
  "correction.form.diagnosisCodes": "Diagnosis codes (ICD-10-CM, separated by commas)",
  "correction.form.linesCaption": "Claim lines to correct",
  "correction.form.lineProcedureAria": "Line {number} procedure code",
  "correction.form.lineModifiersAria": "Line {number} modifiers",
  "correction.form.lineUnitsAria": "Line {number} units",
  "correction.form.lineChargeAria": "Line {number} charge",
  "correction.form.chargeHeader": "Charge ($)",
  "correction.form.reason": "Reason for the correction (required, saved in the claim history)",
  "correction.form.reasonHint":
    "Don't put patient details in the reason. Code changes must be supported by the medical record.",
  "correction.form.save": "Save new version",
  "correction.form.saving": "Saving…",

  // Changed-field labels (domain/claims/correction.ts describeChange)
  "correction.field.serviceDate": "date of service",
  "correction.field.diagnosisCodes": "diagnosis codes",
  "correction.field.procedureCode": "procedure",
  "correction.field.modifiers": "modifiers",
  "correction.field.units": "units",
  "correction.field.chargeCents": "charge",
  "correction.field.status": "status",
  "correction.field.paidCents": "paid",
  "correction.field.line": "line {number}",
  "correction.field.lineSub": "line {number} {field}",

  // Correction form validation (domain/claims/correction.ts correctionIssueMessage)
  "correction.error.line": "Line {number}: {message}",
  "correction.error.serviceDate": "Enter a valid date of service.",
  "correction.error.diagnosisRequired": "Enter at least one diagnosis code.",
  "correction.error.diagnosisMax": "At most {max} diagnosis codes.",
  "correction.error.diagnosisFormat": "Diagnosis codes must be ICD-10-CM format (e.g. E11.9).",
  "correction.error.procedureCode": "Procedure codes are 5 letters or digits (CPT/HCPCS).",
  "correction.error.modifierFormat": "Modifiers are 2 letters or digits.",
  "correction.error.modifierMax": "At most {max} modifiers per line.",
  "correction.error.unitsInvalid": "Units must be a whole number.",
  "correction.error.unitsRange": "Units must be between 1 and 999.",
  "correction.error.chargeInvalid": "Enter charges as dollars and cents.",
  "correction.error.chargeMin": "Charges must be at least $0.01.",
  "correction.error.chargeMax": "Charges must be under $100,000 per line.",
  "correction.error.linesRequired": "Enter at least one claim line.",
  "correction.error.reasonRequired": "Say why the claim is being corrected.",
  "correction.error.reasonMax": "Keep the reason under {max} characters.",
  "correction.error.generic": "Check the highlighted fields and try again.",

  // Claim correction errors (domain/claims/versions.ts ClaimCorrectionError)
  "correction.error.claimNotFound": "Claim not found.",
  "correction.error.notCorrectable": "Only draft or rejected claims can be corrected.",
  "correction.error.staleVersion": "This claim changed since you opened it. Reload and try again.",
  "correction.error.futureServiceDate": "The date of service can't be in the future.",
  "correction.error.linesChanged": "Lines can be corrected but not added or removed.",
  "correction.error.noChanges": "Nothing changed.",

  // Server action errors (app/(app)/claims/[id]/actions.ts)
  "action.error.forbiddenCorrect": "Your role can view claims but not correct them.",
  "action.error.reload": "Reload the page and try again.",

  // Charge import (app/(app)/claims/import, docs/specs/claims.md C2)
  "detail.history.createdByImport": "Created by charge import",
  "import.button": "Import charges",
  "import.title": "Import charges",
  "import.description":
    "Upload one CSV of charges and DenialDesk creates draft claims. If any row needs fixing, nothing is imported.",
  "import.breadcrumbClaims": "Claims",
  "import.forbidden": "Your role can view claims but not import charges.",
  "import.backToClaims": "Back to claims",
  "import.file.title": "Charge file",
  "import.file.description": "One CSV, up to {size} MB and {rows} rows. It is read once and never stored.",
  "import.file.label": "CSV file",
  "import.file.hint": "One row per claim line, with the columns listed below.",
  "import.defaults.title": "Provider and location",
  "import.defaults.description":
    "Used for claims whose rows have no Provider NPI or Location. A row that names its own provider or location keeps it.",
  "import.defaults.provider": "Default provider",
  "import.defaults.location": "Default location",
  "import.defaults.choose": "Choose",
  "import.synthetic.title": "Confirmation",
  "import.synthetic.description": "This environment accepts synthetic data only.",
  "import.synthetic.attestation":
    "I confirm this file holds synthetic data only. Claim numbers start with SYN- and MRNs start with SYN.",
  "import.submit": "Import charges",
  "import.submitting": "Importing…",
  "import.auditNote": "Every import and every claim it creates is recorded in the audit log.",
  "import.format.title": "File format",
  "import.format.description":
    "Rows with the same claim number are the lines of one claim; the claim-level columns repeat on every line and must match. Codes are stored exactly as written: the import never changes, adds, or fixes a code.",
  "import.format.column": "Column",
  "import.format.rule": "What goes in it",
  "import.format.required": "Required",
  "import.format.optional": "Optional",
  "import.format.template": "Download the template (header row only)",
  "import.format.tableCaption": "Columns of the charge file",
  "import.column.claimNumber":
    "Your practice's own claim or charge number: up to 30 letters, digits, dots, dashes, or underscores. Never a member ID.",
  "import.column.mrn":
    "Medical record number of a patient already in DenialDesk. The import never creates or changes patients.",
  "import.column.payer": "Payer name as it appears in this practice's payer list.",
  "import.column.serviceDate": "YYYY-MM-DD or M/D/YYYY, not in the future.",
  "import.column.diagnosisCodes": "1 to 12 ICD-10-CM codes separated by spaces or commas.",
  "import.column.procedureCode": "CPT or HCPCS code: five letters or digits.",
  "import.column.modifiers": "Up to four two-character modifiers.",
  "import.column.units": "Whole number from 1 to 999.",
  "import.column.charge": "Total charge for the line in dollars, from $0.01 to $99,999.99.",
  "import.column.providerNpi":
    "Ten-digit NPI of a provider in this practice. Blank uses the default provider.",
  "import.column.location": "Location name as it appears in this practice. Blank uses the default location.",

  // Upload checks and failures (returned by the import action)
  "import.error.chooseFile": "Choose a CSV file to import.",
  "import.error.notCsv": "The file must be a .csv file.",
  "import.error.tooLarge": "The file is larger than {size} MB.",
  "import.error.confirmSynthetic": "Confirm that the file holds synthetic data only.",
  "import.error.notUtf8": "The file isn't UTF-8 text. Save it as CSV (UTF-8) and try again.",
  "import.error.forbidden": "Your role can view claims but not import charges.",
  "import.error.defaults": "Choose a default provider and a default location from this practice.",
  "import.error.notImported": "Nothing was imported. Fix the rows below and upload the file again.",
  "import.error.conflict":
    "A claim with one of these numbers was created while the file was being read. Nothing was imported; try again.",

  // Problem report
  "import.problems.aria": "Rows to fix",
  "import.problems.row": "Row {row}: {message}",
  "import.problems.showing": "Showing the first {shown} of {total} problems.",
  "import.problems.download": "Download report (CSV)",
  "import.problems.truncated": "The report lists the first {limit} problems; {more} more were not listed.",

  // Problems (domain/claims/charge-file.ts PROBLEM_MESSAGE_KEYS); never quote a cell value
  "import.problem.noDataRows": "The file has a header but no charge rows.",
  "import.problem.missingColumns": "The header is missing required columns: {columns}.",
  "import.problem.ambiguousColumns": "More than one column matches: {columns}. Keep only one.",
  "import.problem.csvTooManyColumns": "A row has more than {max} columns.",
  "import.problem.csvTooManyRows": "The file has more than {max} rows.",
  "import.problem.csvTextAfterQuote": "Text follows a closing quote.",
  "import.problem.csvQuoteInField": "A quote appears inside an unquoted field.",
  "import.problem.csvUnclosedQuote": "A quoted field is never closed.",
  "import.problem.alreadyImported":
    "Every claim number in this file already exists, so this file looks like it was imported before.",
  "import.problem.tooLong": "{column} is longer than {max} characters.",
  "import.problem.claimNumberBlank": "Claim number is blank.",
  "import.problem.claimNumberFormat":
    "Claim number must be 1 to 30 letters, digits, dots, dashes, or underscores.",
  "import.problem.claimNumberNotSynthetic":
    "Claim number must start with {prefix} in this environment (synthetic data only).",
  "import.problem.mrnBlank": "MRN is blank.",
  "import.problem.mrnNotSynthetic": "MRN must start with {prefix} in this environment (synthetic data only).",
  "import.problem.payerBlank": "Payer is blank.",
  "import.problem.serviceDateInvalid": "Service date isn't a real date. Use YYYY-MM-DD or M/D/YYYY.",
  "import.problem.serviceDateTooOld": "Service date is before 2000-01-01.",
  "import.problem.serviceDateFuture": "Service date is in the future.",
  "import.problem.diagnosisBlank": "Diagnosis codes are blank.",
  "import.problem.diagnosisFormat":
    "A diagnosis code isn't in ICD-10-CM format (for example E11.9). Codes are never changed on import.",
  "import.problem.diagnosisTooMany": "More than {max} diagnosis codes.",
  "import.problem.procedureCodeFormat":
    "Procedure code must be five letters or digits (CPT/HCPCS). Codes are never changed on import.",
  "import.problem.modifierFormat": "A modifier must be two letters or digits.",
  "import.problem.modifierTooMany": "More than {max} modifiers.",
  "import.problem.unitsInvalid": "Units must be a whole number from 1 to 999.",
  "import.problem.chargeInvalid": "Charge isn't a valid dollar amount.",
  "import.problem.chargeRange": "Charge must be from $0.01 to $99,999.99 per line.",
  "import.problem.providerNpiFormat": "Provider NPI must be 10 digits.",
  "import.problem.claimFieldsDiffer":
    "{column} differs from the first line of this claim. Claim-level columns must match on every line.",
  "import.problem.tooManyLines": "A claim can have at most {max} lines.",
  "import.problem.patientNotFound":
    "No patient in this practice has this MRN. The import never creates patients.",
  "import.problem.payerNotFound": "No payer in this practice's payer list has this name.",
  "import.problem.payerAmbiguous": "Two payers have this name and can't be told apart.",
  "import.problem.providerNotFound": "No provider in this practice has this NPI.",
  "import.problem.locationNotFound": "No location in this practice has this name.",
  "import.problem.locationAmbiguous": "More than one location has this name.",
  "import.problem.claimNumberExists":
    "A claim with this number already exists. Correct existing claims from the claim page.",
  "import.problem.matchesExistingClaim":
    "An existing claim has the same patient, payer, date of service, and a procedure code with the same modifiers. Possible duplicate.",
  "import.problem.matchesClaimInFile":
    "Another claim in this file has the same patient, payer, date of service, and a procedure code with the same modifiers. Possible duplicate.",

  "import.problem.duplicateLine":
    "This line repeats an earlier line of the same claim (same procedure code and modifiers). If the file was pasted twice, remove the copy.",
  "import.problem.claimRowsNotContiguous":
    "The lines of one claim must be next to each other, but this claim number appears again after other claims.",
  "import.error.rateLimited":
    "Too many imports in a short time for this practice. Wait a few minutes and try again.",
  "import.file.claimNumberNotice":
    "The claim number is stored without field-level encryption. Never put a member ID, Social Security number, or any other identifier in it.",

  // Result
  "import.result.title": "Import complete",
  "import.result.summary":
    "{claims, plural, one {# draft claim} other {# draft claims}} created from {lines, plural, one {# line} other {# lines}}, {billed} billed.",
  "import.result.warningsTitle": "Worth a look",
  "import.result.noWarnings": "No warnings.",
  "import.result.pastDeadline":
    "{count, plural, one {# claim is past its filing deadline} other {# claims are past their filing deadline}}.",
  "import.result.dueSoon":
    "{count, plural, one {# claim is due within {days} days} other {# claims are due within {days} days}}.",
  "import.result.notConfigured":
    "{count, plural, one {# claim has no filing rule configured for its payer} other {# claims have no filing rule configured for their payer}}.",
  "import.result.payerUnverified":
    "{count, plural, one {# claim is for an unverified payer, so it can't be submitted yet} other {# claims are for unverified payers, so they can't be submitted yet}}.",
  "import.result.noCoverage":
    "{count, plural, one {# claim is for a patient with no coverage on file} other {# claims are for patients with no coverage on file}}.",
  "import.result.patientInactive":
    "{count, plural, one {# claim is for a patient marked inactive or merged in the source record} other {# claims are for patients marked inactive or merged in the source record}}.",
  "import.result.viewClaims": "View unsubmitted claims",
  "import.result.viewPastDeadline": "View past-deadline claims",
  "import.result.another": "Import another file",

  // 837P generation (claims C3a): app/(app)/claims/[id]/Claim837Form.tsx
  "edi.title": "Electronic claim (837P)",
  "edi.description":
    "Builds this claim as an X12 837P file that you can preview and download. Nothing is sent to a payer or a clearinghouse.",
  "edi.testNotice":
    "Test file only. This environment holds synthetic data only, so the file is marked as a test and uses placeholder submitter and receiver identifiers.",
  "edi.pointers.title": "Diagnosis pointers",
  "edi.pointers.description":
    "This claim has more than one diagnosis. For each line, choose the diagnoses that support it, up to four. Nothing is chosen for you.",
  "edi.pointers.line": "Line {line}: {code}",
  "edi.pointers.option": "{position}. {code}",
  "edi.generate": "Generate 837P",
  "edi.generating": "Generating…",
  "edi.result.summary":
    "File {controlNumber} generated: {segments} segments, {lines, plural, one {# service line} other {# service lines}}.",
  "edi.result.testFile": "Test file (ISA15 = T). It is not sent anywhere.",
  "edi.result.previewLabel": "837P preview with the member ID and tax ID masked",
  "edi.result.masked": "The member ID and tax ID are masked here. The downloaded file has them in full.",
  "edi.result.download": "Download file",
  "edi.result.pastDeadline":
    "This claim is past its filing deadline. Check the deadline panel before this file goes anywhere.",
  "edi.error.forbidden": "Your role can view claims but not generate claim files.",
  "edi.error.rateLimited": "Too many files were generated in a short time. Wait a few minutes and try again.",
  "edi.error.notFound": "This claim could not be found.",
  "edi.error.reload": "Reload the page and try again.",
  "edi.error.notGenerated": "The 837P was not generated. Fix the items below and try again.",
  "edi.issue.status_not_generatable": "Only draft or rejected claims can be generated.",
  "edi.issue.not_synthetic_environment":
    "Claim files can't be generated in production yet: the submitter and receiver identifiers for real submission are not set up.",
  "edi.issue.no_member_id": "No payer coverage is on file for this patient. Add or map the member ID first.",
  "edi.issue.coverage_payer_mismatch":
    "This claim's payer is not the patient's primary payer, the payer the member ID on file belongs to.",
  "edi.issue.payer_not_verified": "The payer has no verified EDI payer ID or regime yet.",
  "edi.issue.claim_filing_indicator_unmapped":
    "The claim filing indicator for this payer type is not confirmed yet, so a file can't be built.",
  "edi.issue.billing_npi": "The provider's NPI is missing or is not a valid NPI.",
  "edi.issue.billing_name": "The provider's first and last name for billing are missing.",
  "edi.issue.billing_taxonomy": "The provider's taxonomy code is missing or is not in the right format.",
  "edi.issue.billing_tin": "The provider's tax ID or its type is missing, or the tax ID is not nine digits.",
  "edi.issue.billing_address":
    "The provider's billing address is incomplete: it needs a street, city, state, and nine-digit ZIP code.",
  "edi.issue.billing_address_po_box": "The billing address must be a street address, not a P.O. box.",
  "edi.issue.subscriber_name": "The patient's first and last name are missing.",
  "edi.issue.subscriber_birth_date": "The patient's birth date is missing or is not a real date.",
  "edi.issue.subscriber_address":
    "The patient's address is incomplete: it needs a street, city, state, and ZIP code.",
  "edi.issue.missing_place_of_service": "The claim's location has no place of service code.",
  "edi.issue.diagnosis_invalid": "The claim needs one to twelve diagnosis codes in ICD-10-CM format.",
  "edi.issue.diagnosis_pointers_required": "Line {line}: choose which diagnoses support this line.",
  "edi.issue.diagnosis_pointer_invalid":
    "Line {line}: choose one to four different diagnoses from this claim.",
  "edi.issue.lines_missing": "The claim has no service lines.",
  "edi.issue.lines_too_many": "The claim has more than {max} service lines.",
  "edi.issue.line_invalid":
    "Line {line}: the procedure code, modifiers, units, or charge are not in the expected format.",
  "edi.issue.line_invalid_general": "The service lines have a repeated line number.",
  "edi.issue.billed_mismatch": "The billed amount is not the sum of the line charges.",
  "edi.issue.claim_number_invalid": "The claim number can't be used as the patient control number.",
  "edi.issue.service_date_invalid": "The date of service is not a real date.",
  "edi.issue.invalid_character": "The {field} has a character, or a length, that an 837P can't carry.",
  "edi.issue.control_number_exhausted": "The practice's control numbers are used up. Contact support.",
  "edi.field.billing_last_name": "provider's last name",
  "edi.field.billing_first_name": "provider's first name",
  "edi.field.billing_address": "provider's street address",
  "edi.field.billing_city": "provider's city",
  "edi.field.subscriber_last_name": "patient's last name",
  "edi.field.subscriber_first_name": "patient's first name",
  "edi.field.subscriber_address": "patient's street address",
  "edi.field.subscriber_city": "patient's city",
  "edi.field.subscriber_member_id": "member ID",
  "edi.field.payer_name": "payer's name",
  "edi.result.title": "Generated file",
  "edi.field.envelope_id": "sender or receiver ID",
} as const;
