# Review: medical billing process coverage, calculated fields, and the record model

Date: 2026-09-26 · Tree: `4038119` (patients P1 merged) · Branch: `claude/medical-billing-review-j7ng1p`
Requested by the product owner: "validate that the processes within the entire medical billing
structure are being met, that calculated fields are correct, and that records appear on every page
where relevant; the entire platform should be table/record based."

This is a review, not a change. Nothing in `src/`, `rules/` or `drizzle/` was modified. Line numbers
refer to the tree above. Requirement IDs refer to `docs/REQUIREMENTS.md`.

## 1. Verdict

**Baseline health is good.** Typecheck, lint and format are clean; 283 unit and 200 integration
tests pass on a fresh Postgres 16 with all 18 migrations applied.

**The billing process is not yet met.** Of the eight MVP steps in `docs/PRODUCT_BRIEF.md`, the
product implements the *work denials* step (queue, detail, assignment, notes), the *claim history*
half of *prove it*, and a month-end accounting module that runs beside the claims data rather than
on it. Everything between "claim exists" and "denial exists" is absent: no claim creation, no 837P,
no 999/277CA, no 835 posting, no payments. Claim status, paid amounts and every denial row exist
only because the synthetic seed wrote them (`src/db/seed.ts:127-166`). Setup data (locations,
providers, payers) is seed-only too, so a customer practice created from the operator console has
no providers, no locations and no payers and no screen to add them.

**Calculated fields are mostly right where they exist.** The rules-engine arithmetic, queue totals,
aging buckets, roll-forward, voucher checks and KPIs were traced and are correct at their
boundaries. Four confirmed bugs, six likely bugs or design gaps, and a set of missing
day-before/day-of/day-after tests are listed in §3. Two legal-clock findings matter most: the
prompt-pay panel reports "Met" on the 90- and 120-day pay-or-deny milestones for *any* denial
notice, including contests, and the queue says "Appeal filed on time" for denials that have no
deadline at all.

**The platform is only partly record-based.** Patients → claims → denials is the one chain of
records that works end to end, and even it is broken in one direction (denial detail has no link
to the claim). 12 of 24 schema tables have no list page and no detail page. There is no shared
list component: every list builds its own filters, sort and pagination, in four styles. §5 lists
the gaps per page and §6 sets out the target record model.

## 2. Billing process coverage

The MVP claim lifecycle (REQUIREMENTS §8.2) against what exists. "Records" means tables in
`src/db/schema.ts`; "logic" means `src/domain/**` or `rules/**`; "pages" means `src/app/(app)/**`.

