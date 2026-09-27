/** Messages for the remittances pages. Flat keys, dotted for grouping; values are the English source text. */
export const remittances = {
  "nav.breadcrumb": "Breadcrumb",
  "list.stat.sectionLabel": "Remittance totals",

  // Remittance status, method, and CLP02 labels (domain/remittances/status.ts)
  "status.received": "Ready to post",
  "status.posted": "Posted",
  "status.void": "Void",
  "method.check": "Check",
  "method.eft": "EFT",
  "method.non_payment": "No payment",
  "clpStatus.1": "Processed as primary",
  "clpStatus.2": "Processed as secondary",
  "clpStatus.3": "Processed as tertiary",
  "clpStatus.4": "Denied",
  "clpStatus.19": "Primary, forwarded",
  "clpStatus.20": "Secondary, forwarded",
  "clpStatus.21": "Tertiary, forwarded",
  "clpStatus.22": "Reversal",
  "clpStatus.23": "Not our claim, forwarded",
  "clpStatus.25": "Predetermination only",
  "clpStatus.other": "Other",

  // Remittance list (app/(app)/remittances/page.tsx)
  "list.title": "Remittances",
  "list.description":
    "Payer payments from 835 remittance files. Check that a file balances, then post it to its claims.",
  "list.newRemittance": "New remittance",
  "list.stat.readyToPost": "Ready to post",
  "list.stat.readyDetail": "Loaded, not yet applied to claims",
  "list.stat.readyPaid": "Ready to post, paid",
  "list.stat.posted": "Posted",
  "list.stat.postedPaid": "Posted, paid",
  "list.filter.allPayers": "All payers",
  "list.empty.titleFiltered": "No remittances match these filters",
  "list.empty.title": "No remittances yet",
  "list.empty.description": "Upload an 835 remittance file from the payer or clearinghouse to see it here.",
  "list.table.traceNumber": "Trace number",
  "list.table.method": "Method",
  "list.table.paymentDate": "Payment date",
  "list.table.claims": "Claims",
  "list.table.paid": "Paid",

  // New remittance (app/(app)/remittances/new/page.tsx)
  "new.breadcrumbRemittances": "Remittances",
  "new.breadcrumbNew": "New",
  "new.title": "New remittance",
  "new.description":
    "Upload an 835 from the payer or clearinghouse. DenialDesk checks that it balances and matches your claims before anything is posted.",
  "new.backToRemittances": "Back to remittances",

  // Upload form (app/(app)/remittances/new/UploadRemittanceForm.tsx)
  "upload.fileLabel": "835 remittance file (one payment, up to 5 MB)",
  "upload.fileHint":
    "The payer must be set up with its EDI payer ID, and every claim in the file must already be in DenialDesk. Nothing changes on a claim until you post the remittance.",
  "upload.syntheticAttestation":
    "This file contains synthetic data only. Real remittances are not allowed in this environment.",
  "upload.submit": "Upload and check",
  "upload.checking": "Checking…",

  // Remittance detail (app/(app)/remittances/[id]/page.tsx)
  "detail.pageTitle": "Remittance",
  "detail.breadcrumbRemittances": "Remittances",
  "detail.totalPaid": "Total paid",
  "detail.payment.title": "Payment",
  "detail.field.ediId": "EDI {ediId}",
  "detail.field.method": "Method",
  "detail.field.traceNumber": "Trace number",
  "detail.field.paymentDate": "Payment date",
  "detail.field.claimsPaid": "Claims paid",
  "detail.field.providerAdjustments": "Provider adjustments",
  "detail.field.balanceCheck": "Balance check",
  "detail.field.loadedBy": "Loaded by",
  "detail.balances": "Balances",
  "detail.doesNotBalance": "Does not balance",
  "detail.claimPayments.title": "Claim payments",
  "detail.claimPayments.description": "One row per claim on this remittance (835 CLP loop).",
  "detail.table.payerStatus": "Payer status",
  "detail.table.charge": "Charge",
  "detail.table.paid": "Paid",
  "detail.table.patientOwes": "Patient owes",
  "detail.table.adjustments": "Adjustments",
  "detail.icn": "ICN {number}",
  "detail.formerTeamMember": "Former team member",
  "detail.system": "System",
  "detail.actions.title": "Actions",
  "detail.actions.forbidden": "Your role can view remittances but not post them.",
  "detail.denialsCaptured.title": "Denials captured",
  "detail.denialsCaptured.description":
    "Added to the denial queue when this remittance was posted. Categories come from DenialDesk's own code mapping, pending review.",
  "detail.history.title": "History",
  "detail.history.listLabel": "Remittance history",
  "error.fileFormat": "The 835 file couldn't be read: {detail}",
  "detail.history.description":
    "Every change to this remittance: who, when, and why. History can't be edited.",
  "event.received": "Loaded",
  "event.posted": "Posted",
  "event.void": "Voided",

  // Post / void actions (app/(app)/remittances/[id]/RemittanceActions.tsx)
  "actions.postExplain":
    "Posting updates each claim's paid amount and status (a new claim version) and records the payment or denial on its prompt-pay clock. It can't be undone here.",
  "actions.postSubmit": "Post payments",
  "actions.posting": "Posting…",
  "actions.notBalanced": "This file doesn't balance, so it can't be posted.",
  "actions.voidPrompt": "Why is this remittance being voided?",
  "actions.voidSubmit": "Void remittance",
  "actions.voiding": "Voiding…",
  "actions.voidButton": "Void…",

  // Server action errors and results (app/(app)/remittances/actions.ts)
  "action.error.forbiddenUpload": "Your role can view remittances but not load them.",
  "action.error.forbiddenPost": "Your role can view remittances but not post them.",
  "action.error.forbiddenVoid": "Only administrators and managers can void a remittance.",
  "action.error.chooseFile": "Choose an 835 file to upload.",
  "action.error.fileTooLarge": "The file is larger than 5 MB. Upload one remittance per file.",
  "action.error.confirmSynthetic": "Confirm that the file contains synthetic data only.",
  "action.error.notPlainText": "The file isn't plain text. Upload the 835 exactly as the payer sent it.",
  "action.error.reload": "Reload the page and try again.",
  "action.done.postedNoDenials": "Posted to {count, plural, one {# claim} other {# claims}}.",
  "action.done.postedWithDenials":
    "Posted to {claims, plural, one {# claim} other {# claims}}; {denials, plural, one {# denial} other {# denials}} added to the queue.",
  "action.done.voided": "Voided.",

  // Remittance domain errors (domain/remittances/records.ts RemittanceError)
  "error.andMore": "{shown} and {count} more",
  "error.noPayerId":
    "The file doesn't identify the payer (N1*PR payer ID). Ask the payer for a corrected file.",
  "error.duplicatePayerId":
    "More than one payer has EDI payer ID {ediPayerId}. Fix the payer setup, then upload again.",
  "error.unknownPayerId":
    "No payer in this practice has EDI payer ID {ediPayerId}. Add the payer first, then upload again.",
  "error.emptyReversals": "Reversals must take back a payment: {claims} reverse $0.",
  "error.badReversals":
    "Negative payments must be reversals (CLP02 22) and reversals must be negative: {claims}.",
  "error.duplicateClaims": "Claims appear more than once in this file: {claims}.",
  "error.duplicateTrace": "Trace number {traceNumber} from this payer is already on file.",
  "error.noMatchingClaims": "No claim to this payer matches {claims}. Nothing was loaded.",
  "error.notPayable": "These claims are draft, rejected, or closed and can't take a payment: {claims}.",
  "error.notFound": "Remittance not found.",
  "error.alreadyVoid": "This remittance is already void.",
  "error.alreadyPosted": "This remittance is already posted.",
  "error.notBalanced": "This remittance doesn't balance, so it can't be posted.",
  "error.payerUnavailable": "The payer on this remittance is no longer available.",
  "error.claimUnavailable": "A claim on this remittance is no longer available.",
  "error.claimNotPayable": "Claim {claimNumber} is {status} and can't take a payment.",
  "error.reversalExceedsPaid":
    "Claim {claimNumber}: the reversal takes back more than was paid. Nothing was posted.",
  "error.voidReasonRequired": "Say why this remittance is being voided.",
  "error.reasonTooLong": "Keep the reason under {max} characters.",
  "error.onlyUnposted": "Only a remittance that hasn't been posted can be voided.",
  "error.reversalMismatch":
    "A reversal on this remittance doesn't match an earlier payment of the same amount. Post it by hand after checking with the payer.",
} as const;
