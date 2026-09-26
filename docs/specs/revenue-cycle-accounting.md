# Spec: Revenue cycle accounting

Status: approved (2026-09-26) — requested by the product owner; delivered in phases
Roadmap item: Phase 1 → claims, remittance, reporting (module "Revenue cycle")
Requirement IDs: §8.2 (charge capture via CSV; reconciliation to bank deposits), §8.7 (A/R aging
by bucket, days in A/R, net collection rate, open credit balances), §8.8 (accounting integration),
§11 (data accuracy: batch totals, control counts, reconciliation), R-7.2.4 (tenant isolation),
R-7.5.1 (audit), R-15.1 (synthetic data only)

## Goal
Month-end accounting for a Florida physician practice, inside DenialDesk: import the practice-
management (PM) system's month-end activity file, classify every line with the practice's
accounting rules, post balanced journal vouchers to the general ledger, age the open receivable by
financial class, reconcile posted payments to bank deposits, and produce summary statements, tied
back to denials so a practice sees how much of its A/R sits in open denials.

**DenialDesk's own design.** The owner shared an earlier prototype for reference only
(instruction of 2026-09-26 in the implementing Claude Code session). Nothing in this module comes
from it: the file layout, rules, chart of accounts, voucher format, aging method, and
reconciliation are designed here. The rules and chart of accounts are *accounting
configuration* stored per practice, not legal rules, so they live in tenant tables, not in
`rules/`. Statutory figures (prompt-pay interest rates, deadlines) stay in `rules/` and are never
computed here.

## The monthly activity file
One CSV per month (`src/domain/revenue-cycle/monthly-file.ts`): one row per charge line that had
activity in the month **or** is still open at month-end. Columns: Patient name, Account number,
Service date, Procedure code, Description, Facility, Payer, Financial class, Status, Charges,
Payments, Adjustments (each *posted in the month*), Balance (open at month-end; negative = credit
balance). This is the standard shape of a PM "line-item activity with open balances" report, so:
- the month's ledger activity is exact (charges, payments, write-offs posted that month), and
- the file's balances are the practice's whole open receivable at month-end, for aging.
Lines needing review carry reasons: no activity at all, blank or invalid procedure code (not five
letters or digits), service after the period, credit balance (possible refund due; Fla. Stat.
§ 456.0625 tracking is a separate feature). Files carry a `format_version`; vouchers and aging use
only current-format files (earlier imports must be re-imported).

## Accounting model
**Every amount posts as recorded.** Each line's charges, payments, and adjustments for the month
reach the ledger exactly as the PM system posted them, whatever the line's status or code, so in
total the ledger's receivable equals the file's open balance and the month-to-month roll-forward
holds by construction. Per receivable account and site it holds only if lines keep their routing;
PM systems move balances between financial classes (e.g. to patient responsibility after
adjudication), so each voucher also reclassifies receivables between accounts and sites to match
the file (B3). Rules never change amounts; they only choose accounts:
- **Receivable (AR)** from the rule, else the financial class, else the practice default.
- **Revenue and adjustment accounts** from the rule, else the AR account's routing.
- **Net revenue** for the month = charges − adjustments posted in the month (accrual: charges when
  posted, write-offs when posted, whatever the service month).
- Voided charges reverse through their own adjustment account ("voided charges and corrections"),
  so voids are never counted as payer write-offs.

Adjustments are all write-offs the PM system posted (contractual, denial, small-balance, courtesy),
so the starter accounts are named "Adjustments and write-offs"; an adjustment-type column can
split them later. ⚠️ VERIFY with the practice's accountant: gross charges less posted write-offs
is a management view, not necessarily GAAP net revenue with implicit price concessions.