| # | Stage | Records | Logic | Pages | Verdict |
|---|---|---|---|---|---|
| 1 | Practice, location, provider setup (§8.1) | `tenants`, `locations`, `providers` (no TIN, group NPI, address, POS, DEA) | Seed only (`seed.ts:170-182`); `createPractice` makes the tenant and admin only (`src/domain/platform/practices.ts:58-101`) | None | **Missing** |
| 2 | Payer master with regime, contracts, fee schedules, appeal windows (§8.1) | `payers` (regime, `appeal_window_days`, `appeal_window_source`); no contract, fee-schedule or ERA/EFT enrollment tables | `appealDeadline()` reads the window (`rules/deadlines.ts:19-41`) | None | **Partial** (seed-only, not editable) |
| 3 | Patient registration and coverage (§8.2 step 1) | `patients` with one `primary_payer_id` and one encrypted member ID; no coverage table, subscriber, secondary, effective dates, 270/271 | `src/domain/patients/*` | `/patients` list, new, chart, edit | **Partial** (P1 done; P2 pending) |
| 4 | Charge capture (§8.2 step 2) | `claims`, `claim_lines`, `claim_versions` (no POS, rendering/referring provider, prior-auth number, frequency code, original reference) | No creation path; the only `insert(claims)` is `seed.ts:213` | None | **Missing** (C2) |
| 5 | Scrubbing: NCCI, MUE, LCD/NCD, auth, timely filing (§8.2 step 3) | None | Format regexes on correction only (`src/domain/claims/correction.ts:6-8`); timely-filing warning (`src/domain/claims/status.ts:43-50`) | `/claims` filing tiles and filter | **Partial** (warning only) |
| 6 | 837P submission and claim status lifecycle (§8.2 step 4) | `claims.status` enum of 8 | **No transition code exists.** The only `update(claims)` is `correctClaim` (`src/domain/claims/versions.ts:86`), which never touches status. `submitted`, `acknowledged`, `closed` are never produced. `src/edi/` is a README | None | **Missing** (C3) |
| 7 | 999 / 277CA and payer receipt date (§8.2 step 5) | `claims.payer_received_date`, `submitted_at` | Set only by the seed (`seed.ts:130-131`) | Display only | **Missing** (C4) |
| 8 | 276/277 status inquiry (§8.2 step 6) | None | None | None | **Missing** (Phase 2) |
| 9 | Prompt-pay clock, alerts, interest, uncontestable flag, demand letter (R-3.1.1–R-3.1.4) | No alert, interest or paid-date columns | `promptPayMilestones()` and `payerResponseStatus()` (`rules/deadlines.ts:63-107`); the interest and 35-day provider-response rules exist in the catalog but are **never read** | Read-only panel on `/denials/[id]` only | **Partial** (math only) |
| 10 | 835 remittance posting: payments, adjustments, patient responsibility (§8.2 step 7) | None. `claims.paid_cents` is written only at `seed.ts:127` (`billed − denied`) | None | `/remittances` is "planned" in `navigation.ts:78` | **Missing** |
| 11 | Denial capture with CARC/RARC/group and categorization (§8.3) | `denials` (group, carc, rarcs, category, denied, notice, deadline + basis, status, appeal date, assignee) | 15-code CARC reference (`src/domain/carc.ts:12-46`, ⚠️ VERIFY); rows created only by the seed; the appeal deadline is computed **only in the seed** and never recomputed | Queue empty state claims denials "are captured from 835 ERAs" (`denials/page.tsx:166`), which is not true yet | **Partial** |
| 12 | Denial queue, assignment, notes, status (§8.3) | `denial_notes` | `changeStatus` allows **any status → any status** (`denials/[id]/actions.ts:28-69`); assignment restricted to team members; all audited | `/`, `/denials`, `/denials/[id]` | **Done for seeded data**; no enforced state machine, no root cause by provider/CPT |
| 13 | Appeals: letters, levels, outcomes, freq 7/8, Medicare 5 levels (§8.4, R-4.2.1) | None; appeal state is four denial statuses | Medicare redetermination deadline only (5 + 120 days) | `/appeals` planned | **Partial** (first-level deadline only) |
| 14 | Overpayment demands: 40-day response, 30-month look-back (R-3.1.6) | None | No rule in the catalog | None | **Missing** |
| 15 | Patient credit balances and 30-day refunds (R-3.6, § 456.0625) | `rcm_claim_lines.review_reasons` = `credit_balance` only | Credits listed apart in aging; the page says refunds aren't tracked | A/R aging credits panel | **Partial** (detection from the PM file only) |
| 16 | Patient statements, balance-billing block (§8.6, R-3.7.1) | None. "Statements" in the app means *financial* statements | None | None | **Missing** (Phase 3) |
| 17 | Reporting: aging, days in A/R, denial rate, net collection, clean-claim, first-pass, prompt-pay scorecard, underpayment variance (§8.7) | Derived from `rcm_files` / `rcm_claim_lines` only | Aging by financial class from the PM file; days in A/R and net collection rate (`statements.ts:108-125`) | `/revenue-cycle/ar-aging`, `dashboard`, `statements` | **Partial**: no denial rate, clean-claim rate, first-pass rate, scorecard or variance; aging is by class, not by payer or claim |
| 18 | Reconciliation to bank deposits (§8.2 step 8) | `rcm_deposit_files`, `rcm_deposits`, vouchers, journal lines | Import, reversal, monthly reconciliation, five voucher checks | `/revenue-cycle/deposits`, `/journal` | **Partial**: PM-file payments vs deposits; no ERA-to-EFT reassociation (no 835 or TRN) |
| 19 | Audit viewer and accounting of disclosures (R-7.5.4, R-5.1.1) | `audit_events` (append-only) | `audit()`; denial activity reads it back | None for customers | **Partial** |
| 20 | OIR evidence export, AHCA dispute packet (R-3.1.7, R-3.2.1) | None | None | None | **Missing** |

### 2.1 Structural findings

1. **Two disconnected halves.** DenialDesk `claims`/`claim_lines`/`denials` on one side and the
   revenue-cycle `rcm_claim_lines` imported from the PM export on the other share no key (no
   claim, patient or payer ID on `rcm_claim_lines`; `specs/patients.md` puts linking out of
   scope). The only join is an aggregate: open denied dollars grouped by `payers.regime` =
   `payer_classes.regime` (`src/domain/revenue-cycle/reporting.ts:108-121`). The demo data doesn't
   line up either: monthly files are generated independently of the seeded claims
   (`synthetic-file.ts:89-99`). Consequence: A/R, KPIs and credit balances describe a different
   dataset than the claim and denial pages.
