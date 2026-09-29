# Threat model: claims charge import (C2)

Scope: `src/app/(app)/claims/import/`, `src/app/api/claims/charge-template/route.ts`,
`src/domain/claims/{charge-file,charge-import,versions}.ts`, `src/lib/csv/parse.ts`; tables `claims`,
`claim_lines`, `claim_versions` (existing, no new table). Data: Restricted PHI (MRN, date of service,
diagnosis and procedure codes, charges, payer). Spec: `docs/specs/claims.md` C2.

| Threat | Control | Residual risk / owner |
|---|---|---|
| Real PHI uploaded to pre-production | `syntheticDataOnly()` (true off production, and on Netlify); attestation checkbox; every claim number starts `SYN-` and every MRN `SYN` | **Attestation, not proof**, like the monthly file and patient form: a real file with markers added would pass. Human: accept or add a stronger proof |
| Cross-tenant read or write | Every read and write runs in `withTenant` (row-level security on `patients`, `payers`, `providers`, `locations`, `claims`, `claim_lines`, `claim_versions`); the form's default provider and location are checked against what the tenant can see (FKs bypass RLS); integration test imports into two practices with the same MRNs and claim numbers | Low |
| Import creates or edits a patient (including a patient synced from an EHR) | No patient write path is imported; MRN match is a read; unknown MRN is a row error; a test asserts the module has no `insert/update(patients)` and that patient rows are unchanged after an import; the synced-patient read-only trigger (PI1a) is a second wall | Low |
| Code inflation or silent "fixes" (R-3.10.1) | Codes are format-checked and stored exactly as given: no upper-casing, padding, trimming inside a code, reordering, de-duplication, addition or replacement; unit tests assert order, case, and decimal points survive | Low |
| Duplicate billing (same charge imported twice) | Claim number is unique per practice; same-file re-upload refused once; same patient + payer + date + code with the same modifiers refused against every existing claim and within the file; imports serialized per practice by an advisory lock | A re-upload with all claim numbers changed and a different patient/payer/date/code set is not detected; `claim_imports` table needs a GRANT (OA-083) |
| Half-imported batch | All or nothing in one transaction; any row error aborts before a write | Low |
| Money errors | Strict `parseMoney` into integer cents, 1 to 9,999,999 per line, billed = exact sum; no floating point | Low |
| Parser DoS | 2 MB file, 5,000 data rows, 100 columns, 50 lines per claim, linear in-memory parser, 6 MB action body limit; problems returned capped at 1,000 | Low |
| PHI in logs, URLs, titles, audit, error report | Problems carry code, line number, and column header only; messages never quote a cell; POST with the file in the body; uploaded file name never stored or logged; audit metadata is IDs and counts (batch ID, claim IDs, line counts, warning counts); the report CSV is built in the browser from those fixed strings; tests assert no MRN, claim number, code, or name in audit rows or problems | Low |
| Over-exposure inside the practice | Only admin, manager, specialist can import (compliance reads only), enforced in the action and the domain; refused attempts audited | Role matrix still an owner decision (OA-084) |
| Formula injection in the downloaded report | Cells pass through `csvCell`; the report holds only fixed text and numbers | Low |
| Unverified payer or missing coverage sneaks into submission | Draft only; the import warns; C3's 837P builder must still refuse an unverified payer and a patient with no mapped coverage | C3 |
| Sensitive services (Part 2, HIV, behavioral) visible in codes | None yet (same as C1) | **Blocking before real data** (R-3.5.1, R-4.5.1) |
| Malware in the upload | The file is never stored, executed, or opened by another program; parsed as text after a strict UTF-8 decode | Low (R-7.4.6) |
