# Spec: Claims module

Status: in progress — C1 approved by delegated technical authority (2026-09-26)
Roadmap items: Phase 1 → Claims ("Claim data model with immutable version history", "Charge capture
via CSV import", "Timely-filing guardrail", "837P generation and clearinghouse submission",
"999 / 277CA acknowledgment capture")
Requirement IDs: R-3.10.1, R-3.10.3, R-3.1.5, R-3.1.1, R-5.1.2, R-7.5.1, §8.2

## Goal
Billing staff can see every claim the practice has, know which unsubmitted claims are close to
losing their filing window, correct a draft or rejected claim with a recorded reason, and see
the full, unchangeable history of every edit. Later phases add charge import and electronic
submission.

## Phases
| Phase | Scope | Roadmap item |
|---|---|---|
| **C1** (this PR) | Claims list, claim detail, immutable version history, correcting draft/rejected claims, timely-filing warnings | Claim data model; Timely-filing guardrail (warn) |
| C2 | Charge capture via CSV import → draft claims (synthetic-only guard as in revenue cycle imports) | Charge capture via CSV import |
| C3 | 837P generation and clearinghouse stub submission; submission **blocked** past the filing deadline unless an admin records an exception reason | 837P; Timely-filing guardrail (block) |
| C4 | 999 / 277CA capture: accepted/rejected status and payer receipt date (starts prompt pay) | 999 / 277CA |

## User stories
- As a billing specialist, I can list claims by status, payer, and filing risk so I submit the
  ones about to expire first.
- As a billing specialist, I can correct a draft or rejected claim (date of service, diagnosis
  codes, line procedure codes, modifiers, units, charges) and must say why.
- As a manager or compliance reviewer, I can see every version of a claim: who changed it, when,
  why, and what changed.

## Acceptance criteria (C1)
- [x] `/claims` lists claims, 25 per page, filterable by status group (unsubmitted / in process /
      all), payer, and filing risk; sorted by filing deadline for unsubmitted claims, else newest
      date of service.
- [x] Totals: unsubmitted claims, unsubmitted billed amount, filing deadline within 30 days,
      past filing deadline.
- [x] Filing deadline comes from the rules engine (`fl.timely_filing.initial`,
      `medicare.timely_filing`) by the payer's regime; other regimes show "Not configured"
      (payer contract), never a guessed date.
- [x] Filing status is only shown for claims not yet accepted by the payer (draft, rejected).
      Boundary: deadline tomorrow = open (due soon), deadline today = open (due today), deadline
      yesterday = past deadline.
- [x] `/claims/[id]` shows claim header, lines, patient (masked member ID), denials on the claim,
      filing deadline with its rule and citation, and version history.
- [x] Every claim has version 1 recorded when it is created (seed and generator); each correction
      writes a new version with the full snapshot, the editor, time, and a required reason
      (R-3.10.3).
- [x] Version history is append-only: the app role can only insert and read `claim_versions`;
      a database trigger rejects changes to a claim's billed content unless the matching new
      version row already exists in the same transaction.
- [x] Only draft and rejected claims can be corrected; only admin, manager, and specialist roles
      can correct (compliance is read-only, R-5.1.2). Code changes are made by a person and
      recorded with who and why — nothing changes codes automatically (R-3.10.1).
- [x] Code format checks: CPT/HCPCS `^[A-Z0-9]{5}$`, modifiers `^[A-Z0-9]{2}$` (max 4),
      ICD-10-CM `^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$` (1–12 codes), units 1–999,
      charge $0.01–$99,999.99 per line; billed amount is the sum of line charges.
- [x] Audit: list view (`claim.list_viewed`, claim IDs), detail view (`claim.viewed`, patient ID),
      correction (`claim.corrected`: version number, version row ID, and changed field names only).
      The typed reason can hold PHI, so it stays in `claim_versions` (Restricted PHI); the audit
      row's `reason` is the fixed value `claim_correction`.
- [x] Navigation "Claims" item is live; e2e covers list → detail → correction → history.

## Data / API changes
- `claims.version integer not null default 1` — current version number.
- New table `claim_versions` (Restricted PHI, §9.1): `tenant_id`, `claim_id`, `version`,
  `snapshot jsonb` (service date, diagnosis codes, lines, billed amount, status), `changed_fields
  text[]`, `reason text`, `changed_by`, `created_at`. RLS tenant isolation; `SELECT, INSERT`
  only for `denialdesk_app`; unique `(claim_id, version)`.
- Trigger `claims_require_version` (BEFORE UPDATE): if service date, diagnosis codes, billed
  amount, patient, payer, provider, or location change, `NEW.version` must equal `OLD.version + 1`
  and that version's row must exist from this transaction. `created_at` can't change.
- Trigger `claim_lines_require_version`: lines of an existing claim change only after the claim
  moved to a version written in this transaction. `claim_versions_stamp`: the database sets
  `created_at`, and `changed_by` must be the signed-in user (or NULL for system versions).
- `claim_versions (tenant_id, claim_id)` references `claims (tenant_id, id)`, so a version can't
  point at another practice's claim (FKs bypass RLS). The version-1 backfill runs tenant by tenant
  so it works for a non-superuser migration owner, and fails the migration if any claim is missed.
- Server action `correctClaim` (claim ID, fields, reason). No new API routes.
- Snapshots hold codes and amounts, not patient demographics or member IDs.

## Legal rules used
- `fl.timely_filing.initial` — Fla. Stat. § 627.6131(2), 6 months — ⚠️ VERIFY (counsel).
- `medicare.timely_filing` — 42 CFR § 424.44(a)(1), 12 months — ⚠️ VERIFY (counsel).
- The 30-day "closing soon" window is a display setting, not a legal value.

## Out of scope (C1)
- Adding or removing claim lines (the app role can't delete lines; C2 decides how lines are voided).
- Creating claims by hand; CSV import (C2). Submission and blocking (C3). Acknowledgments (C4).
- Timely-filing exceptions (retro eligibility, COB) — needs counsel input; C3.
- Corrected/void claims to the payer (frequency 7/8) — Appeals phase.
- Code validity against licensed code sets (AMA CPT license, CMS ICD-10 files) — format only today.

## Before real data (from the C1 compliance review)
- `claim_versions` snapshots copy diagnosis and procedure codes that can be sensitive (HIV, SUD,
  behavioral health); sensitivity tagging and masking must cover snapshots and the history diff
  (R-3.5.1, R-4.5.1).
- Retention / legal-hold path for the append-only history (R-9.2.1).
- Whether a date-of-service correction that clears a past-deadline warning needs manager review.

## Open questions
- Which Florida timely-filing exceptions (§ 627.6131(2)) must the C3 block honor? (counsel)
- Should Medicare Advantage use the plan contract's filing window (payer setup) — assumed yes.
- PIP (Fla. Stat. § 627.736(5)(c)), workers' comp, and Medicaid filing limits are not in `rules/`
  yet; the UI says "no filing rule configured", never that none exists. (florida-rules-engine + counsel)
- `fl.timely_filing.initial` cites § 627.6131(2) for HMO claims too; confirm § 641.3155. (counsel)
- Is timely filing met when the claim is sent or when the payer receives it? Owner answer
  (2026-09-26, pending counsel): when **submitted**. The claim page judges a sent claim by its
  recorded submission date (`claims.submitted_at`, Eastern; the clearinghouse acknowledgement
  replaces it once C4 captures it) as sent on time / sent late, with a "Pending counsel verification" badge; only a
  sent claim with no recorded submission date still counts the deadline from today. (counsel)