2. **The same concept is modelled several ways.** Payer three ways (`payers`, `payer_classes`,
   free-text `rcm_claim_lines.payer_name`/`payer_class`); location two ways (`locations`,
   `rcm_sites`); line status two ways (`claim_status` enum vs free-text PM status); regime type
   four copies (`regimeEnum`, `rules/types.ts Regime`, `defaults.ts PayerRegime`,
   `denial-status.ts REGIME_LABELS`); CPT format two rules (`correction.ts:6` upper-case only,
   `engine.ts:92` either case).
3. **Workflows are not state machines.** Denial status can jump between any of the nine values,
   and `appeal_submitted_on` is never cleared when a denial moves back (`actions.ts:50-53`).
   Claims have no transitions at all. Only journal vouchers have a DB-enforced forward-only
   workflow (`drizzle/0014_revenue_cycle_journal_vouchers.sql:90-122`); that pattern should be
   the norm.
4. **Regime is per payer, not per claim.** REQUIREMENTS §1.3 requires the engine to identify the
   regime *of each claim*; one Florida carrier commonly administers both fully insured and
   self-funded ERISA plans. Today every claim of a payer gets the payer's regime, so Florida
   prompt pay would be applied to that carrier's ERISA claims.
5. **Money invariants live in application code only.** Nothing in the database enforces
   billed = Σ line charges, 0 ≤ paid ≤ billed, 0 < denied ≤ billed, or non-negative charges
   (`drizzle/0001_core_schema.sql:41-42,69`); `versions.ts:214` is the only check. The claim
   version trigger (`drizzle/0011_claim_versions.sql:61-93`) ignores `status` and `paid_cents`,
   so those can change without a history row.
6. **Member-ID reveal is bound to the patient, not the claim's coverage.** The denial page
   decrypts the patient's *primary payer* member ID (`denials/[id]/actions.ts:159-175`) even when
   the denied claim was billed to a different payer (`claims.payer_id` is independent of
   `patients.primary_payer_id`).

## 3. Calculated fields

Reviewed: `rules/**`, `src/lib/deadline.ts`, `src/lib/format.ts`, `src/domain/{denials,claims,
patients,revenue-cycle,synthetic}/**`, `src/db/seed.ts`, every page under `src/app/(app)/`.

### 3.1 Confirmed bugs (reproduced)

| # | Where | What happens | Should | Fix |
|---|---|---|---|---|
| C1 | `src/domain/claims/correction.ts:28-33` | `dollarsToCents` strips every comma before validating: `"12,50"` → 125000 cents ($1,250.00); `"1,2,3.00"` → 12300 | Reject malformed grouping like `parseMoney` in `monthly-file.ts:82` does (tested at `monthly-file.test.ts:47`) | Reuse the strict grouping regex; add tests |
| C2 | `src/app/(app)/revenue-cycle/statements/page.tsx:52,111-114`; `src/lib/format.ts` | Deductions are negated for display; months with zero adjustments become −0 and render as `-$0.00` | `$0.00` | Normalise −0 in `formatCents`; add a test |
| C3 | `src/app/(app)/denials/page.tsx:227-231` | "Appeal filed on time" shows whenever `appealSubmittedOn` is set and `appealDeadline` is null. The demo hits this: ERISA payers have `appealWindowDays: null` (`generator.ts:124,140`) and the seed stamps an appeal date on submitted/overturned/upheld denials (`seed.ts:158-160`) | Never state a legal conclusion without a deadline (`specs/denial-queue.md` "never guessing") | Show "Appeal filed · no deadline configured"; test it |
| C4 | `src/app/(app)/denials/[id]/page.tsx:309-311` with `rules/deadlines.ts:101-107` | Every prompt-pay milestone (20-day pay/contest, 90-day pay/deny, 120-day uncontestable) is compared with the denial notice date. A contest or request for information (e.g. CARC 16 + N290, CARC 252 + N706 in the generator) satisfies only the 20-day obligation under § 627.6131(4)(b)–(e); the 90/120-day clocks keep running and the provider's 35-day response clock starts | Day 20 met by any response; days 90/120 met only by payment or denial; "uncontestable" flagged when day 120 (140 paper) passes without pay or deny (R-3.1.4) | Classify each notice (payment / denial / contest) from CARC+RARC with a cited mapping; start `fl.promptpay.electronic.provider_response` from a contest; add boundary tests |