Starter configuration (`src/domain/revenue-cycle/defaults.ts`, "DenialDesk starter configuration
v1"): cash and a patient-payments clearing account; one receivable per line-of-business family
(commercial/HMO, Medicare/MA, Medicaid, WC/PIP, patient responsibility) with its revenue and
"adjustments and write-offs" accounts; prompt-pay interest income; voided charges and
corrections; one financial class per DenialDesk regulatory regime plus self-pay, linked to the
practice's payers; three rules (prompt-pay interest, voided charges, standard). Account numbers
are illustrative; ⚠️ VERIFY: each practice maps them to its own GL and PM financial classes.

Which file counts for a month: the file of the month's approved or exported journal voucher,
else the most recent current-format import (`periodFiles()`); every report uses this rule.

## Phases (one PR each)
- **B1 — Ledger setup and rules engine** (done). **B2 — Import and classified lines** (done).
- **C0 — DenialDesk's own design** (done): activity-file layout, routing-only rules, review
  reasons; see phase status.
- **B3 — Journal vouchers.** **B4 — Aging, deposits, reconciliation.** **B5 — Statements and
  dashboard.**

### B3 — Journal vouchers
- One voucher per monthly file. Lines grouped by (site, AR, revenue, adjustment account), three
  movements per group (a negative amount swaps sides; zero posts nothing):
  - charges: debit AR, credit revenue;
  - adjustments: debit the adjustment account, credit AR;
  - payments: debit the practice's payments-clearing account, credit AR.
  - receivable reclassification: for each (site, AR account), the prior month's file balance
    routed that way, plus this month's movements, is compared with this month's file balance
    routed that way; the difference posts to that receivable. Differences net to zero when the
    months roll forward; otherwise the voucher can't balance and the file must be fixed. The
    first imported month has no prior file, so its opening balances are the practice's GL.
- **Five checks**, exact to the cent, recomputed whenever the voucher is shown, approved, or
  exported: (1) debits equal credits; (2) ties to the file: posted charges, adjustments, and
  payments equal the file's totals; (3) receivables tie: for every site and AR account, opening
  (prior file) + movements + reclassification = the file's open balance; (4) every account exists
  in the chart with the right type and every line has a site; (5) no other approved or exported
  voucher covers the month.
- **Workflow:** draft → approved → exported, or void. Prepare (regenerating supersedes the draft)
  and export: admin or manager. Approve: admin or manager other than the preparer (also a DB
  check), all checks passing. Void: admin, with a reason. No deletes; amounts and lines are
  immutable (column-level grants).
- **Export:** general-ledger import CSV `Journal,Date,Account,Site,Debit,Credit,Memo`, dated the
  month's last day, journal `RCM-YYYY-MM-v<version>`, memos without PHI, formula-safe cells;
  every download audited.

### B4 — Aging, deposits, reconciliation
- **A/R aging** from the month's file: every line's open balance, by financial class
  and age (days from service date to month-end): 0–30, 31–60, 61–90, 91–120, over 120. Credit
  balances listed separately, not netted into buckets.
- **A/R roll-forward:** prior month's open balance + charges − payments − adjustments = this
  month's open balance; any difference is shown as unexplained (a missing line or an incomplete
  export).
