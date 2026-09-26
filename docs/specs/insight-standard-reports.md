# Spec: Insight — standard reports

Status: approved

## Owner decisions (2026-09-26)

The open questions below are resolved by the owner as follows; the spec text further down is kept
as the historical record of the question, and this section is the answer of record:

- **Role access for CSV/Excel export:** the proposed default is confirmed. `admin`, `manager`, and
  `compliance` can view and export every available report; `specialist` can view on-screen but
  cannot export.
- **All roles can view.** Every signed-in practice role (`admin`, `manager`, `specialist`,
  `compliance`) can open `/insight` and run any available report on-screen.
- **Aggregate-only, no drill-down**, is confirmed for this slice.
- **Report #6 (appeal outcomes)** keeps `noticeDate` as its date-range anchor, for consistency with
  the other denial reports.
- **Report #5 and `/revenue-cycle/ar-aging` are both kept**, clearly labeled as two different views
  of "how much is outstanding" (one from `claims`, one from the imported PM file), until the two
  halves of the product are linked.
- **Primary export format is a formatted Excel workbook (.xlsx), not CSV.** The owner's direction:
  "these reports must be well crafted in an Excel spreadsheet, not a dashboard that is not
  exportable, because business people need to export the data." Each report's workbook has an
  "About" cover sheet (report name, practice name, filters applied, generated-at timestamp,
  generated-by **user ID**, metric definitions, and data caveats such as planned/blocked items and
  seed-only fields) followed by one or more data sheets with a bold frozen header row, autofilter,
  sensible column widths, real numeric cells (money as numbers with currency format, converted from
  cents to dollars only at write time; percentages as numeric percent format; dates as real date
  cells), a totals row where meaningful, no merged cells in the data area, and formula-injection
  sanitization on any text cell that could be misread as a formula (`=`, `+`, `-`, `@`). An
  "All reports" workbook is also offered, with one sheet per report plus its own cover sheet. CSV
  export is dropped in favor of .xlsx as the one export format for this slice — a single
  well-formatted artifact is simpler to build and test correctly than two, and the owner's ask is
  specifically for a spreadsheet business people can open directly in Excel, not a raw CSV. If a
  future integration needs machine-readable CSV, it can be added later without changing the report
  calculations. Export is a `POST` (filters in the body, never in the URL/filename — no PHI in
  either), and is audited as `insight.report_exported` with `format: "xlsx"`.
