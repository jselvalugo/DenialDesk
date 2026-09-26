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