- **Bank deposits:** CSV with `Date` and `Amount` only (never account numbers or free-text
  descriptions: bank data needs field-level encryption, CLAUDE.md #6), 1 MB / 5,000 rows, strict
  validation, insert-only, admin or manager, audited.
- **Payments-to-deposits reconciliation** per month: payments posted in the PM system vs.
  deposits recorded in the bank; the running difference is the clearing account's balance
  (undeposited or unposted cash), flagged when it grows month over month.

### B5 — Statements and dashboard
- **Income statement** by month: charges, adjustments and write-offs by financial class, voids and
  corrections, net patient service revenue, prompt-pay interest income.
- **Receivables summary:** open A/R by class and age, credit balances as a liability. No
  allowance for doubtful accounts until the practice configures one (never estimated).
- **Cash summary:** payments posted, deposits, clearing balance by month.
- **Dashboard KPIs:** net revenue and payments (last month), open A/R, days in A/R (open A/R ÷
  average daily net revenue over the last three months), net collection rate (payments ÷ net
  revenue over the last three months), share of A/R over 90 days; last 12 months charted.
- **Denial tie-ins:** open denied dollars (DenialDesk denials not yet resolved) by financial class
  through the payers' regulatory regime (a class can cover several payers), their share of open
  A/R, and links into the denial queue.
- Visible to admin, manager, compliance. Statements hold totals only (no PHI).

## Acceptance criteria (all phases)
- [ ] Every new table has `tenant_id`, FORCE row-level security, no DELETE grant, and an
      isolation test.
- [ ] Money is integer cents. No floating-point money.
- [ ] Every import, approval, export, and void is audited with IDs and counts only (no patient data
      in audit metadata or logs).
- [ ] Imported patient names and account numbers are PHI: shown only to signed-in users of the
      practice, never in URLs, page titles, or logs. Pre-production accepts synthetic files only.
- [x] The rules engine is deterministic and first-match-wins by priority; each line records the
      rule that matched. Rules choose accounts only; amounts always post as recorded.
- [ ] Journal vouchers can't be approved unless all five checks pass; the approver can't be the
      preparer.
- [ ] Rule and GL-account edits are limited to admins and audited, and keep a version history of
      every rule change (who, when, before/after) before any editing UI ships (PI1, CC8.1).
- [x] Loading the starter configuration: administrators only, practices without rules only,
      audited.
- [x] The engine compares codes exactly (case-sensitive, untrimmed); the importer trims cells.

## Phase status
- [x] **B1** (2026-09-26): `rcm_sites`, `payer_classes`, `gl_accounts`, `business_rules` with FORCE
      RLS, no DELETE, check constraints (contra 0–10000 bps, retired in C0; one default AR; AR accounts carry
      routing); pure engine `src/domain/revenue-cycle/engine.ts` with a fixed condition vocabulary;
      starter configuration seeded (audited) with every synthetic practice and loadable (audited,
      admin only) for practices without rules; read-only Rules and ledger page (admin, manager,
      compliance; hidden from specialists).
- [x] **B2** (2026-09-26): `rcm_files` + `rcm_claim_lines` (FORCE RLS, insert/select only:
      imports are immutable records; corrections are new imports). CSV import via a server action:
      5 MB / 50,000-row cap, UTF-8 only, parsed in memory by our own RFC 4180 parser (no new
      dependency), strict header/value validation that rejects the whole file and names rows and
      columns but never echoes values. **Synthetic-only guard outside production:** every account number
      must start with `SYN-` plus an attestation checkbox. Lines classified by the practice's rules;
      site detected from the facility name, else a chosen default site (validated in-tenant);
      control totals stored on the file and proven equal to the lines. Import (admin, manager) and
      view (admin, manager, compliance) audited with IDs and counts only. Synthetic sample file
      download (pre-production only) and last month's synthetic file seeded with every demo
      practice. Strict money, unambiguous headers, physical line numbers; generic stored file name
      (uploaded names can hold PHI); service dates after the period flagged; compliance sees masked
      names and accounts. Threat model: `docs/threat-models/revenue-cycle-imports.md`.
      **Account number must be the practice account number, never an insurance member ID** (member IDs
      require field-level encryption, CLAUDE.md #6).
- [x] **C0** (2026-09-26): DenialDesk's own design replaces everything carried over from the
      reference prototype. Month-end activity file layout (charges, payments, adjustments posted in
      the month; balance at month-end) with `adjustment_cents` and `format_version` on files;
      routing-only rules (percentage contra and line exclusion retired, migration 0012);
      `review_reasons` on lines (DB-checked vocabulary); starter chart, classes, and three rules;
      a month-by-month synthetic simulation (lagged adjudication, patient balances, later voids,
      invalid codes paid later) whose files roll forward exactly; three consecutive months seeded
      per demo practice. Practices seeded earlier keep their stored rules and version-1 files;
      reset pre-production demo practices from the operator console (`docs/runbooks/netlify.md`).
- [x] **B3** (2026-09-26): `rcm_journal_vouchers` + `rcm_journal_lines` (FORCE RLS, no DELETE;
      lines insert-only; vouchers update only workflow columns through column grants; DB checks:
      one side per line, approver ≠ preparer, void needs a reason; partial unique indexes: one
      draft and one approved/exported voucher per month). Pure `journal.ts` (lines, reclass, five
      checks, GL CSV) and `vouchers.ts` (prepare/approve/export/void, audited). A payments-clearing
      cash account (`is_payments_clearing`, one per practice) receives payments. Export is a
      server action returning the CSV (framework origin check; no GET side effects). Demo
      practices get last month's draft prepared by a synthetic manager, so the guest can approve.
      Vouchers use only current-format files; the first imported month takes its opening
      balances from the practice's GL (no reclassification). B4's roll-forward only reports; the
      voucher is what blocks a file that doesn't roll forward.
- [ ] B4 · [ ] B5

## Security notes
- Uploads: CSV only, size-capped, parsed in memory, never written to disk or object storage;
  formula-injection safe on export (cells starting with `= + - @` are prefixed).
- Rules are data (conditions from a fixed vocabulary), never code or regexes supplied by users.
- Journal voucher exports carry account numbers, site codes, amounts, and period memos only.

## Out of scope (for now)
XLSX/ODS uploads (needs a vetted parser dependency), automated bank feeds, posting to a GL by
API, allowance for doubtful accounts, rule-editing UI (needs version history first).
