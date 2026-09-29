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
| Duplicate billing (same charge imported twice, or its lines doubled) | Claim number is unique per practice; a re-upload whose claim numbers all exist is refused once; same patient + payer + date + code with the same modifiers is refused against every existing claim and within the file; rows are never merged twice (a repeated line, or a claim number returning after other claims, is refused, so a file pasted twice or overlapping exports can't double a claim's lines or billed amount); imports serialized per practice by an advisory lock | **There is no file-hash table** (a new table needs a GRANT, R-15.9). OA-083 is the proposal for one. Until then, a re-upload whose claim numbers were all changed, and whose patient, payer, date, and codes differ from every existing claim, is not detected |
| Half-imported batch | All or nothing in one transaction; any row error aborts before a write | Low |
| Money errors | Strict `parseMoney` into integer cents, 1 to 9,999,999 per line, billed = exact sum; no floating point | Low |
| Parser DoS | 2 MB file, 5,000 data rows, 100 columns, 50 lines per claim, linear in-memory parser, 6 MB action body limit; problems returned capped at 1,000 | Low |
| PHI in logs, URLs, titles, audit, error report | Problems carry code, line number, and column header only; messages never quote a cell; POST with the file in the body; uploaded file name never stored or logged; audit metadata is IDs and counts (batch ID, claim IDs, line counts, warning counts); the report CSV is built in the browser from those fixed strings; tests assert no MRN, claim number, code, or name in audit rows or problems | Low |
| Over-exposure inside the practice | Only admin, manager, specialist can import (compliance reads only), enforced in the action and the domain; refused attempts audited | Role matrix still an owner decision (OA-084) |
| Formula injection in the downloaded report | Cells pass through `csvCell`; the report holds only fixed text and numbers | Low |
| Unverified payer or missing coverage sneaks into submission | Draft only; the import warns; C3's 837P builder must still refuse an unverified payer and a patient with no mapped coverage | C3 |
| Sensitive services (Part 2, HIV, behavioral) visible in codes | None yet (same as C1) | **Blocking before real data** (R-3.5.1, R-4.5.1) |
| Malware in the upload | The file is never stored, executed, or opened by another program; parsed as text after a strict UTF-8 decode | Low (R-7.4.6) |
| CSRF on the import | The import is a Next.js server action: POST only, `Origin` checked against the host by the framework, session cookie `SameSite=Lax`; no GET route changes data | Low |
| Resource exhaustion, and holding the per-practice import lock | Per-practice rate limit `import_charges` (10 per 10 minutes), 2 MB / 5,000-row / 100-column / 50-line caps, linear in-memory parse, one transaction; the advisory lock is per practice and released at commit or rollback; refusals audited (`security.rate_limited`) | A practice can still use its own allowance; another practice is never affected |
| Existence oracle inside the practice (a row error says whether an MRN, payer, provider, or claim number exists) | Only signed-in importers of that practice can ask (RLS, role check); errors name a row and a code, never the value; a patient-existence answer is what the person needs to fix the file | **Accepted**: within one practice the biller may learn that an MRN exists |
| Template route `GET /api/claims/charge-template` | Requires a session and `canImportCharges` (404 otherwise); returns the header row only, no data | Low |

**Info: the claim number.** It is stored in `claims.claim_number` without field-level encryption and shown in the practice's claim lists and pages. It must never carry a member ID, SSN, or other identifier (CLAUDE.md #6). The importer cannot enforce that: any 1 to 30 character letters-and-digits string passes. The import page says so, and OA-084 asks which PM export supplies the file so its identifier can be checked.

**Info: the synthetic marker.** Claim numbers must start `SYN-` (as monthly-file account numbers do); the synthetic data generator's own claim numbers start `CLM-SYN-`, so a file built from generator output needs `SYN-` numbers. Documented in the spec rather than accepting both prefixes.
