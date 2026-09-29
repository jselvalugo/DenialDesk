# Spec: Claims module

Status: in progress — C1 approved by delegated technical authority (2026-09-26); C2 approved by delegated technical authority (2026-09-29); C3a approved by delegated technical authority (2026-09-29); C3a-S approved by delegated technical authority (2026-09-29)
Roadmap items: Phase 1 → Claims ("Claim data model with immutable version history", "Charge capture
via CSV import", "Timely-filing guardrail", "837P generation and clearinghouse submission",
"999 / 277CA acknowledgment capture")
Requirement IDs: R-3.10.1, R-3.10.2, R-3.10.3, R-3.1.5, R-3.1.1, R-5.1.2, R-7.2.4, R-7.3.3, R-7.4.6, R-7.4.8, R-7.5.1, R-7.9.5, R-15.1, §4.1, §8.2

## Goal
Billing staff can see every claim the practice has, know which unsubmitted claims are close to
losing their filing window, correct a draft or rejected claim with a recorded reason, and see
the full, unchangeable history of every edit. Later phases add charge import and electronic
submission.

## Phases
| Phase | Scope | Roadmap item |
|---|---|---|
| **C1** (done) | Claims list, claim detail, immutable version history, correcting draft/rejected claims, timely-filing warnings | Claim data model; Timely-filing guardrail (warn) |
| **C2** (done) | Charge capture via CSV import → draft claims (synthetic-only guard as in revenue cycle imports) | Charge capture via CSV import |
| **C3a** (this PR) | 837P (005010X222A1) generation from one claim, validation with plain refusals, preview and download of the file (test indicator `T`, synthetic only). No submission, no clearinghouse. | 837P generation |
| C3b | Clearinghouse interface and stub submission (R-7.9.5); submission **blocked** past the filing deadline unless an admin records an exception reason. Also blocked when the patient's member ID is null or unmapped (C3a already refuses to generate; see note below) | 837P submission; Timely-filing guardrail (block) |
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

- [x] **Tests.** Unit: parser (every column rule, header aliases, grouping, claim-field mismatch, line
      cap, limits, synthetic guard, codes untouched, money edge cases), matching (payer resolution and
      ambiguity, duplicate rules with and without modifiers), warning classification with boundary dates,
      permission, message keys in en/es/pt, the fixture file. Integration (Postgres): import creates
      claims with version 1 and audit; all-or-nothing on one bad row; a synced patient is never created
      or changed; another practice's patients, payers, providers, and claims are invisible to the import
      (tenant isolation); duplicate cases; the same file twice; audit rows hold no row content.
      Also (fix round): duplicate and non-contiguous lines, a synced patient (`source = 'fhir'`, coverage
      `none`, inactive at the source: warnings counted, row unchanged), the server action (refused attempts
      audited, conflict, database error, rate limit), and the rate-limit bucket.
      Status: CI green on f3b233a, integration and e2e included (confirmed by the coordinator).

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

## C3a — 837P generation

Approved by delegated technical authority (2026-09-29). Built on the C1 claim model and the C2 draft claims.
**Nothing is sent anywhere**: C3a produces a file a person can preview and download. The clearinghouse
interface, submission, and the timely-filing block are C3b.

### Goal
From a draft or rejected claim, a biller produces a valid 837P professional claim (005010X222A1) for one
claim, or is told, in plain words and without any patient data in the message, exactly which required
piece is missing. The file is the claim as the person recorded it: every diagnosis, procedure code,
modifier, unit, and amount is copied as stored (R-3.10.1); the generator never adds, drops, reorders,
"fixes", or infers a code.

⚠️ VERIFY (owner, OA-089): the licensed 837P implementation guide (ASC X12 TR3 005010X222A1) is not in the
repository, and the mapping below is written from the `edi-x12-specialist`'s knowledge of it. Every row is
cited by loop and segment as the guide names them; the rows marked ⚠️ VERIFY are the ones not certain
(usage or code value). The whole table must be checked against the purchased guide and the chosen
clearinghouse's companion guide before the first real (`P`) file. Until then C3a only produces `T` files.

