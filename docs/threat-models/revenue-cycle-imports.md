# Threat model: revenue cycle monthly file import (B2)

Scope: `src/app/(app)/revenue-cycle/files/actions.ts`, `src/lib/csv/parse.ts`,
`src/domain/revenue-cycle/{monthly-file,imports}.ts`, tables `rcm_files`, `rcm_claim_lines`.
Data: Restricted PHI (patient name, practice account number, service date, CPT, payer).

| Threat | Control | Residual risk / owner |
|---|---|---|
| Real PHI uploaded to pre-production (Netlify) | `syntheticDataOnly()` is true unless `APP_ENV=production` **and** not on Netlify; every Account number must start with `SYN-`; attestation checkbox | **Attestation, not proof**: a real file with `SYN-` added would pass. Human: accept, or add stronger synthetic markers |
| Cross-tenant read/write | FORCE RLS on both tables; default site validated in-tenant (FKs bypass RLS) | Composite `(tenant_id, id)` FKs deferred (PROJECT_STATE) |
| Tampering with imported records | App role has SELECT/INSERT only; corrections are new imports | Owner role can still modify (separate DB roles: open decision) |
| Parser DoS | 6 MB body limit, 5 MB file cap, 50,000 data rows, 100 columns, linear parser | Low |
| Silent money errors | Strict amounts (grouping, sign, 2 decimals), $10M/line cap keeps totals exact; control totals stored and tested | Low |
| PHI in logs, URLs, titles, audit | Errors name rows/columns only; generic stored file name; audit metadata IDs/counts only; DB errors sanitized | Low |
| Over-exposure inside the practice | Compliance role sees masked names/accounts; specialists get 404 | Role/field matrix still an open decision |
| Member IDs in the account column (would need field encryption, CLAUDE.md #6) | Spec: the column must hold the practice account number only | **Human**: confirm per PM system, or encrypt account numbers |
| Sensitive services (Part 2, HIV, behavioral) visible via CPT | None yet | **Blocking before real data** (R-3.5.1, R-4.5.1) |
| Formula injection on export | `csvCell` neutralizes `= + - @` | Low |

## Journal vouchers (B3)

| Threat | Control | Residual risk / owner |
|---|---|---|
| One person posts revenue alone | Approver ≠ preparer (app check + DB CHECK); approval requires all five checks | Two colluding users; audit trail shows both |
| Altering a posted voucher | Lines insert-only and only into drafts (trigger); voucher updates limited to workflow columns (column grant), forward-only and write-once (trigger); tenant-scoped FKs; no DELETE | Owner DB role can bypass (separate roles: open decision, owner: product owner, before Azure cutover) |
| Posting a month twice | Partial unique index: one approved/exported voucher per month; check 5; voiding an exported voucher requires confirming its GL reversal (audited) | The confirmation is attestation-level: nothing checks the external GL |
| Export/void racing | Row lock (`FOR UPDATE`) and checked updates before audit or CSV | Low |
| Export triggered by a link (CSRF) | Export is a server action (origin-checked), not a GET route | Low |
| PHI in the GL file or audit | Lines carry accounts, sites, amounts, period memos only; audit holds IDs/counts; test asserts no account numbers in the CSV | Low |
| Formula injection in the GL file | `csvCell` neutralizes `= + - @` | Low |

## Deposits and aging (B4)

| Threat | Control | Residual risk / owner |
|---|---|---|
| Bank account numbers or payer descriptions stored | Parser reads only the Date and Amount columns; nothing else is kept. The raw file is held in memory only while it's parsed | Low |
| Real bank data in pre-production | Synthetic marker column required on every row plus an attestation where `syntheticDataOnly()` | Attestation-level, like monthly files |
| Deposits counted twice | Content hash (same file) and date-range overlap refused; reversal by administrators with negated rows, audited | Low |
| Tampering with deposits | Insert/select only, FORCE RLS, non-zero CHECK; corrections are reversing entries | Owner DB role (open decision) |
| Parser DoS | 1 MB, 5,000 rows, 50 columns, linear parser | Low |
| PHI through aging | Aging is bucketed in SQL, so only totals by class and bucket leave the database; each report view is audited | Low |
| PHI in a reversal reason | Free-text reason with a "no patient information" hint; stored only in the audit event | Medium: a coded reason list would remove it (follow-up) |
| Unaudited refused reversals | Refusals (role, unknown file, already reversed) audited as `rcm.deposits_rejected` with `operation: "reverse"` | Low |

## Statements and dashboard (B5)

| Threat | Control | Residual risk / owner |
|---|---|---|
| PHI through statements or the dashboard | Sums and counts computed in SQL by GL account, month and regime; no line, name or account number leaves the database; each view audited as `rcm.report_viewed` | Low |
| Cross-practice totals | Every query runs in `withTenant()` under FORCE RLS; integration test compares two practices | Low |
| Denials shown to roles without revenue-cycle access | Pages 404 unless `canViewRevenueCycle` (admin, manager, compliance); e2e covers the specialist | Low |
| Misleading financial presentation | Labelled a management view; figures tie to the imported files (integration test) | Accountant review pending (owner) |