- **Dependency:** no existing dependency in this repo builds formatted spreadsheets. `exceljs`
  (npm, MIT license, `github.com/exceljs/exceljs`, actively maintained) is added for server-side
  workbook generation; see the PR for the dependency note (CLAUDE.md #10 / R-15.7). Generation is
  server-side only; the route streams/returns the workbook buffer with
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and a
  `Content-Disposition: attachment; filename="…"` header built only from the report id and the
  (non-PHI) date range.
Roadmap item: Phase 2 — "Reporting: A/R aging, denial rate, prompt-pay scorecard, underpayment
variance [§8.7]" (`docs/ROADMAP.md`); brought forward by owner request 2026-09-26 ("start working
on the Insight module, specifically reports; pull reports from the different tables and build a
set of standard reports").
Requirement IDs: §8.7 (A/R aging, clean-claim rate, first-pass resolution rate, denial rate, days
in A/R, net collection rate, prompt-pay scorecard, underpayment variance, compliance reports),
R-3.1.1–R-3.1.4 (prompt-pay clock/uncontestable, read only, no new clock logic), R-5.1.2
(minimum-necessary role design), R-7.5.1 (audit every PHI view/export), R-7.5.4 (export controls),
R-7.4.8 (no PHI in URLs/logs).

## Goal
A signed-in practice user with the right role can open `/insight`, see a list of STANDARD
(fixed, pre-built) reports the practice can run today, run one with a date range and payer
filter, see it as an on-screen aggregate table, and export it to CSV — all computed from data
that already exists in `claims`, `denials`, `payers`, and the revenue-cycle tables. Insight
becomes a real module (its "Reports" nav item flips from "planned" to a working page). Building
a *custom* report (user-chosen columns/grouping) is a later slice and is explicitly out of scope
here.

## User stories
- As an RCM manager, I can see denial volume and dollars by CARC/category and by payer for a
  date range, so I know where to focus follow-up staff.
- As an RCM manager, I can see the practice's denial rate over a period, so I can track it
  against a target.
- As a biller, I can see open denials grouped by days-to-appeal-deadline, so I can work the
  most time-sensitive ones first (this duplicates the queue's own sort but as a report total,
  not a replacement for the queue).
- As an RCM manager, I can see claims by status and an A/R aging summary, so I know how much is
  outstanding and how old it is.
- As a compliance officer or RCM manager, I can export any standard report to CSV for a board
  packet or an OIR complaint, and that export is audited.
- As a practice administrator, I can see which reports are "available now" vs. "planned" (data
  not captured yet), so I know what to expect from the product today.

## Report catalog (this slice)

All reports are **tenant-scoped aggregates only**. None of them display or export a patient
name, MRN, member ID, or any other Restricted PHI field (REQUIREMENTS §9.1) — see "PHI posture"
below for why aggregate-only was chosen for this slice.

Money throughout is stored and computed in integer cents (`cents()` columns in
`src/db/schema.ts`) and only converted to dollars for display/export, matching the convention in
`src/lib/format.ts` and `src/domain/revenue-cycle/*`.

Common filters on every report unless noted: date range (inclusive, defaults to last 90 days),
payer (single-select from the tenant's `payers`, optional — "All payers" default). Filters are
carried as **non-PHI query params** (report id, ISO date range, payer UUID) or as a POST body;
never a patient name, MRN, or free-text search term in the URL (R-7.4.8). Because these are
tenant-scoped aggregate reports (not a patient search), GET with non-PHI query params is
acceptable per the existing pattern used by `/claims` and `/denials` list filters; POST is used
only for CSV export to keep filter state out of browser history/analytics for the export action.

### 1. Denial summary by category and CARC
- **Purpose:** where denial dollars and volume concentrate, by root cause.
- **Source:** `denials` (`category`, `carc`, `deniedCents`, `noticeDate`, `groupCode`) joined to
  `claims` (`payerId`) for the payer filter.
- **Grouping:** by `category` (the 11-value enum, §8.3), then by `carc` within category.
- **Calculation:** count of denials, sum of `deniedCents`, average `deniedCents` per denial, per
  group. Rows ordered by sum of `deniedCents` descending.
- **Filters:** date range on `noticeDate`; payer via the claim's `payerId`.
- **Edge cases:** a `carc` value not in the reference list (`src/domain/carc.ts`, ⚠️ VERIFY) is
  still shown by its raw code with no description rather than dropped or mislabeled. Zero denials
  in range renders an empty state, not a divide-by-zero average.

### 2. Denial summary by payer
- **Purpose:** which payers generate the most denial dollars and volume, and their top category.
- **Source:** `denials` joined to `claims.payerId` joined to `payers.name`.
- **Grouping:** by payer.
- **Calculation:** count of denials, sum of `deniedCents`, and the single largest `category` by
  sum of `deniedCents` within that payer (ties broken by category enum order, stated in the
  column footnote).
- **Filters:** date range on `noticeDate`. (No payer filter here — the report *is* the payer
  breakdown; selecting a single payer would just show one row, so the payer filter is disabled
  for this report and the UI says why.)
- **Edge cases:** a claim whose payer is "unverified" (`payers.regime` or `ediPayerId` null,
  `specs/payer-catalog.md`) is grouped under its payer name with an "unverified" badge, never
  hidden or merged into another payer's row.

### 3. Denial rate
- **Purpose:** the §8.7 "denial rate" KPI — the share of billed claims that received at least
  one denial.
- **Source:** `claims` (`id`, `status`, `createdAt`/`serviceDate`) and `denials` (`claimId`,
  distinct).
- **Calculation:** `denial rate = (distinct claims with ≥1 denial in range) / (distinct claims
  submitted in range)`. "Submitted in range" = `claims.status <> 'draft'` and `submittedAt`
  within the date range (falls back to `serviceDate` for claims with no `submittedAt` yet, with
  a footnote, since C3 837P submission tracking isn't built — `docs/reviews/
  2026-09-26-billing-structure-review.md` §2 row 6). A denial counts toward the numerator by its
  own `noticeDate`, which may fall after the claim's submission range boundary; the report labels
  the metric "denial rate for claims submitted in range" (not "denials received in range") so the
  two date fields are never conflated.
- **Filters:** date range (on claim submission, as above); payer via `claims.payerId`.
- **Edge cases:** denominator of zero (no claims submitted in range) shows "No claims submitted
  in this period" instead of a rate. A claim denied more than once counts once in the numerator
  (distinct claim IDs).

### 4. Open denials by appeal-deadline bucket
- **Purpose:** a report-form total of what the denial queue already sorts by, so a manager gets
  the aggregate without opening the queue.
- **Source:** `denials` where `status` is not a terminal status (`overturned`, `upheld`,
  `written_off`, `closed` — same `OPEN_STATUSES` list the queue and patient chart already use,
  per the review's note that "amount at risk" is computed consistently there).
- **Grouping:** bucket by days remaining to `appealDeadline`, computed the same way the queue
  computes it (`src/lib/deadline.ts` / `rules/deadlines.ts` — never re-derived or hard-coded in
  the report): "Past deadline" (negative days), "0–7 days", "8–30 days", "31+ days", and a
  distinct "No deadline configured" bucket for `appealDeadline IS NULL` (unverified payer or no
  contract window — never guessed, matching the fix for review finding F3).
- **Calculation:** count and sum of `deniedCents` per bucket.
- **Filters:** date range on `noticeDate`; payer via `claims.payerId`.
- **Edge cases:** "No deadline configured" is always shown, even at zero, so the report never
  silently implies every open denial has a deadline.

### 5. Claims by status / A/R summary
- **Purpose:** how much is outstanding and in what state, from the `claims` table itself (not
  the separate revenue-cycle A/R aging, which reports from the imported PM file and already
  exists at `/revenue-cycle/ar-aging`).
- **Source:** `claims` (`status`, `billedCents`, `paidCents`, `serviceDate`).
- **Grouping:** by `status` (8-value enum).
- **Calculation:** count of claims, sum of `billedCents`, sum of `paidCents`, sum of
  `billedCents − paidCents` ("outstanding") per status. This is **not** a bucketed aging report
  (30/60/90) — the existing `/revenue-cycle/ar-aging` page already does payer-class aging from
  the PM file; duplicating true days-outstanding aging from `claims` needs a reliable "money
  owed since when" anchor per claim status, which the review flags as unresolved (no DB
  invariant on `paidCents`, `billing-structure-review.md` §2.1 item 5). This report is filed as
  the "claims by status" report; a `claims`-sourced aging-by-payer report is listed as **planned**
  below pending that invariant.
- **Filters:** date range on `serviceDate`; payer via `payerId`.
- **Edge cases:** `paidCents` is seed-only today (`billing-structure-review.md` §2 row 10); the
  report footer states "Paid amounts are recorded only where captured (835 posting not yet
  built)" so the outstanding total is not read as a certified balance.

### 6. Appeal outcomes
- **Purpose:** the §8.4 "tracking of appeal outcomes and overturn rates".
- **Source:** `denials` where `status` in (`overturned`, `upheld`) or has ever passed through
  `appeal_submitted` (this slice reports on **current status only** — `overturned` vs. `upheld`
  vs. still open — since there is no `appeals` history table yet; a denial that flips back and
  forth, per review finding F5, is reported by its current status, not a full history).
- **Grouping:** by payer, and by category.
- **Calculation:** overturn rate = `overturned / (overturned + upheld)` per group, plus counts
  and sum of `deniedCents` recovered (i.e., `deniedCents` on `overturned` rows — this is an upper
  bound, not a captured payment, since there is no `remittances` table yet; the column is labeled
  "denied amount reversed by appeal outcome," not "dollars recovered").
- **Filters:** date range on `noticeDate` (or `updatedAt` for the outcome — this report uses
  `noticeDate` for consistency with the other denial reports; a future outcome-dated version is
  a candidate for the custom-report slice); payer.
- **Edge cases:** zero `overturned + upheld` in range → "No decided appeals in this period," no
  rate shown.

### 7. Prompt-pay scorecard — planned, not in this slice
- **Purpose:** §8.7 "payer prompt-pay compliance scorecard."
- **Why planned:** the review (`billing-structure-review.md` §4.1) found the pay-or-contest (20
  day), pay-or-deny (90 day), and uncontestable (120 day) milestones are computed only from the
  denial's own notice, with no reliable notice-classification (payment vs. denial vs. contest) or
  claim-level "was this claim paid on time with no denial at all" signal, and F4 is an open,
  unfixed bug in that same logic. Building a scorecard on top of an admittedly wrong milestone
  read would misstate payer compliance — exactly the OIR-complaint use case this report exists
  for. **Missing dependency:** F4 fix (notice classification) plus a decision on which CARC/RARC
  combinations count as a "contest" (cited, not invented, per CLAUDE.md #9).

### 8. Underpayment variance — planned, not in this slice
- **Purpose:** §8.7 "underpayment variance report vs. contract."
- **Why planned:** there is no `payer_contracts` / fee-schedule table (contracted allowed
  amounts) anywhere in the schema (confirmed by grep of `src/db/schema.ts` and listed as record
  gap #17/§6.1 `payer_contracts` in the review). Variance against a contract cannot be computed
  without a contracted amount to compare against. **Missing dependency:** the `payer_contracts`
  / `fee_schedules` table from the review's record model (§6.1), stage 2.

## PHI posture and drill-down decision

Decision for this slice (owner sign-off requested — see Open questions): **aggregate-only, no
patient-level drill-down rows.** Every report above groups by category, CARC, payer, status, or
deadline bucket, never by patient or claim row. This is deliberately narrower than "minimum
necessary" would allow (a biller working denials already sees patient-level data in the queue) —
it minimizes the audit and access-control surface for a first Insight slice and avoids
re-solving `patients`/`claims`/`denials` masking rules (R-3.5.1, still unresolved per
`PROJECT_STATE.md`) inside a new module. Row-level drill-down (e.g., "show me the 12 claims
behind this cell," which would need to display patient names) is out of scope and tracked as an
open question for a follow-up slice once sensitivity-tag enforcement lands.

Because every report is an aggregate with no direct patient identifier, the underlying
`claims`/`denials`/`patients` join still touches PHI-adjacent tenant data (claim and denial rows
are Restricted PHI per §9.1 even in aggregate, since the practice's own claims volume and denial
mix can be sensitive competitively and the query plan still reads patient-linked rows) — so every
report run and export is still audited (see Data / API changes) even though the *rendered output*
carries no patient identifier.

## Acceptance criteria

Module and navigation:
- [x] `/insight` renders a list of the 6 available reports (1–6 above) plus the 2 planned reports
  (7–8), each with a one-line purpose description; planned reports are visibly disabled/labeled
  "Planned — see spec" and are not clickable.
- [x] `src/components/shell/navigation.ts`'s Insight "Reports" nav item is updated: `available:
  true`, `href: "/insight"` (replacing the placeholder `/reports` href), and `appHome()` now
  resolves Insight to `/insight`.
- [x] Each of the 6 available reports has its own page (e.g. `/insight/denials-by-category`) reachable
  from the `/insight` list.

Filters and calculation (per report, tested against seeded fixture data):
- [x] Date-range filter defaults to the last 90 days and can be changed; an end date before the
  start date is rejected with a validation message, not a query error.
- [x] Payer filter defaults to "All payers"; selecting a payer restricts every row to claims/denials
  for that payer (the filter is wired into every query's `WHERE` via `claims.payerId`; verified
  by the denials-by-payer isolation test that each payer's rows never merge — a dedicated
  ≥2-payer fixture UI test is left for the e2e suite, not run this session, see "anything left
  undone").
- [x] Denial summary by category/CARC (#1): sums and counts match a hand-computed total on fixture
  data; a CARC code outside `src/domain/carc.ts`'s reference list still appears, unlabeled but not
  dropped.
- [x] Denial summary by payer (#2): the payer filter control is disabled on this report with a
  visible reason; an unverified payer's row is labeled "Unverified" and not merged with any other
  payer.
- [x] Denial rate (#3): with zero claims submitted in range, the page shows "No claims submitted in
  this period" and no rate/percentage; with a nonzero denominator the displayed rate equals
  `distinct denied claims / distinct submitted claims` to two decimal places.
- [x] Open denials by appeal-deadline bucket (#4): the bucket boundaries match `OPEN_STATUSES`
  and the queue's own deadline math (shared code, not reimplemented); "No deadline configured" is
  shown even when its count is zero; a denial exactly 7 days out falls in "0–7 days" and one at 8
  days falls in "8–30 days" (boundary test).
- [x] Claims by status / A/R summary (#5): sums of `billedCents`, `paidCents`, and outstanding per
  status match a hand-computed fixture total; the "paid amounts are seed-only" footnote is present.
- [x] Appeal outcomes (#6): overturn rate is null/not shown (labeled "No decided appeals in this
  period") when `overturned + upheld = 0` for the filtered range; otherwise matches a hand-computed
  fixture rate.
- [x] Money is never displayed or exported with float rounding artifacts (reuse `formatCents`,
  including the `-$0.00` fix tracked in the billing review F2 — if F2 is still open when this
  ships, this spec's reports must not exhibit it even if the revenue-cycle page still does).

Access, tenant isolation, and audit:
- [x] Every report query is tenant-scoped through `withTenant()` (no report bypasses RLS).
- [x] Isolation test: a report run under tenant A returns zero rows influenced by tenant B's
  claims/denials, even with matching CARC codes or payer names.
- [x] Role access: `admin`, `manager`, and `compliance` roles can view and export every available
  report; `specialist` can view but not export (rationale: exports leave the audited system as a
  file; keeping "download a practice-wide roll-up" to roles above front-line specialist matches
  the existing revenue-cycle export pattern — confirm with owner, see Open questions).
- [x] Every report view emits an audit event (`insight.report_viewed`, with report id, date range,
  and payer id in metadata — no patient/claim IDs, no free text) per R-7.5.1.
- [x] Every CSV export emits a separate audit event (`insight.report_exported`, same metadata plus
  row count) per R-7.5.1/R-7.5.4.
- [x] No report page, API route, or export filename/URL contains a patient name, MRN, or member ID
  (R-7.4.8); export filenames use only the report id and the (non-PHI) date range (see the Excel
  export section below — the export format changed from CSV to `.xlsx` per the owner's 2026-09-26
  decision, so the extension is `.xlsx`, not `.csv`).

Excel export (owner decision 2026-09-26 — supersedes the CSV export in the original draft):
- [x] Export is triggered by POST (filters in the body), not a GET with filters in the query
  string, to keep filter state out of browser history for the export action.
- [x] Each report exports as a single `.xlsx` workbook: an "About" cover sheet (report name,
  practice name, filters applied, generated-at timestamp, generated-by user ID, metric
  definitions, data caveats) plus one or more data sheets with a bold frozen header row,
  autofilter, sensible column widths, a totals row where meaningful, and no merged cells in the
  data area.
- [x] Money cells are real numbers formatted as currency (converted from cents to dollars only at
  write time); percentages are numeric cells with a percent format; dates are real date cells —
  never pre-formatted strings.
- [x] Any text cell that could be read as a spreadsheet formula (starts with `=`, `+`, `-`, or `@`)
  is sanitized before being written (same threat as CSV formula injection).
- [x] An "All reports" workbook is available, combining every available report into one file (one
  sheet per report, plus its own cover sheet).
- [x] Exported totals match the on-screen totals for the same filters, on the money columns (same
  cents-to-dollars conversion, no float rounding artifacts).
- [x] No patient name, MRN, or member ID appears in the filename, headers, or any cell (R-7.4.8);
  filenames use only the report id and the (non-PHI) date range, e.g.
  `denial-summary-by-category_2026-07-01_2026-09-26.xlsx`.

Performance:
- [x] Each report's query is written to use an existing index or a new one added by this spec's
  migration (see Data / API changes: `denials(tenant_id, notice_date)`,
  `claims(tenant_id, submitted_at)`, `claims(tenant_id, service_date)`) — no query filters on an
  unindexed date column.
- [ ] A report list page load and a report run each complete within the same performance budget
  as the existing `/denials` and `/claims` list pages — not measured this session (no `EXPLAIN`
  run against a fixture-sized tenant, no page-load timing); left for a follow-up check, see
  "anything left undone".

Legal deadlines:
- [x] None of these reports compute or display a new legal deadline; they read
  `denials.appealDeadline` as already computed by the rules engine, so no new day-before/of/after
  tests are needed for date logic. The one boundary that matters here is the 7/8-day bucket edge
  in report #4, covered above.

## Data / API changes

No new tables. Read-only queries against existing tables: `claims`, `claimLines` (not needed
here), `denials`, `payers`. New indexes to support the filters/grouping without full scans:

- `denials`: add `(tenant_id, notice_date)` btree index (date-range filter is not covered by the
  existing `denials_queue_deadline_idx (tenant_id, status, appeal_deadline)` or
  `denials_queue_amount_idx (tenant_id, status, denied_cents)`).
- `claims`: add `(tenant_id, submitted_at)` and confirm `(tenant_id, service_date)` — check
  whether an equivalent index already exists before adding (schema currently has
  `claims_tenant_payer_idx` and `claims_tenant_patient_idx` only; a `service_date`/`submitted_at`
  index does not exist and is needed for report #3 and #5's date-range filters).

New audit actions in `src/lib/audit.ts`'s `AuditAction` union: `insight.report_viewed`,
`insight.report_exported`. Metadata fields: `reportId`, `dateFrom`, `dateTo`, `payerId` (nullable),
and for exports `rowCount`. No patient, claim, or denial IDs in metadata (these are aggregate
reports; if a future drill-down slice adds row-level IDs, it must also add
`patient.*_viewed`-style handling and reassess minimum-necessary access, R-5.1.2).

Data classification (REQUIREMENTS §9.1): the report *queries* touch Restricted PHI tables
(`claims`, `denials`); the report *output* is a tenant-level aggregate with no direct patient
identifier. Treat the feature as PHI-adjacent for audit/access purposes (see PHI posture above),
Confidential (not Restricted-Sensitive) for the rendered/exported output.

New route surface (exact paths are a builder decision within this spec's intent):
- `GET /insight` — report list.
- `GET /insight/<report-id>` — report view with filters as non-PHI query params.
- `POST /insight/<report-id>/export` — CSV export, filters in body.

## Legal rules used

None. This spec reads existing rule-engine outputs (`denials.appealDeadline`,
`appealDeadlineBasis`) for report #4's bucketing; it does not compute, version, or cite any new
statutory deadline, rate, or threshold. No `rules/` changes.

## Out of scope
- Custom/user-built reports (choose your own columns, grouping, saved report definitions) — later
  Insight slice.
- Patient-level or claim-level drill-down rows from any report cell.
- Prompt-pay scorecard (#7) and underpayment variance (#8) — planned, blocked on the F4 notice-
  classification fix and a `payer_contracts`/fee-schedule table, respectively.
- True days-in-A/R aging (30/60/90 buckets) computed from `claims` directly — the existing
  `/revenue-cycle/ar-aging` (PM-file-sourced) report already covers aging; a `claims`-sourced
  aging report needs the `paidCents` DB invariants the billing review flagged as missing first.
- Clean-claim rate, first-pass resolution rate, net collection rate, days in A/R, and compliance
  reports (access logs, refunds, open credit balances) named in §8.7 — none of these have a
  reliable source in `claims`/`denials` today (no submission-attempt history, no rejection-vs-
  acceptance tracking) and are left for a follow-up slice once claims C2–C4 (CSV import, 837P,
  999/277CA) land.
- Scheduling/emailing a report on a cadence.
- Dashboards/widgets embedding these reports elsewhere (e.g., on `/overview`).

## Open questions

All resolved by the owner on 2026-09-26 — see "Owner decisions" at the top of this spec. Left here
for the historical record of what was asked:
- Role access for export: admin/manager/compliance export, specialist view-only. **Resolved.**
- Aggregate-only, no drill-down, for this slice. **Resolved: yes, for this slice.**
- Report #6's date anchor (`noticeDate` vs. `updatedAt`). **Resolved: keep `noticeDate`.**
- Report #5 alongside `/revenue-cycle/ar-aging`. **Resolved: both views stay, clearly labeled.**
- Exact route/file layout under `src/app/(app)/insight/` — implemented as one dynamic route,
  `/insight/[reportId]`, with the report id validated against the fixed catalog.
