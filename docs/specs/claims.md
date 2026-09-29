# Spec: Claims module

Status: in progress — C1 approved by delegated technical authority (2026-09-26); C2 approved by delegated technical authority (2026-09-29)
Roadmap items: Phase 1 → Claims ("Claim data model with immutable version history", "Charge capture
via CSV import", "Timely-filing guardrail", "837P generation and clearinghouse submission",
"999 / 277CA acknowledgment capture")
Requirement IDs: R-3.10.1, R-3.10.3, R-3.1.5, R-3.1.1, R-5.1.2, R-7.2.4, R-7.4.6, R-7.4.8, R-7.5.1, R-15.1, §8.2

## Goal
Billing staff can see every claim the practice has, know which unsubmitted claims are close to
losing their filing window, correct a draft or rejected claim with a recorded reason, and see
the full, unchangeable history of every edit. Later phases add charge import and electronic
submission.

## Phases
| Phase | Scope | Roadmap item |
|---|---|---|
| **C1** (done) | Claims list, claim detail, immutable version history, correcting draft/rejected claims, timely-filing warnings | Claim data model; Timely-filing guardrail (warn) |
| **C2** (this PR) | Charge capture via CSV import → draft claims (synthetic-only guard as in revenue cycle imports) | Charge capture via CSV import |
| C3 | 837P generation and clearinghouse stub submission; submission **blocked** past the filing deadline unless an admin records an exception reason. Also blocked when the patient's member ID is null or unmapped (see note below) | 837P; Timely-filing guardrail (block) |
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

## C2 — Charge capture via CSV import

Approved by delegated technical authority (2026-09-29). Built on the C1 claim model; no new table,
no migration, no grant.

### Goal
A biller exports the day's or week's charges from the practice-management system, uploads one CSV,
and gets **draft claims** in `/claims`, or a row-by-row report of what to fix with nothing imported.
Every created claim starts its immutable version history (version 1) and is audited. Patients and
payers must already exist: the import matches them, it never creates or changes them.

### The file
One CSV, UTF-8, one row per **claim line**. Rows with the same `Claim number` are the lines of one
claim; the claim-level columns (`MRN`, `Payer`, `Service date`, `Diagnosis codes`, and `Provider NPI`
and `Location` when present) repeat on every line and must be identical. Header matching is case- and
punctuation-insensitive, as in the monthly file (`src/domain/revenue-cycle/monthly-file.ts`). Columns
not listed here are ignored and never stored (patient names, member IDs, and free text in an export
are not needed and not kept).

| Column | Required | Rule |
|---|---|---|
| `Claim number` | yes | The practice's own claim or charge identifier; becomes `claims.claim_number`. 1–30 characters: letters, digits, `.`, `_`, `-`. Never an insurance member ID (member IDs need field-level encryption, CLAUDE.md #6). Synthetic-only environments: must start `SYN-`. |
| `MRN` | yes | Matched exactly (trimmed) to `patients.mrn` in the practice. Synthetic-only environments: must start `SYN`, the same rule as the patient form. |
| `Payer` | yes | Matched to the practice's payer catalog by name (trimmed, case-insensitive, `resolvePayerByName`). Blank is an error, never self-pay. |
| `Service date` | yes | `YYYY-MM-DD` or `M/D/YYYY`; a real date on or after 2000-01-01 (`MIN_SERVICE_DATE`) and not after today. |
| `Diagnosis codes` | yes | 1–12 ICD-10-CM codes separated by spaces, commas, or semicolons. |
| `Procedure code` | yes | CPT/HCPCS, five letters or digits. |
| `Modifiers` | no | Up to four two-character modifiers, same separators. |
| `Units` | yes | Whole number 1–999. |
| `Charge` | yes | The line's total charge in dollars, $0.01–$99,999.99 (the C1 per-line limit), at most two decimals. |
| `Provider NPI` | no | Ten digits, matched to a provider of the practice; blank uses the form's default provider. |
| `Location` | no | Matched to a location of the practice by name (trimmed, case-insensitive); blank uses the form's default location. |

A claim's billed amount is the sum of its line charges. Claims are created `draft`, `electronic`, with
no payer receipt date and no payment. A claim can have at most 50 lines (⚠️ VERIFY with
`edi-x12-specialist`: the 837P professional service-line limit; needed before C3).

### Acceptance criteria (C2)
- [x] **Upload page.** (It says that the claim number is stored without field-level encryption and
      must never hold a member ID, SSN, or other identifier; the parser can't enforce that.) `/claims/import` (breadcrumb Claims / Import charges; an "Import charges"
      button in the `/claims` header for roles that may import) shows the column contract, a
      header-only template download, the default provider and default location (required), the
      synthetic attestation checkbox (synthetic-only environments), and the file input. Without
      permission the page says so and links back to `/claims`.

