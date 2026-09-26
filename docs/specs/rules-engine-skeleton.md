# Spec: Rules engine skeleton

Status: done (2026-09-26) — approved by delegated technical authority
Roadmap item: Phase 0 → "Rules-engine skeleton"
Requirement IDs: R-15.6, R-3.1.1, R-3.1.5, R-4.2.1, §11 (time zone, holidays)

## Goal
Legal deadlines are computed from one versioned, cited, effective-dated catalog, never hard-coded.

## Acceptance criteria
- [x] `rules/catalog.ts`: rules with ID, citation, regimes, value, unit, effective range, verify flag.
- [x] Every rule `verify: true` (enforced by test) until counsel confirms; only humans clear it.
- [x] `resolveRule(id, asOf)` picks the version in force; tests for day before/of/after a change.
- [x] Calendar: Eastern "today", calendar days, months (month-end clamp), federal holidays with
      observance, business days. DST and year boundaries tested.
- [x] Florida prompt-pay milestones (electronic 20/90/120, paper 40/120/140) from payer receipt;
      not applied to Medicare, Medicare Advantage, or self-funded ERISA.
- [x] Appeal deadline: Medicare = 5-day receipt presumption + 120 days (42 CFR § 405.942);
      others = payer-contract window, or no deadline if not configured (no guessing).
- [x] Timely filing: FL 6 months, Medicare 12 months.
- [x] Boundary tests (day before / of / after) for each deadline used by the UI.

## P1 — legal correctness (billing review 2026-09-26 §4, §7 P1)
Requirement IDs: R-15.6, R-3.1.1, R-3.1.3, R-3.1.5, R-3.1.6, R-3.6.2, R-4.2.1, §11.

- [x] Rule type carries `anchor` (service date, payer receipt, notice, …), day-count via `unit`
      (calendar days, business days, months, years, hours after next business day, percent),
      `rollForward`, and `confirmedBy` (null until a human records counsel's sign-off).
- [x] Weekend/holiday roll-forward is a per-version rule attribute. Florida rules roll to the next
      day that is not a weekend or Florida legal holiday (Fla. R. Gen. Prac. & Jud. Admin. 2.514(a);
      holidays per § 110.117 as referenced by 2.514(a)(6)) ⚠️ VERIFY. Medicare rules roll to the next
      federal workday (5 U.S.C. § 6103; CMS) ⚠️ VERIFY. Only the last day rolls: intermediate
      steps (the Medicare 5-day receipt presumption), rates and payer-contract windows do not.
      Applies to prompt-pay milestones too, so the denial and prompt-pay pages agree.
- [x] Month-end: months and years clamp to the last day of the target month (corresponding-date
      rule: Aug 29/30/31 + 6 months = Feb 28, or Feb 29 in a leap year), then roll forward.
      Decision recorded here; § 1.01 meaning of "month" ⚠️ counsel.
- [x] Medicare timely filing = 1 calendar year after the date of service (42 CFR § 424.44(a)(1);
      Claims Processing Manual Ch. 1 § 70); Feb 29 → Feb 28; last day rolls to the next federal
      workday. Primary text not fetched in research ⚠️ VERIFY.
- [x] Regime is checked before any rule lookup (`floridaRuleSet`), so Medicare/MA/ERISA never
      resolve Florida rules and cannot throw on a Florida version gap. Tested.
- [x] FL insurer (§ 627.6131, `fl.*`) and FL HMO (§ 641.3155, `fl.hmo.*`) are separate rule sets.
      HMO values mirror the insurer values per REQUIREMENTS §3.1; subsections ⚠️ VERIFY.
- [x] Catalog adds (REQUIREMENTS values, all ⚠️ VERIFY, not yet used by pages): electronic
      acknowledgment 24 h after next business day, paper acknowledgment 15 d, secondary payer 90 d,
      overpayment response 40 d, overpayment look-back 30 months, retroactive denial 1 year,
      patient refund 30 d (§ 456.0625, from 2026-01-01), Medicare reconsideration 180 d, ALJ 60 d,
      Council 60 d, court 60 d. Medicare amount-in-controversy thresholds: no value in
      REQUIREMENTS, not encoded (open question).
- [x] `timelyFilingDeadline`, `promptPayMilestones`, `appealDeadline`, `rulesForBasis` accept an
      injected rule set; effective-date switchover tested through each (day before / of / after).
- [x] Boundary tests: weekends, Florida-only holidays (Friday after Thanksgiving), federal-only
      holidays (Juneteenth, Columbus Day, Washington's Birthday), Aug 29/30/31, leap years.
- [ ] `locations.time_zone` → "today": not done in this PR. Every page calls `todayIn()` without
      a location, and a tenant can have several locations, so choosing the zone per claim/denial
      needs a spec decision (which location governs) and touches ~15 pages. Default stays Eastern.

### Owner answers (2026-09-26) — ⚠️ pending counsel; encoded only as stated
- Timely filing counts from the **submission date**, evidenced by the clearinghouse acknowledgement.
  ⚠️ Current claim detail copy says the deadline is "met once the payer confirms receipt"
  (`src/app/(app)/claims/[id]/page.tsx`); not changed here (review D2), listed for a builder PR.
- Late-payment interest accrues from the **first calendar day after** the prompt-pay deadline
  (the rolled due date). Matches current code (days late = payment date − due date).
- Medicare Advantage is **not** under Florida prompt pay; timing follows the plan contract.
  Note: 42 CFR § 422.520 requires MA plans to pay clean claims from non-contracted providers in
  30 days ⚠️ VERIFY; not encoded.
- Weekend/holiday roll-forward: yes (basis above).

## Open questions for counsel (carried from REQUIREMENTS §13)
- Whether Rule 2.514 governs statutory clocks outside court; § 110.117 vs § 683.01 holiday list;
  § 1.01 "month"; service vs discharge anchor for inpatient timely filing; MA prompt-pay
  position; interest start (OA-row added 2026-09-26).
- Confirm every value and subsection; § 641.3155 HMO values are assumed to mirror § 627.6131.
- Which holiday calendar defines a "business day" for Florida prompt pay.
- Interest rate and accrual start; effective dates of current statutory text.
