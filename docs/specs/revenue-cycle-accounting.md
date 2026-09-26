# Spec: Revenue cycle accounting (RevCycle IQ features in DenialDesk)

Status: approved (2026-09-26) — requested by the product owner; delivered in phases
Roadmap item: Phase 1 → claims, remittance, reporting (new module "Revenue cycle")
Requirement IDs: §8.2 (charge capture via CSV, reconciliation to bank deposits), §8.7 (A/R aging
by payer and bucket, days in A/R, net collection rate), §8.8 (accounting integration), §11 (data
accuracy: batch totals, control counts, reconciliation), R-7.2.3 (tenant isolation), R-7.5.1
(audit), R-15.1 (synthetic data only)

## Goal
Bring the owner's RevCycle IQ month-end workflow into DenialDesk, per practice (tenant): import the
monthly practice-management charge/payment export, classify every line with a configurable set
of accounting rules, post balanced journal vouchers for the general ledger (MIP format), age A/R
first-in-first-out, reconcile to bank deposits, and produce summary financial statements — and
tie it back to denials, so a practice sees how much of its A/R is sitting in open denials.

Source for the business rules, GL routing, MIP layout, and FIFO method: the owner's RevCycle IQ
build specification (Google Drive "Revenue Cycle Integration" folder, `replit.md` and the build
prompt). These are the practice's **accounting configuration**, not legal rules, so they live in
per-tenant tables, not in `rules/`. Each seeded default is labeled with that source.

## Phases (one PR each)
- **B1 — Ledger setup and rules engine:** sites, payer classes (optionally linked to a DenialDesk
  payer), GL accounts, and business rules, each tenant-scoped with RLS; the 12 default rules and
  GL routing seeded per practice; a pure, unit-tested rules engine; a read-only "Rules" page.
- **B2 — Import and processed claims:** CSV upload of the monthly export (synthetic only in
  pre-production), strict column validation, control totals (rows, billed, paid, balance), each
  line classified by the engine and stored as a processed claim; import list and detail pages.
- **B3 — Journal vouchers:** four lines per (site, AR, revenue, adjustment) group; the five
  validation checks; draft → approved (manager/admin, not the preparer) → exported; MIP CSV export
  (audited).
- **B4 — Deposits, A/R aging, reconciliation:** bank deposit CSV import, FIFO aging into nine
  30-day buckets, deposit reconciliation (cross-period = bank total − current-period payments).
- **B5 — Financial statements and RCM dashboard:** income statement, balance sheet (A/R), cash
  flow and reconciliation views; dashboard with charts and denial tie-ins (open denied dollars by
  payer class, denial share of A/R).

## Acceptance criteria (all phases)
- [ ] Every new table has `tenant_id`, FORCE row-level security, no DELETE grant, and an
      isolation test.
- [ ] Money is integer cents; percentages are basis points. No floating-point money.
- [ ] Every import, approval, and export is audited with IDs and counts only (no patient data in
      audit metadata or logs).
- [ ] Imported patient names and account numbers are PHI: shown only to signed-in users of the
      practice, never in URLs, page titles, or logs. Pre-production accepts synthetic files only.
- [ ] The rules engine is deterministic and first-match-wins by priority; each processed claim
      records the rule that matched.
- [ ] Journal vouchers can't be approved unless all five checks pass; the approver can't be the
      preparer.
- [ ] Rule and GL-account edits are limited to admins and audited (a later phase adds editing UI).

## Phase status
- [x] **B1** (2026-09-26): `rcm_sites`, `payer_classes`, `gl_accounts`, `business_rules` with FORCE RLS,
      no DELETE, check constraints (contra 0–10000 bps, one default AR, AR accounts carry routing);
      pure engine `src/domain/revenue-cycle/engine.ts` with a fixed condition vocabulary; the 12
      defaults + GL routing in `defaults.ts`, proven identical to the original RevCycle IQ engine on
      5,000 generated lines; defaults seeded with every synthetic practice and loadable (audited,
      admin/manager) for practices without rules; read-only Rules and ledger page (admin, manager,
      compliance; hidden from specialists).
- [ ] B2 · [ ] B3 · [ ] B4 · [ ] B5

Finding from the port (⚠️ VERIFY with the owner): in the original order, rule 9 (Medicare/Medicaid
PPS wrap) matches every class rule 11 (Capitation) lists, so Capitation never fires. Ported as is;
the Rules page says so.

## Security notes
- Uploads: CSV only, size-capped, parsed in memory, never written to disk or object storage;
  formula-injection safe on export (cells starting with `= + - @` are prefixed).
- Rules are data (conditions from a fixed vocabulary), never code or regexes supplied by users.

## Out of scope (for now)
XLSX/ODS uploads (needs a vetted parser dependency), automated bank feeds, posting to MIP by API.
