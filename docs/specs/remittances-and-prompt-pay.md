# Spec: Remittances and prompt pay

Status: in progress — R1/PP1 approved by delegated technical authority (2026-09-26)
Roadmap items: Phase 1 → "835 ERA ingestion", "Florida prompt-pay clock"; billing review
(`docs/reviews/2026-09-26-billing-structure-review.md`) rows 9–10, finding F4, record model §6.1
Requirement IDs: R-3.1.1, R-3.1.2, R-3.1.3, R-3.1.4, R-3.10.3, R-5.1.2, R-7.5.1, R-9.2.1, §8.2 step 7

## Goal
Billing staff load a payer's 835 remittance, check that it balances, and post it: each claim's
paid amount and status change with a recorded claim version, and the payment or denial becomes a
dated payer response on the claim's Florida prompt-pay clock. The prompt-pay pages show every
open clock, which milestones the payer met or missed, uncontestable claims, and the interest owed
on late payments, with an itemized worksheet per claim. Every record keeps its full history.

## Phases
| Phase | Scope |
|---|---|
| **R1** (this PR) | `remittances` + `remittance_claims` + `remittance_events`; 835 upload (`/remittances/new`), list, record page, post and void with reason; claim page "Payments" panel |
| **PP1** (this PR) | `prompt_pay_responses` (append-only, "recorded in error" corrections); `/prompt-pay` list, `/prompt-pay/[claimId]` clock record with interest worksheet; record contest page |
| R2 | Reversals (CLP02 = 22), denial capture from posted adjustments (needs a cited CARC → category mapping), line-level (SVC) detail, ERA ↔ deposit reassociation by TRN |
| R3 | Clearinghouse feed instead of upload (vendor + subcontractor BAA, U.S.-only; `docs/data-sources.xlsx`) |
| PP2 | Alerts at the configured days (R-3.1.2) in a notification center; demand letter for uncontestable claims (R-3.1.4); evidence package export (R-3.1.7) |

## User stories
- As a billing specialist, I upload an 835 and see the check/EFT, the payer, each claim paid, and
  whether the file balances before I post it.
- As a billing specialist, I post a remittance so claim paid amounts and statuses are updated in
  one step, with a claim version recording why.
- As a manager, I void a remittance loaded in error (before posting) with a reason; it stays on
  file, marked void.
- As a billing specialist, I see every Florida prompt-pay clock, the next milestone, which ones
  the payer missed, and the interest owed.
- As a billing specialist, I record that a payer contested a claim or asked for information (a
  person decides this; DenialDesk does not infer contests from codes, F4), and I can mark my
  entry as recorded in error with a reason.
- As a compliance reviewer, I read every change to a remittance or clock: who, when, why.

## Acceptance criteria
### Remittances (R1)
- [x] `/remittances` table: trace number (link), payer, method, payment date, claims, total paid,
      status; filters (status, payer); stat tiles; pagination; audit of the IDs shown.
- [x] "New remittance" in the page header opens `/remittances/new` (own page, breadcrumb, Cancel).
- [x] Upload accepts one 835 (≤ 5 MB), parsed as untrusted input; errors name the segment, never
      patient data. Patient names (NM1*QC) and bank account/routing numbers (BPR07–15) are never
      read or stored (minimum necessary, CLAUDE.md #6).
- [x] The payer is matched by EDI payer ID; every CLP01 must match a claim of that payer;
      duplicate trace number per payer is refused; reversals are refused until R2.
- [x] Record page `/remittances/[id]`: breadcrumb, header with status badge, payment fields,
      balance check, claim payments table (claim and patient links, status code, charge, paid,
      patient responsibility, adjustments as `GROUP-CARC`), history panel (events + who/when/why).
- [x] Post (received → posted): every claim gets a new claim version (status and paid amount,
      reason "Posted from remittance <trace>"), and a payer response (payment or denial) dated
      the payment date. All or nothing, in one transaction.
- [x] Void (received → void) needs a reason. Posted and void are final.
- [x] Database: remittance core fields immutable; `remittance_claims` and `remittance_events`
      append-only; a status change without an event row from the same transaction is refused;
      RLS + isolation tests on all three tables.
- [x] Claim page shows a "Payments" panel (remittance links) and links to its prompt-pay clock.

### Prompt pay (PP1)
- [x] `/prompt-pay` table of claims with a received date whose payer regime is under Florida
      prompt pay: next milestone with days left, state (open / met / late / uncontestable),
      interest owed; filters (state, payer); stat tiles; pagination; audit of IDs shown.
- [x] `/prompt-pay/[claimId]`: milestones with due date, met on, days late, citation and
      "Pending counsel verification"; interest worksheet (R-3.1.3); response history including
      responses recorded in error.
- [x] `/prompt-pay/[claimId]/responses/new`: record a contest / information request (date, note);
      a response can be marked recorded in error with a reason (new row, nothing edited).
- [x] Boundary tests day before / of / after for each milestone and the interest start
      (`rules/prompt-pay.test.ts`).

## Data / API changes
Migration `0025_remittances_prompt_pay` (Restricted PHI: claim links; no names, no bank data):
- `remittances`: payer, method (check / eft / non_payment), trace number, payment date, total
  paid, status (received / posted / void), source (upload / seed), loaded by. Unique
  (tenant, payer, trace number).
- `remittance_claims`: remittance, claim, CLP status code, charge, paid, patient responsibility,
  payer claim control number, adjustments (jsonb `[{group, carc, cents}]`), RARCs. Insert-only.
- `remittance_events`: remittance, event (received / posted / void), reason, actor, at. Insert-only.
- `prompt_pay_responses`: claim, kind (payment / denial / contest), response date, cents,
  remittance, note, `voids_response_id` + reason for "recorded in error", recorded by. Insert-only.
- Claims: posting writes `claim_versions` (snapshot gains `paidCents`) and updates status and
  `paid_cents` through the existing version trigger.
Audit events: `remittance.list_viewed`, `remittance.uploaded`, `remittance.viewed`,
`remittance.posted`, `remittance.voided`, `prompt_pay.list_viewed`, `prompt_pay.viewed`,
`prompt_pay.response_recorded`, `prompt_pay.response_voided`. IDs only in metadata.
Roles: view — all practice roles; upload and post — admin, manager, specialist; void — admin,
manager; record contests — admin, manager, specialist (R-5.1.2).

## Legal rules used
`fl.promptpay.{electronic,paper}.{pay_or_contest,pay_or_deny,uncontestable}`,
`fl.promptpay.electronic.provider_response`, `fl.promptpay.interest_rate` — all ⚠️ VERIFY.
Evaluated by `rules/prompt-pay.ts`. Interest accrual start (payment due date = pay-or-contest
date, or pay-or-deny once contested) is an interpretation pending counsel.

## Out of scope
Reversals and corrections via 835, denial capture from adjustments, PLB detail, secondary
payer crossover, bank reassociation, clearinghouse connection, alerts and demand letters (see
phases). Data sources to connect are tracked in `docs/data-sources.xlsx`.

## Open questions
- Counsel: interest accrual start and whether a contest resets it; paper provider-response window.
- Owner: clearinghouse vendor (835 feed) and bank feed for reassociation (`docs/data-sources.xlsx`).
