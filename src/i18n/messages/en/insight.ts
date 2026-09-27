/**
 * Messages for the Insight module: the report list, each report's page, and the .xlsx exports
 * (sheet names, column headers, and the About sheet). Flat keys, dotted for grouping; values are
 * the English source text. Shared words and domain labels (denial categories, claim statuses,
 * roles) live in `common` instead and are read with `tc(...)`.
 */
export const insight = {
  // The module's own name, reused as the page title and as a fallback report title.
  moduleName: "Insight",
  "meta.listTitle": "Insight — reports",

  // Report list page
  "list.description":
    "Standard reports on denial trends, recovery, and payer performance, computed from your practice's own claims and denials.",
  "list.downloadAll": "Download all reports (Excel)",
  "list.open": "Open",

  // Report catalog: names and one-line purposes (docs/specs/insight-standard-reports.md)
  "catalog.denialsByCategory.title": "Denial summary by category and CARC",
  "catalog.denialsByCategory.purpose": "Where denial dollars and volume concentrate, by root cause.",
  "catalog.denialsByPayer.title": "Denial summary by payer",
  "catalog.denialsByPayer.purpose":
    "Which payers generate the most denial dollars and volume, and their top category.",
  "catalog.denialRate.title": "Denial rate",
  "catalog.denialRate.purpose": "The share of billed claims that received at least one denial.",
  "catalog.denialsByDeadlineBucket.title": "Open denials by appeal-deadline bucket",
  "catalog.denialsByDeadlineBucket.purpose": "A report-form total of what the denial queue already sorts by.",
  "catalog.claimsByStatus.title": "Claims by status / A/R summary",
  "catalog.claimsByStatus.purpose":
    "How much is outstanding and in what state, from the claims table itself.",
  "catalog.appealOutcomes.title": "Appeal outcomes",
  "catalog.appealOutcomes.purpose": "Overturn vs. upheld rates by payer and category.",
  "catalog.promptPayScorecard.title": "Prompt-pay scorecard",
  "catalog.promptPayScorecard.purpose":
    "Planned — see spec (blocked on notice-classification fix, billing review F4).",
  "catalog.underpaymentVariance.title": "Underpayment variance",
  "catalog.underpaymentVariance.purpose":
    "Planned — see spec (blocked on a payer_contracts / fee-schedule table).",

  // Report detail page
  "report.noDataTitle": "No data for this range",
  "report.noDataDescription": "Try a wider date range or a different payer.",
  "report.noRowsMatch": "No rows match the current filters.",
  "report.downloadExcel": "Download Excel",
  "report.exportRestrictedRoles": "Exporting this report is limited to {admin}, {manager}, and {compliance}.",

  // Filters (report detail page and export forms)
  "filters.from": "From",
  "filters.to": "To",
  "filters.allPayers": "All payers",
  "filters.selectedPayer": "Selected payer",
  "filters.payerNotApplicable": "Payer filter is not applicable — this report is the payer breakdown.",
  "filters.dateRange": "Date range: {from} to {to}",
  "filters.payerLine": "Payer: {payer}",
  "filters.error.invalidStartDate": "That start date doesn't exist.",
  "filters.error.invalidEndDate": "That end date doesn't exist.",
  "filters.error.endBeforeStart": "The end date must be on or after the start date.",
  "filters.error.rangeTooLong": "The date range cannot be more than 3 years.",

  // Route errors (plain-text bodies of the export POST endpoints)
  "error.forbidden": "Forbidden",
  "error.notFound": "Not found",

  // Small-cell suppression (R-8.7): the marker shown in place of a suppressed value
  "suppression.label": "Suppressed (<{threshold})",

  // Column headers shared by the on-screen tables and the .xlsx sheets
  "columns.carc": "CARC",
  "columns.count": "Count",
  "columns.deniedAmount": "Denied ($)",
  "columns.averageDeniedAmount": "Average denied ($)",
  "columns.verified": "Verified",
  "columns.topCategory": "Top category",
  "columns.claimsSubmittedInRange": "Claims submitted in range",
  "columns.claimsWithDenial": "Claims with a denial (by notice date)",
  "columns.denialRate": "Denial rate",
  "columns.deadlineBucket": "Bucket",
  "columns.billedAmount": "Billed ($)",
  "columns.paidAmount": "Paid ($)",
  "columns.outstandingAmount": "Outstanding ($)",
  "columns.group": "Group",
  "columns.overturned": "Overturned",
  "columns.upheld": "Upheld",
  "columns.overturnRate": "Overturn rate",
  "columns.deniedAmountReversed": "Denied amount reversed ($)",

  // Cell values
  "value.verified": "Verified",
  "value.unverified": "Unverified",

  // Sheet / table names (Excel sheet names: keep every language's value at or under 31 characters)
  "sheet.denialsByCategory": "Denials by category",
  "sheet.denialsByPayer": "Denials by payer",
  "sheet.denialRate": "Denial rate",
  "sheet.denialsByDeadlineBucket": "Open denials by deadline",
  "sheet.claimsByStatus": "Claims by status",
  "sheet.appealOutcomesByPayer": "Appeal outcomes by payer",
  "sheet.appealOutcomesByCategory": "Appeal outcomes by category",

  // Appeal-deadline buckets (report #4)
  "bucket.pastDeadline": "Past deadline",
  "bucket.0to7": "0–7 days",
  "bucket.8to30": "8–30 days",
  "bucket.31plus": "31+ days",
  "bucket.noDeadline": "No deadline configured",

  // Empty-sheet messages
  "empty.noClaimsSubmitted": "No claims submitted in this period",
  "empty.noDecidedAppeals": "No decided appeals in this period",

  // Metric definitions shown on the About sheet (the "term" reuses the matching column-header key)
  "definitions.category": "DenialDesk's work-queue classification for the denial's CARC (REQUIREMENTS §8.3).",
  "definitions.deniedAmount": "Sum of the denied amount (denials.deniedCents) for the group.",
  "definitions.averageDeniedAmount": "Denied ($) divided by count, for the group.",
  "definitions.verified": "Whether the payer has a confirmed EDI payer ID and regulatory regime.",
  "definitions.topCategory":
    "The category with the largest sum of denied dollars for that payer; ties broken by category enum order.",
  "definitions.claimsSubmittedInRange":
    "Claims with status other than draft, whose submission date (or service date, if not yet submitted) falls in the selected range.",
  "definitions.denialRate":
    "Distinct claims with at least one denial in range, divided by distinct claims submitted in range.",
  "definitions.deadlineBucket":
    "Days remaining to the appeal deadline, computed the same way as the denial queue (rules/deadlines.ts); never re-derived.",
  "definitions.noDeadlineConfigured":
    "The payer is unverified or has no configured appeal window; never guessed.",
  "definitions.outstandingAmount": "Billed ($) minus paid ($) for the group.",
  "definitions.overturnRate":
    "Overturned divided by (overturned + upheld) for the group; blank when there are no decided appeals in range.",
  "definitions.deniedAmountReversed":
    "Sum of denied dollars on overturned rows only — an upper bound, not a captured payment (no remittances table yet).",

  // Data caveats shown on the About sheet, per report
  "caveats.unknownCarc":
    "A CARC code outside the reference list (src/domain/carc.ts) is shown by its raw code with no description.",
  "caveats.payerFilterNotApplicable":
    "The payer filter is not applicable to this report — it is the payer breakdown.",
  "caveats.denialRateFallback":
    "Submission-date tracking (C3 837P) is not yet built; falls back to service date when submittedAt is null.",
  "caveats.noDeadlineConfiguredExplain":
    '"No deadline configured" includes unverified payers and payers with no configured appeal window.',
  "caveats.paidAmountsPartial":
    "Paid amounts are recorded only where captured — 835 remittance posting is not yet built.",
  "caveats.latestOutcomeOnly":
    "Reports on current denial status only; there is no appeals history table yet, so a denial that flipped status is shown by its latest outcome.",
  "caveats.smallCellSuppression":
    "Small-cell suppression (R-8.7): a row that includes a claim for a patient carrying a sensitivity tag (R-3.5.1) and whose count is under the suppression threshold shows \"Suppressed (<{threshold})\" instead of its count and dollar amounts/rates, to avoid identifying that patient. When exactly one row in the sheet would be suppressed, the next-smallest row with a nonzero count is also suppressed so the hidden value can't be inferred from the others. Whenever any row in a sheet is suppressed, that sheet's own totals row is suppressed too — otherwise Total minus the visible rows would reconstruct the hidden value(s) exactly. Accepted residual risk (⚠️ VERIFY with counsel): this suppression is per report and per date range — comparing two overlapping date ranges of the same report, or two different reports covering the same claims, can still let a determined reader difference out a suppressed cell; no cross-report or cross-range differencing guard exists in this slice. ⚠️ VERIFY: the threshold ({threshold}) follows CMS's public-use-file cell-size suppression convention as a policy baseline, not a Florida statute — confirm with counsel.",
  "caveats.denialRateResidualRisk":
    "This report is one tenant-wide rate for the whole date range, not a row-by-row breakdown, so small-cell suppression (R-8.7) does not apply to it the same way. Accepted residual risk (⚠️ VERIFY with counsel): the denied-claims count is a tenant-wide total, not suppressed even when small, and a narrow enough date range or payer filter could still make it identify a single sensitive-tagged patient's claim.",

  // About sheet chrome
  "about.sheetName": "About",
  "about.practice": "Practice",
  "about.generatedAt": "Generated at",
  "about.generatedBy": "Generated by (user ID)",
  "about.filtersApplied": "Filters applied",
  "about.definitionsHeading": "Definitions",
  "about.caveatsHeading": "Data caveats",
  "about.confidentiality": "Contains confidential practice data; handle per your practice's policy.",
  "about.allReportsName": "All Insight reports",
  "about.combinedPayerFilterCaveat":
    "The payer filter was applied where each report supports one; denials-by-payer always shows every payer.",
} as const;