- [x] **Roles.** Only `admin`, `manager`, and `specialist` (the people who bill, R-5.1.2; the same set
      as `canCorrectClaims`) can import; `compliance` reviews only. Enforced in the server action, not
      only by hiding the button; a refused attempt is audited.

- [x] **Rate limit.** `import_charges`, per practice: 10 attempts per 10 minutes (`src/lib/rate-limit.ts`).
      Each import parses up to 5,000 rows, reads the practice's patients and claims, and holds the
      practice's import lock while it writes; the limit bounds that, and the refusal is a plain message.
- [x] **Upload limits and checks.** CSV only, at most 2 MB, 5,000 data rows, and 100 columns; UTF-8
      only; parsed in memory by `src/lib/csv/parse.ts`; never written to disk or object storage. An
      empty, mis-named, oversize, or non-UTF-8 file is refused before anything is read, with a plain
      message. (No attachment malware scan: the file is never stored or opened by another program;
      R-7.4.6.)

- [x] **Synthetic-only guard** (the marker rule is `SYN-` for claim numbers, as for account numbers in
      the monthly file; the synthetic data generator's own claim numbers start `CLM-SYN-`, so a file built
      from generator output must use `SYN-` claim numbers, and the message says so. Accepting both
      prefixes would put a second English word into every translated message; not done). Wherever `syntheticDataOnly()` is true (everything but production off
      Netlify) the attestation checkbox is required, every `Claim number` must start `SYN-`, and every
      `MRN` must start `SYN`; a row that doesn't is a row error and nothing is imported.

- [x] **Per-row validation.** Every rule in the table above is checked for every row. The file is
      **all or nothing**: if any row has an error, no claim is created. Errors carry a stable code,
      the physical line number (as in a spreadsheet or editor), and the column name; messages never
      quote a cell value.
- [x] **Lines are never merged twice.** Rows are grouped by claim number, so the parser refuses what
      would silently double a claim: a line whose procedure code and modifiers (compared sorted, as in
      the duplicate rule below) already appear on the same claim is `duplicate_line`, and a claim
      number that returns after other claims is `claim_rows_not_contiguous` (reported once per claim).
      A file pasted twice, or two overlapping exports, is therefore refused whole; nothing is merged or
      summed. A claim has one date of service, so the date is not part of a line's key. A legitimate
      repeat service on one claim (the same code and modifiers twice) can't be imported yet; whether it
      needs an override is the existing owner question OA-084.

- [x] **Patient match.** By MRN within the practice (RLS-scoped read). A patient synced from an EHR
      (`patients.source = 'fhir'`) is matched only: the import never inserts, updates, links, or
      un-merges a patient, and imports no patient write path. An MRN with no patient is the row error
      `patient_not_found`; the import never creates patients. Warnings, not errors: the patient has no
      coverage on file (member ID null; the C3 837P refusal still applies), and the patient is
      inactive, merged, or gone at the source (`source_status` set).

- [x] **Payer match.** Against the practice's own payer catalog only (`payers`, this tenant). No match
      is `payer_not_found`; two payers that can't be told apart (same name, same verification state)
      is `payer_ambiguous`; the import never creates a payer. An unverified payer (no EDI payer ID or
      regime, `isPayerVerified`) is allowed for a draft and reported as a warning; C3 still refuses to
      submit it.