Also confirmed by tracing (no repro needed):

| # | Where | What happens |
|---|---|---|
| C5 | `denials/[id]/actions.ts:50-53` + `denials/page.tsx:227` | Moving a denial appeal_submitted → in_review keeps `appealSubmittedOn`. The "Past deadline" tile (ACTION_STATUSES) then counts it while its row says "Appeal filed on time"; re-submitting later keeps the *original* date, so a late refiling shows as on time |
| C6 | `src/app/(app)/revenue-cycle/ar-aging/page.tsx:79,133-142` | The "Undeposited payments / Unposted deposits" tile reads `reconciliation.at(-1)`, the latest month, while the page header says "at the end of {selected month}" |
| C7 | `src/app/(app)/denials/[id]/page.tsx:288` | The payer-contract explanation prints the payer's *current* `appealWindowDays`/`appealWindowSource` next to a deadline stored once at seed time. Once payer setup ships, editing the window makes the text contradict the date; a cleared window renders "null days" |

### 3.2 Likely bugs and design gaps

| # | Where | Finding |
|---|---|---|
| D1 | `src/domain/denials/queries.ts:53` | Deadline sort puts `appeal_submitted` denials (deadline already met) above `new` ones with sooner deadlines. Order by awaiting-action first |
| D2 | `src/app/(app)/claims/[id]/page.tsx:71-75,233-248` | A `submitted` claim with no receipt date is measured against *today*; once today passes the deadline it says "The filing window has closed… likely to deny" though it may have been sent on time. Compare `submittedAt` (or receipt, per counsel) with the deadline. The claims list excludes `submitted` claims from filing totals (`queries.ts:173,253`), so list and detail disagree. Line 235 also asserts a legal position ("met once the payer confirms receipt") that `specs/claims.md:106-107` lists as an open question |
| D3 | `src/domain/denials/queries.ts:119-140` | "Next appeal deadlines" includes deadlines up to 30 days overdue and shows 8 rows, so with 8+ recently overdue denials no upcoming deadline appears; denials over 30 days overdue are dropped here but counted in "Past deadline" |
| D4 | `src/domain/claims/queries.ts:64,174-183` | The 5,000-row cap keeps the oldest *service dates* across regimes, so a 7-month-old Medicare claim (12-month window) is kept ahead of a 5.9-month Florida claim about to expire. `truncated` is true at exactly 5,000 |
| D5 | `queries.ts:92`, `claims/queries.ts:198` | Tiles ignore list filters by design; with status=closed or a payer filter the tiles still show tenant-wide open totals. Either follow the filters or label tiles "all open …" |
| D6 | `src/domain/revenue-cycle/statements.ts:122` | Net collection rate = payments ÷ (charges − *all* write-offs). Industry practice removes only contractual adjustments; including bad-debt and small-balance write-offs inflates the rate. Needs an adjustment-type column (spec ⚠️) |
| D7 | `ar-aging/page.tsx:120,124` vs `dashboard/page.tsx:24,83` | Over-90 share computed two ways (float vs basis points): 451/1001 shows 45.1% on one page and 45.0% on the other; the 25% warning threshold is defined twice |
| D8 | `statements.ts:148` | `denialsByClass` picks the "first class by code" with JS code-unit order and uses the sentinel `"Unmapped"`, which would collide with a real class of that code |
| D9 | `vouchers.ts:90-97` | Voucher check 2 ("ties to the file") rebuilds source totals from the same lines rather than from the stored `rcm_files` control totals, so it proves only that the voucher was built consistently |
| D10 | `denials/page.tsx:63`, `claims/page.tsx:57` | Page > 1 with zero results shows "Page N of 1" with Previous enabled |

### 3.3 Checked and correct

