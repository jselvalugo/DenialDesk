# Spec: Denial queue and denial detail

Status: done (2026-09-26) — approved by delegated technical authority
Roadmap items: Phase 1 → "Denial capture…", "Denial work queue…", "Denial detail…", "Appeal deadline engine…"
Requirement IDs: §8.3, §8.4, R-3.1.1, R-3.1.2, R-4.2.1, R-5.1.2, R-7.3.3, R-7.5.1

## Acceptance criteria
- [x] Queue of open denials sorted by appeal deadline (then amount); filters for status, payer,
      category, assignee; sort by deadline, amount, or newest notice; 25 per page.
- [x] Totals: open denials, amount at risk, due in 7 days, past deadline, no deadline configured.
      Deadline counts only include denials still awaiting action (not appeals already filed).
- [x] Appeal deadline from the rules engine (Medicare) or the payer contract; "Not configured"
      shown instead of guessing.
- [x] Detail page: denial reason (CARC summary), group/remark codes, claim and lines, deadline
      with its basis, Florida prompt-pay milestones with met/late against the denial notice,
      patient with masked member ID, notes, activity.
- [x] Actions: change status, assign (only to team members), add note — each audited; the
      compliance role is read-only.
- [x] Member ID reveal requires a reason and is audited.
- [x] The member ID on file is the patient's primary payer's: the claim, denial, and appeal pages show
      its last four and offer a reveal only when the claim's payer is that payer; otherwise they show
      "Not on file for this claim's payer" (also when no payer is mapped), and the reveal actions refuse without decrypting or auditing a
      reveal (R-5.1.2; `src/domain/patients/member-id.ts`, `test/integration/member-id-reveal.test.ts`).
      Interim until coverage records hold one member ID per payer.
- [x] Every queue and detail view is audited.
- [x] Overview page (`/overview`; `/` is the welcome page, `specs/welcome-page.md`) with real totals, next deadlines, and open denials by reason.

## Deferred
- Denial capture from 835 files (Phase 1 "835 ERA ingestion") — today denials come from the seed.
- Payer setup screens to configure appeal windows.
- Bulk assignment, saved views, CSV export.