- [x] **Codes are stored as given.** CPT/HCPCS, modifiers, and ICD-10-CM codes are format-checked with
      the same patterns as the C1 correction form (`CPT_HCPCS`, `MODIFIER`, `ICD10CM`, exported from
      `src/domain/claims/correction.ts`) and stored exactly as they appear in the file, after trimming
      whitespace and splitting the list. The importer never upper-cases, pads, strips a decimal point,
      reorders, de-duplicates, adds, or replaces a code (CLAUDE.md #8, R-3.10.1); a lower-case code is a
      format error the person fixes in the file. Validity against licensed code sets stays out of scope,
      as in C1.

- [x] **Dates of service and timely filing (warn only).** For every created claim the C1
      `filingStatus` (rules engine: `fl.timely_filing.initial`, `medicare.timely_filing`, by the payer's
      regime) is computed as of today. Claims past deadline, due within 30 days
      (`FILING_WARNING_DAYS`), with no filing rule configured, or with an unverified payer are counted in
      the result and never block the import. Boundary tests: deadline tomorrow, today, and yesterday. A
      future date of service, or one before 2000-01-01, is a row error.

- [x] **Money.** Charges are parsed by the strict `parseMoney` into integer cents (no floating point
      anywhere) in the range 1–9,999,999 cents per line; a claim's `billed_cents` is the exact sum of its
      lines. A malformed amount ("1,2,3", three decimals, "(5)", blank, zero, negative, or over the
      limit) is a row error.

- [x] **Duplicate detection.** (a) *Re-uploading the same file*: every claim number in the file already
      exists, so the whole file is refused once with `already_imported` and nothing else is listed.
      (b) *A row matching an existing claim*: its claim number already exists (`claim_number_exists`),
      or another claim of the same patient and payer with the same date of service has at least one
      procedure code **with the same modifiers** in common (`matches_existing_claim`); claims in any
      status count, since a corrected or reissued claim is C3/Appeals work, not a charge import.
      (c) Two claims in the file that match each other the same way are `matches_claim_in_file`.
      Duplicates are errors, not silent skips, so a changed charge is never dropped unseen: an existing
      claim is corrected through the C1 form, with a reason. Imports for one practice are serialized (an
      advisory lock) so two uploads can't both pass the check; if a claim number is still taken between
      the check and the insert (a unique-index conflict), nothing is imported and the page says so
      (audited as `conflict`). There is deliberately **no file-hash table** (a new table needs a database grant, which
      needs R-15.9 owner sign-off); the claim number is the idempotency key. See open questions.

- [x] **Draft claims through the C1 domain.** Created by `createDraftClaims` in
      `src/domain/claims/versions.ts` (next to `correctClaim`), in one transaction: the claim (status
      `draft`, version 1), its lines, and its version-1 snapshot (`snapshotOf`), with `changed_by` the
      importing user and the fixed reason `charge_import` (shown as "Created by charge import" in the
      claim history, in the user's language). The C1 database triggers apply unchanged. Nothing but the
      person's file decides a code, a date, or an amount.

- [x] **Audit.** `claim.import_completed` once per import (entity type `claim_import`, entity ID a
      batch ID that is also in each claim's event): counts only, namely rows, claims, lines, and warnings
      by kind. `claim.created` once per claim (entity = the claim ID; metadata: batch ID, line count,
      version 1); the function that creates the claims writes it, so no caller can create a claim without
      it. A refused import writes `claim.import_rejected` with a fixed reason code (`forbidden`,
      `upload_check`, `encoding`, `validation`, `duplicate`, `conflict`, `error`), the counts of rows and
      problems, and an attempt ID as the entity ID (`error` is any other database failure, written before it
      is rethrown). A rate-limited attempt writes `security.rate_limited` instead. Audit metadata and logs never hold an MRN, claim number, code, date, amount, patient or
      payer name, or file name. The patient read used for matching is covered by the import event.

- [x] **No PHI in logs, URLs, or titles.** The import is a POST (server action) with the file in the
      body; results and errors never appear in a URL or the page title; the uploaded file name is not
      stored or logged.

- [x] **Error report.** On refusal the page lists the first 20 problems (row, column, message) and
      offers **Download report (CSV)** with every problem up to 1,000 (`Row,Column,Code,Message`),
      built in the browser from the action's response. It holds row numbers, header names, fixed codes,
      and fixed sentences, never a cell value. Beyond 1,000 the report says how many more there are.
      Cells are formula-safe (`csvCell`).

- [x] **Result.** On success the page shows claims, lines, and total billed created, the warning counts
      (past deadline, due within 30 days, no filing rule, unverified payer, no coverage on file), and
      links to `/claims` (unsubmitted, by filing deadline) and to its past-deadline filter.

- [ ] **Tests.** Unit: parser (every column rule, header aliases, grouping, claim-field mismatch, line
      cap, limits, synthetic guard, codes untouched, money edge cases), matching (payer resolution and
      ambiguity, duplicate rules with and without modifiers), warning classification with boundary dates,
      permission, message keys in en/es/pt, the fixture file. Integration (Postgres): import creates
      claims with version 1 and audit; all-or-nothing on one bad row; a synced patient is never created
      or changed; another practice's patients, payers, providers, and claims are invisible to the import
      (tenant isolation); duplicate cases; the same file twice; audit rows hold no row content.
      Also (fix round): duplicate and non-contiguous lines, a synced patient (`source = 'fhir'`, coverage
      `none`, inactive at the source: warnings counted, row unchanged), the server action (refused attempts
      audited, conflict, database error, rate limit), and the rate-limit bucket.
      Status: CI ran the first integration file green; the fix-round tests await a CI run, and the
      coordinator confirms this box.

- [x] Every new string is a key in English, Spanish, and Portuguese. The Spanish and Portuguese are
      agent-written and unreviewed by a native speaker (OA-041).

- [x] Docs: roadmap line, this spec, and `docs/PROJECT_STATE.md`. `docs/data-sources.xlsx` is unchanged:
      the CSV comes from the practice's own PM system, not a new integration.

### Data / API changes (C2)
- **No table, migration, grant, or policy.** `claims`, `claim_lines`, and `claim_versions` already
  allow the app role to insert and read (C1). Idempotency comes from the unique
  `(tenant_id, claim_number)` index plus the match rules above.
- New audit actions `claim.created`, `claim.import_completed`, `claim.import_rejected`, and entity
  type `claim_import`.
- Server action `importCharges` (`src/app/(app)/claims/import/actions.ts`); route handler
  `GET /api/claims/charge-template` (header row only; signed-in importers; no data).
- `canImportCharges(role)` in `src/auth/permissions.ts`.
- Pure module `src/domain/claims/charge-file.ts` (parse and validate); `src/domain/claims/charge-import.ts`
  (match, duplicate check, create, audit).

### Legal rules used (C2)
Only through C1's `filingStatus`: `fl.timely_filing.initial` and `medicare.timely_filing`, both ⚠️ VERIFY
(counsel). The 30-day window is a display setting. C2 restates no deadline or threshold.

### Out of scope (C2)
- Creating patients or payers, and editing synced patients (never, by design).
- Updating or voiding existing claims through a file, and importing corrected or void claims (frequency
  7/8).
- Diagnosis pointers per line (C3's 837P builder decides how they are derived, with a person's
  choice), rendering-provider taxonomy checks, place of service, NDC, and prior-authorization numbers.
- XLSX/ODS uploads (needs a vetted parser dependency), EHR-fed charge capture (HL7 v2 / FHIR), and
  manual claim entry.
- X12 formatting (C3): the 837P writes ICD-10 diagnosis codes without the decimal point. That is a
  change of representation, not a change of the code, and must stay a pure, reversible formatting step in
  the builder that never alters which code is billed (R-3.10.1).
- Charge validation against a fee schedule or contract (a later underpayment item) and scrubbing rules
  (NCCI, MUE, LCD/NCD): nothing here changes or "fixes" a code.

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
- Adding or removing claim lines (the app role can't delete lines; how lines are voided is still open).
- Creating claims by hand. Submission and blocking (C3). Acknowledgments (C4). (CSV import is C2, below.)
- Timely-filing exceptions (retro eligibility, COB) — needs counsel input; C3.
- ⚠️ C3 note (patient-integrations PI1a, `docs/specs/patient-integrations.md`): once a practice has
  an EHR/PM connection, `patients.member_id_enc`/`member_id_last4` are nullable and null unless
  `coverage_status` is `mapped` or `unmapped` — a synced patient can have no member ID on file yet,
  or one the sync team hasn't reviewed. The 837P builder (edi-x12-specialist) must refuse to
  generate a claim for a patient whose member ID is null or whose `coverage_status` isn't `mapped`,
  with a clear "no payer coverage on file for this patient" refusal, rather than emitting an 837P
  with a blank/placeholder subscriber ID (837P loop 2010BA `NM109`).
- Corrected/void claims to the payer (frequency 7/8) — Appeals phase.
- Code validity against licensed code sets (AMA CPT license, CMS ICD-10 files) — format only today.

## Before real data (from the C1 compliance review)
- `claim_versions` snapshots copy diagnosis and procedure codes that can be sensitive (HIV, SUD,
  behavioral health); sensitivity tagging and masking must cover snapshots and the history diff
  (R-3.5.1, R-4.5.1).
- Retention / legal-hold path for the append-only history (R-9.2.1).
- Whether a date-of-service correction that clears a past-deadline warning needs manager review.

## Open questions
- C2: should a `claim_imports` table (file SHA-256, counts, importer, time) be added so "the same file
  twice" is detected by file identity and the import history is listable? It needs a new table and so a
  `GRANT` to `denialdesk_app` (R-15.9 owner sign-off). C2 works without it (claim numbers are the key) but
  cannot detect a re-upload whose claim numbers were all changed. (owner, OA-083)
- C2: is a same-patient, same-payer, same-day, same-code-and-modifiers row always a duplicate, or does
  the practice need an override for a legitimate repeat service? C2 refuses with no override. ⚠️ VERIFY
  with the practice's coding lead; the importer makes no claim about what a modifier means. (owner)
- C2 (owner, OA-084): who counts as a "biller"? C2 uses admin, manager, and specialist, like C1 corrections.
- C2: one claim is created per `Claim number`; is a split of one PM encounter into several claims (per
  payer) needed in the file? (owner, OA-084)
- Which Florida timely-filing exceptions (§ 627.6131(2)) must the C3 block honor? (counsel)
- Should Medicare Advantage use the plan contract's filing window (payer setup) — assumed yes.
- PIP (Fla. Stat. § 627.736(5)(c)), workers' comp, and Medicaid filing limits are not in `rules/`
  yet; the UI says "no filing rule configured", never that none exists. (florida-rules-engine + counsel)
- `fl.timely_filing.initial` cites § 627.6131(2) for HMO claims too; confirm § 641.3155. (counsel)
- Is timely filing met when the claim is sent or when the payer receives it? Submitted claims
  without a receipt date keep showing the deadline until C4. (counsel)
