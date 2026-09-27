/** Messages for the prompt-pay pages. Flat keys, dotted for grouping; values are the English source text. */
export const promptPay = {
  "nav.breadcrumb": "Breadcrumb",
  "list.stat.sectionLabel": "Prompt-pay totals",

  // Clock and response-kind labels (domain/prompt-pay/clock.ts)
  "clockState.open": "Open",
  "clockState.met": "Met",
  "clockState.late": "Payer late",
  "clockState.uncontestable": "Uncontestable",
  "responseKind.payment": "Payment",
  "responseKind.denial": "Denial",
  "responseKind.contest": "Contest or request for information",

  // Milestone states (app/(app)/prompt-pay/[claimId]/page.tsx MILESTONE_STATES)
  "milestoneState.met": "Met",
  "milestoneState.late": "Met late",
  "milestoneState.open": "Open",
  "milestoneState.overdue": "Missed",

  // Table headers shared across the list and detail pages
  "table.received": "Received",
  "table.clockDay": "Clock day",
  "table.nextMilestone": "Next milestone",
  "table.paid": "Paid",
  "table.interest": "Interest",
  "table.state": "State",
  "table.milestone": "Milestone",
  "table.due": "Due",
  "table.metOn": "Met on",
  "table.daysLate": "Days late",
  "table.paymentDate": "Payment date",
  "table.dueDate": "Due date",
  "table.rate": "Rate",

  // Prompt-pay list (app/(app)/prompt-pay/page.tsx)
  "list.title": "Prompt pay",
  "list.description":
    "Florida prompt-pay clocks from the payer's receipt date: what the payer owes and when, missed milestones, and interest.",
  "list.stat.open": "Open clocks",
  "list.stat.openDetail": "Awaiting payment or denial",
  "list.dueSoonLabel": "Due in {days} days",
  "list.stat.dueSoonDetail": "Next payer milestone",
  "list.stat.late": "Payer late",
  "list.stat.lateDetail": "Missed a milestone",
  "list.stat.uncontestable": "Uncontestable",
  "list.stat.uncontestableDetail": "Not paid or denied in time",
  "list.stat.interestOwed": "Interest owed",
  "list.stat.interestDetail": "On late payments",
  "list.filter.clock": "Clock",
  "list.filter.allPayers": "All payers",
  "list.truncated":
    "More than {limit} received claims: the list and totals cover the most recently received ones only.",
  "list.empty.titleFiltered": "No clocks match these filters",
  "list.empty.title": "No prompt-pay clocks",
  "list.empty.description":
    "A clock starts when a payer covered by Florida prompt pay confirms it received a claim.",
  "list.table.electronic": "Electronic",
  "list.table.paper": "Paper",
  "list.table.day": "Day {day}",
  "list.table.dayAlert": "Day {day} alert",
  "list.footnote":
    "Milestones and the interest rate come from the rules engine and are pending Florida counsel verification. Alert days ({days}) are a practice setting.",

  // Prompt-pay clock detail (app/(app)/prompt-pay/[claimId]/page.tsx)
  "detail.pageTitle": "Prompt-pay clock",
  "detail.breadcrumbPromptPay": "Prompt pay",
  "detail.kind.electronic": "electronic",
  "detail.kind.paper": "paper",
  "detail.claimLabel": "{kind} claim",
  "detail.received": "received {date}",
  "detail.day": "day {day}",
  "detail.openClaim": "Open claim",
  "detail.recordContest": "Record contest",
  "detail.noRegime":
    "This payer's regulatory regime hasn't been verified, so DenialDesk doesn't run a prompt-pay clock for it. An administrator can verify the payer.",
  "detail.notCovered": "Florida prompt pay doesn't cover {regime} claims, so this claim has no clock.",
  "detail.notReceived":
    "The payer hasn't confirmed receipt of this claim, so its prompt-pay clock hasn't started.",
  "detail.uncontestableAlert":
    "The payer neither paid nor denied this claim by the uncontestable milestone. Payment may now be an uncontestable obligation (R-3.1.4). Confirm with counsel before sending a demand.",
  "detail.milestones.title": "Milestones",
  "detail.milestones.caption": "Prompt-pay milestones",
  "detail.milestones.description": "Counted in calendar days from the payer's receipt date.",
  "detail.milestones.pendingVerification": "Pending counsel verification",
  "detail.interest.title": "Interest worksheet",
  "detail.interest.description": "Simple interest on each payment made after payment was due (R-3.1.3).",
  "detail.interest.noneWithDue": "No late payments. Payment is due by {date}.",
  "detail.interest.noneNoDue": "No payments yet.",
  "detail.interest.totalOwed": "Total interest owed",
  "detail.interest.ratePerYear": "{rate}% / yr",
  "detail.interest.footnote":
    "Interest starts the day after payment was due (the pay-or-contest date, or the pay-or-deny date once the payer contests). Pending counsel verification.",
  "detail.claim.title": "Claim",
  "detail.claim.billedPaid": "Billed / paid",
  "detail.claim.contestResponseDue": "Your response to the contest is due",
  "detail.responses.title": "Payer responses",
  "detail.responses.description": "Every response on this clock. Entries are never edited or deleted.",
  "detail.responses.none": "No payment, denial, or contest recorded yet.",
  "detail.responses.recordedInError": "Recorded in error: ",
  "detail.responses.fromRemittance": "From remittance",
  "detail.responses.formerTeamMember": "Former team member",
  "detail.responses.system": "System",

  // Void (recorded in error) form (app/(app)/prompt-pay/[claimId]/VoidResponseForm.tsx)
  "void.button": "Recorded in error…",
  "void.prompt": "Why is this entry wrong?",
  "void.submit": "Mark in error",
  "void.saving": "Saving…",

  // New contest page and form
  "newContest.title": "Record payer contest",
  "newContest.description":
    "The payer contested this claim or asked for more information. This meets the pay-or-contest milestone only; the pay-or-deny clock keeps running.",
  "newContest.breadcrumbRecordContest": "Record contest",
  "contestForm.dateLabel": "Date on the payer's notice",
  "contestForm.dateHint": "The date the payer contested the claim or asked for information.",
  "contestForm.noteLabel": "What did the payer ask for?",
  "contestForm.submit": "Record contest",
  "contestForm.saving": "Saving…",

  // Server action errors and results (app/(app)/prompt-pay/actions.ts)
  "action.error.forbiddenRecord": "Your role can view prompt-pay clocks but not record responses.",
  "action.error.forbiddenChange": "Your role can view prompt-pay clocks but not change them.",
  "action.error.reload": "Reload the page and try again.",
  "action.error.invalidDate": "Enter the date on the payer's notice.",
  "action.done.voided": "Marked as recorded in error.",

  // Prompt-pay domain errors (domain/prompt-pay/responses.ts PromptPayError)
  "error.sayWhatPayerAsked": "Say what the payer asked for.",
  "error.sayWhyWrong": "Say why this entry is wrong.",
  "error.noteTooLong": "Keep it under {max} characters.",
  "error.claimNotFound": "Claim not found.",
  "error.notReceived": "The payer hasn't received this claim yet.",
  "error.noticeBeforeReceived": "The payer's notice can't be dated before the payer received the claim.",
  "error.noticeInFuture": "The notice date can't be in the future.",
  "error.entryNotFound": "Entry not found.",
  "error.notVoidable": "Payments and denials come from remittances and can't be marked in error here.",
  "error.alreadyVoided": "This entry is already marked as recorded in error.",
} as const;