Calendar math (UTC midnights, Eastern "today", DST-safe); `daysUntil` sign; Medicare appeal =
notice + 5 + 120; rule version resolved by the right anchor date; prompt pay excluded for
Medicare, MA and ERISA; "due in 7 days" = today..today+7 and matches `deadlineTone`; queue and
claims counts use the same WHERE as their tables; "filed after deadline" (`>`) and "on time"
(`<=`) consistent between list and detail; filing-state boundaries (tomorrow / today / yesterday);
version numbering under a row lock; patient chart totals use `OPEN_STATUSES` like the queue's
"amount at risk"; revenue-cycle rule matching; `parseMoney`; netCents = charges − adjustments;
voucher sign swapping, reclassification and CSV export; aging buckets inclusive upper bounds,
SQL (`receivables.ts:218-225`) and `bucketFor` agree including negative ages; roll-forward;
"half the month's payments" flag (strict >); days in A/R uses the day count of the months that
have files; over-90 = 91–120 + over 120. Seed invariants hold over 12 seed/asOf combinations:
billed = Σ lines, 0 < denied ≤ billed, notice ≥ receipt, receipt ≤ asOf, DOS ≤ asOf.

### 3.4 Correct but untested at the boundaries (Definition of Done requires them)

- Month-end and leap-year timely filing (verified by hand: 2026-08-29/30/31 + 6 months all →
  2027-02-28; 2027-08-31 + 6 → 2028-02-29; 2028-02-29 + 12 → 2029-02-28). Clamping is the
  conservative choice but is undocumented in the spec and untested.
- Electronic 90-day and all three paper milestones (40/120/140): only the dates are asserted, no
  day-before/of/after (`rules/deadlines.test.ts:42-45`).
- Payer-contract appeal deadline (used for FL insurer, FL HMO, MA): no boundary test.
- `payerResponseStatus` tested only against day 20.
- `catalog` "no overlapping versions" test probes only each rule's `effectiveFrom`, not ranges or
  gaps (a gap makes `resolveRule` throw at runtime). `deadlines.ts` hard-wires `catalog`, so an
  effective-date switch can't be tested through `promptPayMilestones`, `appealDeadline` or
  `timelyFilingDeadline`.
- Regime exclusion untested for medicaid_ffs, smmc, workers_comp, pip; `appealDeadline` untested
  for MA and ERISA. (Behaviour is correct: all return null → "Not configured".)
- SQL aging buckets vs `bucketFor` at 30/31/60/61/90/91/120/121; `reconcileDeposits` at exactly
  50%; `after_period` on the last day vs the day after; `upcomingDeadlines`, `openByCategory`,
  chart totals with closed/submitted denials, `dollarsToCents` malformed separators,
  `formatCents(-0)`.

## 4. Legal clocks (rules/ and consumers)

Anchors confirmed correct: prompt pay counts from `claims.payer_received_date` (277CA), never
from `submitted_at` or the notice date; appeal deadlines from `notice_date`; timely filing from
date of service; rule versions resolved by the anchor date. No statutory value is hard-coded
outside `rules/` (grep of `src/` for 20/35/40/90/120/140-day, 6/12-month and 12% found only
comments and display thresholds).

### 4.1 Catalog completeness (REQUIREMENTS §3.1, §3.6, §4.2)

| Requirement | Catalog | Used |
|---|---|---|
| Electronic acknowledgment, 24 h after next business day, § 627.6131(4)(a) | **Missing** (no hours/business-day unit) | – |
| Electronic pay-or-contest 20 d, pay-or-deny 90 d, uncontestable 120 d | encoded | denial detail |
| Provider response to a contest 35 d, (4)(c) | encoded (`catalog.ts:51-62`) | **never used** |
| Paper acknowledgment 15 d, (5)(a) | **Missing** | – |
| Paper 40 / 120 / 140 d | encoded | denial detail |
| Initial filing 6 months, (2) | `fl.timely_filing.initial` | claims |
| Secondary payer 90 d after primary's final determination | **Missing** (§8.5 guard) | – |
| Overpayment demand response 40 d; 30-month look-back (R-3.1.6) | **Missing** | – |
| Late-payment interest 12 %/yr (R-3.1.3) | `fl.promptpay.interest_rate` | **never used**; no accrual start |
| Retroactive denial 1 yr, (11) | **Missing** | – |
| Patient refund 30 d, § 456.0625, effective 2026-01-01 (R-3.6.2) | **Missing** | – |
| Medicare filing 12 months | `medicare.timely_filing` | claims |
| Medicare redetermination 120 d (+5-day receipt presumption) | encoded | queue and detail |
| Medicare reconsideration 180 d, ALJ 60 d, Council 60 d, court 60 d (R-4.2.1) | **Missing** | – |
| Medicare amount-in-controversy thresholds | **Missing**; no value in REQUIREMENTS | – |

### 4.2 Model gaps