### Which claims, and what is refused
A claim can be generated only when **all** of these hold. Every failure is a refusal listing every problem
found (not just the first), each with a fixed code, the line number where it concerns a line, and never a
name, ID, code, date, or amount (R-7.4.6, CLAUDE.md #4). Nothing is written to the claim.

| Refusal code | When |
|---|---|
| `status_not_generatable` | Claim status is not `draft` or `rejected`. A `rejected` claim (a payer's front-end rejection: never adjudicated) is sent again as an original, frequency code 1 (⚠️ VERIFY with the payer's companion guide). Corrected and void claims (frequency 7 and 8) are the Appeals phase. |
| `not_synthetic_environment` | The environment is production (not `syntheticDataOnly()`): C3a has no real submitter or receiver identifiers, so it must not produce a `P` file. |
| `no_member_id` | The patient has no member ID on file: `member_id_enc` is null, or decrypts to an empty value (a manual patient with no insurance yet stores an empty encrypted value), or a synced patient's `coverage_status` is not `mapped` (`unmapped`, `needs_review`, `none`). "No payer coverage on file for this patient" (C1 note); no blank or placeholder ID is ever written to `NM109` of loop 2010BA. |
| `coverage_payer_mismatch` | The patient's primary payer (`primary_payer_id`, the payer the member ID belongs to) is not the claim's payer. C3a supports only the primary coverage; another payer's member ID is never sent. |
| `payer_not_verified` | The payer has no EDI payer ID (loop 2010BB `NM109`) or no regime. Both come from the verified payer catalog only. |
| `claim_filing_indicator_unmapped` | The payer's regime has no confirmed `SBR09` value (see the mapping table). |
| `billing_*` | Billing provider (loop 2010AA): `billing_npi` (not ten digits or failing the NPI check digit), `billing_name` (first and last), `billing_taxonomy` (format only), `billing_tin` (missing, not nine digits, or type unset), `billing_address` (line 1, city, state, ZIP+4), `billing_address_po_box`. |
| `subscriber_*` | Subscriber (loop 2010BA): `subscriber_name`, `subscriber_birth_date`, `subscriber_address` (line 1, city, state, ZIP of 5 or 9 digits). Sex is `F`, `M`, or `U` (unknown is sent as `U`). |
| `missing_place_of_service` | The claim's location has no two-digit place of service code. Format only; the code set is not enumerated here (CMS POS codes change; ⚠️ VERIFY by the practice). |
| `diagnosis_invalid` | No diagnosis, more than 12, or a code that is not ICD-10-CM shaped. |
| `diagnosis_pointers_required` | The claim has more than one diagnosis and no pointer choice was made for a line. Which diagnosis supports which service line is a coding decision: the file never guesses it (R-3.10.1). |
| `diagnosis_pointer_invalid` | A line's pointers are not 1–4 distinct numbers within the claim's diagnoses. |
| `lines_missing` / `lines_too_many` | No lines, or more than 50 (⚠️ VERIFY: the 837P allows 50 service lines per claim). |
| `line_invalid` | A procedure code, modifier (max 4), units, or charge is not in the C1 shape, or units are not 1–999. |
| `billed_mismatch` | Total charge is not the exact sum of the line charges. |
| `invalid_character` | A name or address holds a character X12 can't carry (a separator `* ~ : ^`, a control character, or a letter that stays non-ASCII after removing accents). The text is never altered beyond upper-casing and removing accents (`É` becomes `E`); the refusal names the field, not the value. |
| `control_number_exhausted` | The practice's control number sequence passed 999,999,999. Never wraps. |

Frequency code is `1` only. Diagnosis pointers are numbers `1`–`12` referencing the order of the claim's
diagnosis list, whose first entry is the principal diagnosis (`ABK`); the C1 correction form keeps that order.

### Mapping (837P to 005010X222A1)
Sources: `claims`, `claim_lines`, `patients`, `providers`, `locations`, `payers`. "Guide" is the loop and
segment as the implementation guide names it. Separators: element `*`, repetition `^`, component `:`,
segment `~`. All text is upper-cased and accents are removed; nothing else is changed.

| Guide loop · segment | Element(s) written | Source · rule |
|---|---|---|
| Interchange · ISA | ISA01 `00`, ISA02 ten spaces, ISA03 `00`, ISA04 ten spaces | No authorization or security information. ⚠️ VERIFY (clearinghouse companion guide) |
| ISA | ISA05 `ZZ`, ISA06 sender ID (15, right-padded), ISA07 `ZZ`, ISA08 receiver ID (15, right-padded) | Pre-production: fixed synthetic identifiers (`SYNTHETIC_ENVELOPE`), never a real one; an ID longer than 15 characters is refused, never truncated. Real identifiers come from clearinghouse enrollment in C3b (DS-03). ⚠️ VERIFY |
| ISA | ISA09 `YYMMDD`, ISA10 `HHMM` (Eastern, the practice time zone), ISA11 `^`, ISA12 `00501`, ISA13 control number (9 digits), ISA14 `0`, ISA15 `T`, ISA16 `:` | ISA13 from the practice sequence. ISA15 is `T` in every environment C3a runs in (synthetic-only guard). ISA14 `0` (no interchange acknowledgment requested; the 999 arrives anyway) ⚠️ VERIFY |
| Functional group · GS | GS01 `HC`, GS02/GS03 codes as ISA06/ISA08 (trimmed), GS04 `CCYYMMDD`, GS05 `HHMM`, GS06 = ISA13 value (nine digits with leading zeros; ⚠️ VERIFY that the receiver accepts leading zeros), GS07 `X`, GS08 `005010X222A1` | |
| Transaction set · ST | ST01 `837`, ST02 = control number (at least four digits), ST03 `005010X222A1` | One ST per file, so ST02 is unique in the group by construction and, being the same sequence, per practice. |
| Beginning of hierarchical transaction · BHT | BHT01 `0019`, BHT02 `00`, BHT03 = control number (9 digits), BHT04 `CCYYMMDD`, BHT05 `HHMM`, BHT06 `CH` | `00` original, `CH` chargeable |
| 1000A Submitter name · NM1, PER | `NM1*41*2*<name>*****46*<id>`; `PER*IC*<contact>*TE*<phone>` | Pre-production synthetic constants (see ISA). `PER` is required in the guide. ⚠️ VERIFY (real values: C3b) |
| 1000B Receiver name · NM1 | `NM1*40*2*<name>*****46*<id>` | Same |
| 2000A Billing provider HL · HL, PRV | `HL*1**20*1`; `PRV*BI*PXC*<taxonomy>` | `providers.taxonomy`. `PRV` is situational in the guide (required when the payer needs the taxonomy); always sent. ⚠️ VERIFY |
| 2010AA Billing provider name · NM1 | `NM1*85*1*<last>*<first>****XX*<NPI>` | The claim's provider (`providers`): an **individual** (type 1) NPI billing for their own services, so the rendering-provider loop 2310B is not written (the guide omits it when rendering = billing). A group billing NPI (type 2) with a separate rendering provider is not modelled yet, open question 4. |
| 2010AA · N3, N4 | `N3*<line1>`; `N4*<city>*<state>*<ZIP+4>` | `providers.address_line1`, `city`, `state`, `postal_code`. The guide requires the billing address to be a street address (no P.O. box) and a nine-digit ZIP. ⚠️ VERIFY |
| 2010AA · REF | `REF*EI*<TIN>` or `REF*SY*<TIN>` | `providers.tin_enc` decrypted in memory; `tin_type` `EI` (EIN) or `SY` (SSN). |
| 2000B Subscriber HL · HL, SBR | `HL*2*1*22*0`; `SBR*P*18*******<SBR09>` | Patient = subscriber (`18` self) and primary payer (`P`): the data model has one member ID per patient (patients P2). A dependent of a different subscriber is not supported (open question 5). SBR03/SBR04 (group) left empty. No 2000C loop (`HL04 = 0`). |
| 2000B · SBR09 (claim filing indicator) | one code | By the payer's regime: `fl_insurer` `CI`, `fl_hmo` `HM`, `medicare` `MB`, `medicaid_ffs` `MC`, `workers_comp` `WC`. `medicare_advantage`, `erisa_self_funded`, `smmc`, `pip` are **refused** until the owner confirms the value (open question 6). ⚠️ VERIFY all five |
| 2010BA Subscriber name · NM1 | `NM1*IL*1*<last>*<first>****MI*<member ID>` | `patients.last_name`, `first_name`; member ID decrypted in memory, never logged. Medicare's MBI is sent with qualifier `MI`. ⚠️ VERIFY |
| 2010BA · N3, N4 | `N3*<line1>`; `N4*<city>*<state>*<ZIP>` | `patients.address_line1`, `city`, `state`, `postal_code` (5 or 9 digits) |
| 2010BA · DMG | `DMG*D8*<CCYYMMDD>*<F, M or U>` | `patients.birth_date`, `sex` |
| 2010BB Payer name · NM1 | `NM1*PR*2*<payer name>*****PI*<payer ID>` | `payers.name`, `edi_payer_id`. Payer address (N3/N4) is situational and not written. |
| 2300 Claim information · CLM | `CLM*<claim number>*<total>***<POS>:B:1*Y*A*Y*Y` | CLM01 `claims.claim_number` (patient control number, at most 38 characters; C1's are at most 30); CLM02 exact decimal string from integer cents (always two decimals, so `125.00`; ⚠️ VERIFY that trailing zeros are accepted, the guide allows omitting them); CLM05-1 `locations.place_of_service`, CLM05-2 `B` (professional POS qualifier), CLM05-3 frequency `1`. CLM06 `Y`, CLM07 `A`, CLM08 `Y`, CLM09 `Y` are the practice's attestations (signature on file, assignment accepted, benefits assigned, release of information) and are constants until a practice setting exists. ⚠️ VERIFY (owner, OA-089) |
| 2300 · HI | `HI*ABK:<dx1>*ABF:<dx2>*...` | Up to 12; `ABK` principal (first), `ABF` others. Codes as stored **without the decimal point** (next section). |
| 2400 Service line · LX | `LX*<n>` | Counts 1 to n in `claim_lines.line_number` order; the claim's own numbers are not copied |
| 2400 · SV1 | `SV1*HC:<code>:<mod>:<mod>:<mod>:<mod>*<charge>*UN*<units>***<pointers>` | SV101-1 `HC`, procedure code and modifiers exactly as stored; SV102 exact decimal, two decimals (⚠️ VERIFY trailing zeros, as CLM02); SV103 `UN`; SV104 units; SV107 pointers such as `1:2`. Anesthesia-style minute units (`MJ`) are not modelled. ⚠️ VERIFY |
| 2400 · DTP | `DTP*472*D8*<CCYYMMDD>` | `claims.service_date` on every line |
| Trailer · SE, GE, IEA | `SE*<segments ST..SE inclusive>*<ST02>`; `GE*1*<GS06>`; `IEA*1*<ISA13>` | Computed, and re-checked by a round-trip test |

Not written in C3a (situational in the guide, no data modelled): 2310A referring provider, 2310B rendering
provider, 2310C service facility (⚠️ VERIFY: the guide requires it when the place of service address differs
from the billing address), 2300 prior authorization (`REF*G1`), referral, onset and accident dates, NDC,
`PWK` attachments, claim notes, other subscriber (2320), and the pay-to address (2010AB).

### Codes are copied exactly
The ICD-10-CM decimal point is not carried in X12. `E11.9` is written `E119`. That is a change of
representation, not of the code: the only transformation is deleting one `.`, and `restoreIcd10Decimal`
proves it reversible (a test round-trips every fixture code). Procedure codes, modifiers, units, dates, and
amounts are copied without any change. The generator never upper-cases a code, pads, re-orders,
de-duplicates, or substitutes, and a code that isn't shaped correctly is refused, not repaired
(CLAUDE.md #8, R-3.10.1, R-3.10.2). It writes the claim as it is now; the audit event records the claim's
version number.

### Control numbers
Every generation takes one number from a per-practice sequence, stored as the `practice_settings` row
`x12_control_number` (an existing table, tenant-isolated by RLS, on which the app role already holds
`SELECT, INSERT, UPDATE`, so this PR adds **no table and no GRANT**). One atomic
`INSERT ... ON CONFLICT (tenant_id, key) DO UPDATE ... RETURNING` increments it, so two concurrent
generations can't get the same number. ISA13, GS06, ST02, and BHT03 all carry it (ISA13 nine digits, ST02
at least four). Numbers start at 1, are never reused, and gaps are allowed (a generated file the person
doesn't use still consumed one). It stops at 999,999,999 with `control_number_exhausted`; it never wraps.
A dedicated sequence table would be cleaner and is an owner choice because it needs a GRANT (R-15.9, OA-090).

### Synthetic-only guard
`ISA15` is `T` in every environment where `syntheticDataOnly()` is true (everything except production off
Netlify), and `T` is the only value the generator can write in C3a. In production the service refuses with
`not_synthetic_environment`: the submitter and receiver identifiers are synthetic constants, and a `P`
file carrying them must never exist. C3b replaces the constants with the practice's clearinghouse enrollment
values (credentials from Azure Key Vault, never code or env files, R-7.9.5) and enables `P`.

### The screen
On `/claims/[id]`, for `admin`, `manager`, and `specialist` (the same set as `canCorrectClaims`; compliance
reviews only, R-5.1.2) and only while the claim is `draft` or `rejected`, a panel **Electronic claim (837P)**
offers **Generate 837P**. When the claim has more than one diagnosis the panel first asks, per line, which
diagnoses (up to four) the line points to. On success it shows the control number, the segment count, a
scrollable preview in which the member ID and TIN are masked, and **Download file**
(`837p-<control number>.x12`, built in the browser from the action's response). A refusal shows every problem
as a fixed sentence. If the claim is past its filing deadline the panel says so (C3b blocks submission; C3a
only warns, open question 2). The action is a POST (server action): nothing about the claim appears in a
URL, title, or log, and each press consumes one control number.

### Acceptance criteria (C3a)
Approved by delegated technical authority (2026-09-29).

Ticked items have passing unit tests. Unticked items have their tests written (`test/integration/claim-837p.test.ts`,
`claim-837p-action.test.ts`) but not yet run: the agent that built C3a had no database access, so they wait for the
CI run of `pnpm test:integration`.

- [x] **Pure generator.** `src/edi/x12/837p.ts` builds one 837P (one ST, one 2000A, one 2000B, one 2300, up
      to 50 2400 loops) from plain data with no I/O and no clock (the time and control number are inputs), and
      `validate837P` returns every refusal in the table above with a code, never a value. Same tokenizer and
      conventions as the 835 (`src/edi/x12/segments.ts`, CCYYMMDD dates, integer cents to a decimal string with no
      floating point).
- [x] **Structure round trip.** A test tokenizes the output and checks `SE01` equals the number of segments from
      `ST` to `SE` inclusive, `SE02 = ST02`, `GE02 = GS06`, `IEA02 = ISA13`, ISA is exactly 106 characters with the
      terminator at position 105, and the HL hierarchy (`HL01` 1 and 2, `HL02` parent 1, `HL03` 20 and 22, `HL04`
      1 and 0), for one to 50 lines, with and without modifiers, with one to 12 diagnoses.
- [x] **Golden file.** `test/fixtures/synthetic/x12/837p-golden.x12` is the exact output for one fully synthetic
      claim (synthetic names, `SYN` identifiers, an address on a synthetic street, a test NPI with a valid check
      digit, a TIN in a made-up range), compared byte for byte, with a fixed time and control number.
- [x] **Codes untouched.** For every fixture diagnosis, procedure code, and modifier the output contains it
      unchanged (diagnosis without the decimal only), order preserved, none added or dropped;
      `restoreIcd10Decimal` reverses the only change; a lower-case, padded, or malformed code is refused, never
      repaired.
- [x] **Refusals.** One unit test per refusal code, including all problems reported together, the boundary cases
      (12 and 13 diagnoses, 50 and 51 lines, 4 and 5 modifiers, ZIP of nine digits, with a hyphen, and short, NPI
      check digit), and that no refusal holds a name, ID, code, date, or amount.
- [ ] **Coverage guard.** A patient with a null or empty member ID, a synced patient whose `coverage_status` is
      `unmapped`, `needs_review`, or `none`, and a claim whose payer is not the patient's primary payer are each
      refused, and the file never contains an empty or placeholder `NM109` in loop 2010BA.
- [ ] **Status.** Only `draft` and `rejected` generate; every other status is refused (`status_not_generatable`).
- [ ] **Control numbers.** ISA13, GS06, ST02, and BHT03 carry the same sequence value; two generations for one
      practice never repeat; two practices count independently (RLS); concurrent generations for one practice
      are distinct (integration); the sequence refuses at 999,999,999. No new table, no GRANT.
- [ ] **Synthetic-only guard.** `ISA15` is `T`; production refuses with `not_synthetic_environment` and does not
      consume a control number.
- [ ] **Encryption and PHI.** The status, coverage, and shape checks run first, and the member ID and TIN are decrypted only when they pass (a refused claim reads neither), only in memory inside the service call, a value that fails to decrypt is a refusal (`no_member_id` or `billing_tin`), never a 500; never
      logged, and never appear in an error, refusal, audit row, or the preview (masked); the file is returned to the
      signed-in user in the action's response and is never written to disk, object storage, or a log. The TIN is
      stored field-encrypted (`tin_enc`, AAD bound to practice, column, and provider), CLAUDE.md #6.
- [ ] **Roles and limits.** Only `canGenerateClaimFile` roles (admin, manager, specialist) can generate; enforced
      in the server action and again in the domain function; a refused attempt is audited (one row per attempt, capped per person at 30 per 10 minutes, past which it returns without a row). Rate limit
      `generate_837p`, per practice: 30 attempts per 10 minutes.
- [ ] **Audit.** `claim.837p_generated` (entity `claim`, claim ID) with metadata: patient ID (refusals that got as far as loading the claim carry it too), claim version,
      interchange control number, segment count, line count, usage indicator (`T`), pointer source
      (`single_diagnosis` or `user_selected`), and every PHI category read (`patient_name`, `birth_date`, `address`, `diagnosis_codes`, `procedure_codes`, and `member_id` and `tin` only when actually decrypted); reason
      `edi_generation`. `claim.837p_refused` with the refusal codes and their count. Neither ever holds segment
      contents, a code, a name, a member ID, or an amount. The PHI read (member ID decrypt) is covered by the
      same event (R-7.5.1).
- [ ] **Tenant isolation.** Integration: another practice's claim, patient, provider, payer, and control number
      are invisible to the service (a claim ID from practice B in practice A's session is "not found").
- [x] **i18n.** Every string on the panel and every refusal sentence is a key in English, Spanish, and Portuguese.
      The Spanish and Portuguese are agent-written and unreviewed by a native speaker (OA-041).
- [x] **Docs.** This spec, `docs/PROJECT_STATE.md`, `src/edi/README.md`, and owner rows OA-089 and OA-090.
      `docs/data-sources.xlsx` is unchanged (no integration is added in C3a; DS-03 stays "Needed").

### Data / API changes (C3a)
- **Migration `0046_claim_837p_billing_data.sql`**: nullable columns only, no new table, no policy change, **no
  GRANT** (`providers` and `locations` already carry the table-level grants from `0002_security.sql`, which cover
  new columns). `providers`: `first_name`, `last_name`, `address_line1`, `city`, `state`, `postal_code`,
  `tin_type` (`EI` or `SY`), `tin_enc`. `locations`: `place_of_service`. CHECK constraints on the shapes (ZIP,
  state, POS, TIN type present with the TIN). Existing rows stay null, so every existing provider and location
  refuses generation until its billing details are entered.
- The synthetic seed and generator fill the new columns with fully synthetic values.
- New audit actions `claim.837p_generated` and `claim.837p_refused`; `canGenerateClaimFile(role)` in
  `src/auth/permissions.ts`; rate-limit bucket `generate_837p`.
- Pure module `src/edi/x12/837p.ts`; domain service `src/domain/claims/edi-837p.ts`; server action
  `generateClaim837P` (`src/app/(app)/claims/[id]/edi-actions.ts`); panel `Claim837Form.tsx`.
- **Deferred to C3a-S (below)**: a settings page where an administrator enters a provider's billing details and TIN
  (step-up MFA) and a location's place of service. Until it ships, the values come from the synthetic seed or a
  change made by the platform operator in the database. The refusal tells the person what is missing.

### Legal rules used (C3a)
None. C3a states no deadline, rate, or threshold; the filing-deadline note on the panel is C1's `filingStatus`.

### Out of scope (C3a)
Clearinghouse interface and submission (C3b, R-7.9.5), the filing-deadline block and exception (C3b), several
claims per file, frequency 7 and 8, secondary and tertiary payers (2320), dependents, group billing with a
rendering provider (2310B), the 837I, production (`P`) files, attachments, NDC and prior authorization, code
validity against licensed code sets, and claim scrubbing (NCCI, MUE, LCD/NCD).

### Open questions (C3a)
1. (owner, OA-089) Supply the 837P TR3 and the clearinghouse companion guide so every ⚠️ VERIFY row can be cleared.
2. (owner) Should Download also be blocked past the filing deadline, or only submission (C3b)? C3a warns only.
3. (owner, OA-089) CLM06 to CLM09 attestations: does the practice hold a signature on file, accept assignment, and
   hold a release of information for every patient? C3a writes `Y`, `A`, `Y`, `Y` for all.
4. (owner) Does the practice bill under a group (type 2) NPI with rendering providers? It needs a second provider
   record per claim and loop 2310B.
5. (owner) Are dependents (the subscriber is not the patient) common enough that patients need a subscriber record?
6. (owner and edi-x12-specialist) `SBR09` for Medicare Advantage, ERISA self-funded, SMMC, and PIP payers, and a
   per-payer override.
7. (owner, OA-090) A dedicated control-number table (needs a GRANT) instead of the `practice_settings` row.
8. (owner) Persist the diagnosis pointer choice on the claim lines (through the C1 version trigger) so it is not
   asked at every generation.

### Blockers before C3b and before any real claim (C3a compliance review)
C3a is safe only because it is synthetic-only and refuses in production. These must be closed before C3b or any real
claim, and none is closed by C3a:
1. **Sensitive diagnoses.** Diagnosis and procedure codes can reveal HIV, substance use, or behavioral health. The file
   carries them unmasked, and no sensitivity tag (R-3.5.1) or 42 CFR Part 2 consent check applies to an outgoing claim yet.
2. **Diagnosis pointers are not persisted or audited as a decision.** The choice is asked at every generation, recorded
   only as `user_selected`, and never as which pointers a person chose or a claim version.
3. **Hard-coded attestations.** CLM06 to CLM09 (`Y`, `A`, `Y`, `Y`) are constants, not the practice's recorded attestations.
4. **Clearinghouse status and real downloads.** Whether generating standard transactions makes DenialDesk a HIPAA health care
   clearinghouse, and whether real claim files may ever be downloaded, are open (OA-091).

## C3a-S — Provider billing details

Approved by delegated technical authority (2026-09-29). Follow-up to C3a: without it only the synthetic seed can
supply the provider and location data the 837P generator needs (`billing_*` and `missing_place_of_service` refusals).
Requirements: R-3.10.1 (nothing here touches a code), R-7.2.2 and HC-4.2 (step-up), R-7.3.3 and HC-7.3 (field
encryption), R-7.5.1 and HC-5.1 to HC-5.3 (audit, IDs and field names only), R-7.2.4 (RLS), SC-B3.1 (validation).

### Goal
An administrator opens **Settings > Billing** and, for each existing provider, enters the name, address and tax ID (TIN)
the 837P loop 2010AA needs, and for each existing location its place of service, so a claim that uses them stops
refusing. It creates no provider and no location (the practice's providers and locations already come from onboarding
and the synthetic seed); it edits the C3a columns only. NPI and taxonomy are shown, not edited.

### Screens
- `/settings/billing`: two lists (providers, locations), bounded to 200 rows each, each row showing what is missing.
  A row is complete only with a nine-digit ZIP and a TIN that decrypts; the row names the missing fields. Checking the TIN
  decrypts it in memory and shows nothing, so the list view is audited (`phi` = `tin_readable_check`, with a count).
- `/settings/billing/providers/[id]`: the provider form. The TIN field is a masked (`password`) input that is always
  empty; beside it the page shows "TIN on file, ends in 1234, type EI" (the only read of the ciphertext, audited).
- `/settings/billing/locations/[id]`: the place-of-service form.

### Rules
- **Who.** `canConfigureSettings` (admin) only, on the pages, in the server actions, and again in the domain functions.
  Any other role is refused (and sees no Billing tab content).
- **Step-up.** Setting or changing a TIN, or changing the type of an existing TIN, requires `hasRecentMfa` (five minutes,
  R-7.2.2) read from the session, never the request. A refusal carries `stepUpRequired` and the form shows the
  `/step-up` link (`/settings/billing/providers/<id>` is an allowed `returnTo`). Saving the other fields needs no
  step-up. Clearing a stored TIN is not offered. Typing the TIN that is already stored is not a change (no write, no audit). A type-only
  change sets the type and leaves the ciphertext alone: the AAD binds tenant, column, and provider, not the type.
- **Write-only TIN.** It is never sent back to the browser, never in a form default, an error, a state object, a URL,
  a title, a log, or an audit row. The page only ever shows the last four digits.
- **Encryption.** The TIN is encrypted on write with `encryptProviderTin` (AES-256-GCM, AAD `tenant|providers.tin_enc|provider`)
  and stored with its type in one statement (`providers_tin_together`). It is never decrypted except for the last-four on
  the detail page and by the 837P service.
- **Validation** (allow-lists in the domain, a strict bounded Zod schema on the form fields in the action; same shapes as migration 0046, all server side, allow-lists):
  first name 1 to 35, last name 1 to 60, address line 1 to 55, city 1 to 30 characters; state two letters;
  ZIP five digits or nine (a hyphen after the fifth is allowed and dropped: `^[0-9]{5}(-?[0-9]{4})?$`); TIN type `EI` or
  `SY`; TIN exactly nine digits (hyphens and spaces typed between digits are dropped); place of service two digits.
  The billing address cannot be a P.O. box (the generator refuses it: `billing_address_po_box`). A five-digit ZIP is
  stored (the database allows it) but the 837P billing loop needs nine digits, so the field says so and the claim keeps
  refusing `billing_address` until a ZIP+4 is entered.
- **POS is format only.** ⚠️ VERIFY: two digits is all that is checked. Whether a code is a valid CMS place of service
  code (and valid for the service billed) is not checked; the CMS POS code set is not in the repository. (owner, OA-092)
- **X12-safe text.** Text fields are trimmed, accents removed, upper-cased and blanks collapsed, then must use only
  `A-Z 0-9 space & ' ( ) , . - / #`; anything else (a separator such as `*` `~` `:` `^`, a control character, a non-Latin
  letter) is refused with a message naming the field, never silently changed or dropped. The stored value is the cleaned
  value, so what the person sees is what X12 carries.
- **Audit** (same transaction as the change, HC-5.2): `settings.provider_billing_updated` (entity `provider`, provider ID;
  metadata `fields` = comma-separated column names that changed, `tin_changed` boolean, `step_up_verified_at` when a TIN
  changed), `settings.location_pos_updated` (entity `location`, `fields`), `settings.provider_billing_viewed` (entity
  `provider`, provider ID, `phi` = `tin_last4` only when a TIN was decrypted). Never a value, a name, an address, a
  TIN or its last four, or a POS code. A save that changes nothing writes nothing and audits nothing.
- **Tenant isolation.** Every query runs in `withTenant` (RLS); another practice's provider or location ID is "not
  found", with no audit row in either practice and no change.
- **Errors.** A database error is one generic message (ADR 0006); nothing from the database or the input reaches the page.
- **Strings.** Every label, hint, error, and notice is a message key in en, es, and pt (`settings` namespace, `billing.*`).

### Acceptance criteria (C3a-S)
Approved by delegated technical authority (2026-09-29).

Ticked items have passing unit tests. Unticked items have their tests written (`test/integration/billing-settings.test.ts`,
plus the pure checks in `src/domain/settings/billing.test.ts`) but not yet run: the agent that built C3a-S had no database
access, so they wait for the CI run of `pnpm test:integration`.

- [ ] **Admin only.** A manager, specialist, and compliance user are refused by the actions and the domain functions, on
      both providers and locations, and nothing is written or audited as a change.
- [ ] **Step-up.** Setting or changing a TIN, or its type, is refused without a recent MFA (`stepUpRequired`), boundary
      cases at the five-minute window; the same save without a TIN change succeeds without one; the refusal writes nothing.
- [ ] **Write-only TIN.** No page, state, error, or audit row holds the TIN; the detail page shows only "ends in" the last four.
- [ ] **Encryption round trip.** The stored `tin_enc` is not the TIN, decrypts to it with the provider's tenant and ID,
      and fails to decrypt for another provider or practice (AAD); the type and ciphertext are stored together.
- [ ] **Audit.** One event per change with field names only (asserted: no value appears in any event); a view event marks
      the `tin_last4` read; a no-op save writes none.
- [ ] **Validation matches the database.** State, ZIP (5, 9, hyphenated 9, and 4, 6, 8 digits refused), TIN type, TIN (8, 9,
      10 digits; hyphens; letters), POS (1, 2, 3 digits; letters), and text lengths at the limit and one over; each value
      the page accepts is accepted by the database CHECKs, and each it refuses would be refused by them or by the 837P
      generator.
- [x] **X12-safe text.** Lower case and accents are cleaned; `*`, `~`, `:`, `^`, control characters, and non-Latin letters are
      refused naming the field; a P.O. box is refused.
- [ ] **Tenant isolation.** Practice A cannot read, change, or audit practice B's provider or location by ID.
- [ ] **End to end.** A provider and location configured through the domain functions (as the actions call them) let the 837P
      service generate for a synthetic claim, with the TIN decrypted in the file, and a claim refuses `billing_tin`
      before and generates after.
- [x] **i18n.** Every string is a key in en, es, and pt (the message tests pass). Spanish and Portuguese are agent-written and unreviewed by a native speaker (OA-041).
- [x] **Docs.** This spec, `docs/PROJECT_STATE.md`, and owner row OA-092 (POS code set).

### Data / API changes (C3a-S)
No migration and no GRANT: migration 0046 already holds every column and CHECK, and `providers` and `locations` carry the
table-level grants from 0002. New audit actions and entity types `provider` and `location`; domain module
`src/domain/settings/billing.ts`; server actions in `src/app/(app)/settings/billing/actions.ts`; the `/settings/billing`
route `returnTo` for step-up (`src/auth/step-up-target.ts`); a Billing tab.

### Out of scope (C3a-S)
Creating, deactivating, or deleting a provider or location; editing NPI, taxonomy, or license; clearing a TIN; group (type 2)
billing and a rendering provider; validating a POS code against the CMS set; USPS address verification.

### Open questions (C3a-S)
1. (owner, OA-092) Supply the CMS place of service code set (and the practice's usual codes) so the format check can become a
   real check.
2. (owner, OA-097) Should changing the billing name or address (not only the TIN) also require a step-up? They go on every
   claim, so a wrong address misroutes payment, but they are business data, not a secret. C3a-S requires it for the TIN only.
3. Known gap, not closed here: the step-up that protects a TIN (which can be a sole proprietor's SSN) is TOTP, not the
   phishing-resistant MFA HC-4.2 asks of administrators (OA-063). It stays a go-live condition, as in the other step-up gated actions.

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
