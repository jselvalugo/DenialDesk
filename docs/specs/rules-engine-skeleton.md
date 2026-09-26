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

## Open questions for counsel (carried from REQUIREMENTS §13)
- Confirm every value and subsection; § 641.3155 HMO values are assumed to mirror § 627.6131.
- Which holiday calendar defines a "business day" for Florida prompt pay.
- Interest rate and accrual start; effective dates of current statutory text.