- **HMO is not a separate rule set** (REQUIREMENTS §3.1 says "configure them as separate rule
  sets"): one rule serves both `fl_insurer` and `fl_hmo` with a composite citation; three rules
  (`provider_response`, `interest_rate`, `timely_filing.initial`) don't cite § 641.3155 at all.
- **The rule type can't express an anchor event, a day-count convention, or counsel sign-off**
  (`rules/types.ts`). Anchors live implicitly in `deadlines.ts` and page code; `RuleUnit` can't
  hold hours, business days, cents or plain percent; `value: number` for a rate invites float
  interest math; nothing records who confirmed a value and when.
- **Weekend/holiday roll-forward is neither decided nor documented.** `isBusinessDay` and
  `federalHolidays` are unused; there is no Florida state holiday calendar (§11).
- **Central time for panhandle practices is not wired**: every caller uses `todayIn()` with no
  argument; `locations.time_zone` is never read (§11).
- **Timely-filing anchors are incomplete**: claim-level service date only; no discharge date,
  statutory exceptions, secondary-payer anchor, or line-level dates.
- **Stored deadlines and payer windows sit outside versioning**: `denials.appeal_deadline` is
  written once with rule IDs but no version; `payers.appeal_window_days` is not effective-dated;
  for Medicaid, SMMC, WC and PIP the windows are statutory, so entering them as "payer contract"
  puts statutory values outside `rules/` (R-15.6) with no citation. There is no job to recompute
  stored deadlines after a rule correction.
- **Regime checks run after the rule lookup** (`deadlines.ts:69-70,75-77`): once a Florida rule
  gets a dated version with a gap, a Medicare page throws instead of returning null.
- **Statutory knowledge is embedded in the demo generator** (`generator.ts:300,349-365`): ages
  tuned to the 6/12-month and appeal windows; derive them from the rules instead.
- **Every rule is still ⚠️ VERIFY** with `effectiveFrom: null`; the `upheld` status ends the
  clock where R-4.2.1 expects it to start the next Medicare level; Medicare unprocessable notices
  (e.g. MA130) get a redetermination deadline they may not carry.

## 5. Pages and records

### 5.1 Schema table → where it surfaces

| Table | List page | Detail page | Notes |
|---|---|---|---|
| tenants | operator console only | no | |
| users, memberships, sessions | no | no | names only (assignee, author, preparer) |
| locations, providers | no | no | names on claim/denial detail |
| **payers** | **no** | **no** | referenced on every page, filter dropdowns, patient form |
| patients | yes | yes | |
| claims | yes | yes | |
| claim_lines, claim_versions | – | nested | |
| denials | yes | yes | |
| denial_notes | – | nested | |
| rcm_sites, gl_accounts, payer_classes, business_rules | one combined read-only page | no | class `regime` and `is_payments_clearing` not shown |
| rcm_files | yes (unpaginated) | yes | |
| rcm_claim_lines | inside file only | no | |
| rcm_journal_vouchers | yes (unpaginated) | yes | line `role` not shown; no drill-down to file lines |
| rcm_journal_lines | – | nested | |
| rcm_deposit_files | yes | **no** | |
| **rcm_deposits** | **no** | **no** | aggregated only |
| **audit_events** | **no** | **no** | denial Activity shows 3 action types |

### 5.2 Per-page gaps (highest value first)

- **Denial detail** (`/denials/[id]`): **no link to `/claims/[id]`** (the H1 and Claim panel are
  plain text); payer, provider, location not links; other denials on the same claim not shown;
  no appeal record; no claim version history; Activity omits views and reveals.
- **Denial queue** (`/denials`): the "Claim" cell links to the denial, not the claim; patient
  and payer cells are not links; "Newest notice" sort exists but there is no notice-date or
  date-of-service column; multiple denials on one claim look identical; tiles ignore filters.
- **Claim detail** (`/claims/[id]`): no payments/remittance section (only `paidCents`); the
  prompt-pay milestones are computed from claim fields but shown only on the denial page; denials
  are a `<ul>` (`:281-306`) without deadline, status or assignee; the denied line isn't marked;
  member ID masked with no reveal (`:276`), unlike the denial and patient pages; no activity.
- **Claims list**: `paidCents` loaded but no Paid column; no denial count; no user sort; tiles
  always describe *unsubmitted* claims even on the "Sent to payer" and "All" views.
- **Overview** (`/`): denials only; no unsubmitted-claims-at-risk, no "assigned to me"; audit
  metadata is a count, not the IDs shown, although claim numbers are displayed.
- **Patients**: list has no claims/open-denials/balance columns; chart has no balance or
  statement (PM lines aren't linked to patients), no secondary coverage, no activity; "Appeal by"
  is a plain date instead of `DeadlineIndicator`; related tables unpaginated.
- **Rules and ledger**: four record types on one page, no detail, no edit (only "Load
  defaults"), no links from rule codes elsewhere.
- **Files / file detail**: no voucher column or section; no line detail (review reasons only in a
  tooltip; `status`, `description`, `facility`, `payerName` stored but not shown); a different
  pagination style; breadcrumb is a `<p>` not `<nav>`; file view audit records a count, not IDs.
- **Journal / voucher detail**: missing credits, source file and approver columns in the list;
  line `role` hidden; no drill-down to file lines; other versions (superseded) not shown; no
  audit history; the page view is not audited.
- **A/R aging**: no drill-down from any cell, credit row or roll-forward month to lines; no link
  to the month's file (`selected.fileId` is available); undeposited tile bug (C6).
- **Deposits**: no deposit-file detail; individual deposits never listed; a reversal doesn't
  link the file it reverses; Status column mixes badges with an action form.
- **Dashboard / statements**: tiles and rows are not links; "last month" wording means the latest
  file; account and month cells don't link to vouchers or GL accounts.
- **Operator console**: no practice detail, users, sessions or per-practice audit; no pagination
  or filters; "Open denials (all practices)" includes demo practices while "Customer practices"
  excludes them.

### 5.3 Consistency

- **No shared list component.** `DataTable.tsx` provides `Table/Th/Tr/Td` only ("Sorting/
  pagination arrive with TanStack Table"). Four pagination styles; a "Sort by" dropdown on one
  page and fixed order elsewhere.
- **Four header styles** (`PageHeader`; the mono panel on claim/denial detail; the serif band on
  the patient chart; `<p>` vs `<nav>` breadcrumbs).
- **Dates**: `formatDate` MM/DD/YYYY vs `toLocaleDateString` M/D/YYYY (files, journal,
  deposits, file detail); voucher `when()` has no time zone; DESIGN §10 wants "10/14/2026 5:00 PM
  ET". Month labels three ways ("September 2026", "Sep 2026", "Sep 26").
- **Column names**: "Date of service" vs "Service date"; "Billed" vs "Charges" vs "Charge";
  "Appeal deadline" vs "Deadline" vs "Appeal by"; "Reason" vs "Category"; "Class" vs "Financial
  class" vs "Payer class"; "Period" vs "Month".
- **Patient name**: "Last, F." (queue, claims) vs "Last, First" (chart) vs the raw PM string.
- **Badges**: Draft is `neutral` for claims but `info` for vouchers (DESIGN §5 says neutral).
- **View audits**: IDs recorded on denials/claims/patients lists and details; counts only on
  overview and file detail; none on the files list, vouchers, deposits or rules.
- **Docs**: DESIGN.md §8 and `specs/erp-shell.md` don't mention the Patients app.

## 6. Target: a record-based platform

The owner's direction ("the entire platform should be table/record based") matches how the good
parts already work (patients, claims, denials, vouchers). The gaps are (a) records that exist in
the schema but have no page, (b) records the billing process needs but the schema lacks, and (c)
one list/detail pattern instead of several.

### 6.1 Record model to complete the billing process

New records (each: tenant-scoped, RLS + isolation test, audited, insert-only where it is
evidence):

| Record | Purpose | Key fields | Stage |
|---|---|---|---|
| `coverages` | Patient ↔ payer, primary/secondary, subscriber, effective dates; claims point at a coverage | patient, payer, rank, member ID (encrypted), subscriber relationship, group, effective from/to, eligibility result | 3 |
| `practice` fields, `providers` (TIN, group NPI, DEA, POS), `locations` (address, POS) | Setup | | 1 |
| `payer_contracts` / `fee_schedules` | Appeal windows effective-dated, allowed amounts for underpayment variance | payer, effective from/to, appeal window + source + anchor, timely filing override (MA), fee lines | 2, 17 |
| `claim_submissions` | Each 837P send: batch, ICN, clearinghouse status, 999/277CA receipt, payer receipt date | claim, sent at, ack at, received date, status, raw ref | 6, 7 |
| `claim_status_events` | The claim state machine as records (who/when/why per transition), DB-enforced forward-only like vouchers | claim, from, to, actor, reason, source (user / 277CA / 835) | 6 |
| `remittances` (835) and `remittance_lines` | Payments, adjustments (group + CARC), allowed, patient responsibility, check/EFT + TRN; source of `paid_cents`, denials and credit balances | remit, claim, line, paid, allowed, adjustments[], PR, date | 10, 11 |
| `appeals` | One record per appeal level: level, filed on, deadline, outcome, recovered, letter | denial, level, deadline + basis, filed on, decided on, outcome, recovered cents | 13 |
| `prompt_pay_events` / alerts | Clock milestones, contest/response dates, uncontestable flag, interest worksheet lines | claim, milestone rule ID + version, due, met on, response kind | 9 |
| `overpayment_demands`, `patient_refunds` | 40-day response clock; 30-day refund clock with determination date | | 14, 15 |

Also: `claim_lines.rendering_provider_id`, `prior_auth_number`, `place_of_service`; a claim-level
(or coverage-level) `regime` with the payer regime as default (§1.3); link
`rcm_claim_lines.account_number` to `patients` (a practice account-number field on the patient)
so the accounting half and the claims half describe the same money.

### 6.2 One list/detail pattern

- A shared `RecordList` (the planned TanStack `DataTable`, ADR 0004): sortable column headers, a
  filter bar, one pagination footer, one empty state, one audit call that records the IDs shown.
- A shared `RecordHeader` (identity, status badge, breadcrumb `<nav>`, actions) and a
  `RelatedRecords` section pattern (table + "view all" link) for every detail page.
- One `Activity` panel (audit events for the record) reused on claim, patient, voucher, file and
  payer pages, as the denial page already does.
- One formatting module: dates (MM/DD/YYYY, "h:mm a ET"), month labels, money (−0 fixed), patient
  name, and a label dictionary for shared columns.
- Every record type in the schema gets a list and a detail page, and every reference on a page is
  a link: payers, providers, locations, team, GL accounts, payer classes, rules, sites, deposit
  files and deposits, audit log.

## 7. Recommended order of work

**P0 — fix now (small, no spec change):** C1 comma charges; C2 −0; C3 "filed on time" with no
deadline; C5 clear/re-stamp the appeal date on status change and sort awaiting-action first (D1);
C6 undeposited tile; denial → claim link; over-90 share and threshold in one place (D7); missing
boundary tests in §3.4 (rules first).

**P1 — legal correctness (florida-rules-engine, spec update):** C4 notice classification and
uncontestable flag; add the missing catalog rules from §4.1 with REQUIREMENTS values and ⚠️ VERIFY;
split HMO rules; add anchor / day-count / confirmation fields to the rule type; regime check
before lookup; decide and document roll-forward and month-end clamping; wire `locations.time_zone`.

**P2 — record chain (spec + builder):** payers list/detail and setup records (providers,
locations, team); claim detail payments section; denials table on claim detail; claim status
machine as records; coverage records; audit viewer (R-7.5.4).

**P3 — close the lifecycle (edi-x12-specialist):** C2 CSV charge import, C3 837P + filing
block, C4 999/277CA → `claim_submissions`; 835 → `remittances` → paid amounts, denial capture,
credit balances; ERA-to-deposit reassociation linking the two halves of the product.

**P4 — appeals, prompt pay, reporting:** `appeals` records with Medicare levels; prompt-pay
alerts, interest worksheet, demand letter; overpayment and refund clocks; denial rate,
clean-claim, first-pass, scorecard, underpayment variance from the new records.

## 8. Decisions for the owner

1. Sent-vs-received for timely filing (D2) and weekend/holiday roll-forward (§4.2) go to counsel
   before C3; until then the claim page should use neutral wording.
2. Net collection rate definition (D6): keep the management view, or add an adjustment-type
   column and compute the standard rate.
3. Link the accounting module to claims (patient account number on the patient record and a
   claim reference on PM lines), or keep it as a separate reporting product.
4. Enforce state machines and money invariants in the database (as vouchers do) before the
   Azure cutover.

## Evidence

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: clean.
- `pnpm test`: 29 files, 283 tests passed. `pnpm test:integration` (Postgres 16, 18 migrations):
  15 files, 200 tests passed.
- Repros for C1 and C2 run with a throwaway vitest file (removed): `dollarsToCents("12,50")` =
  125000; `formatCents(-0)` = `-$0.00`.
- Review lanes: process coverage, calculated fields, legal clocks (florida-rules-engine, read-only),
  pages and records. Findings were cross-checked against the code before inclusion.
