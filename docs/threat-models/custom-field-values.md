# Threat model: custom field values (Settings S2)

Scope: table `custom_field_values` (drizzle/0025), `src/domain/custom-fields/values.ts`,
record forms and detail pages for patients, claims, and denials (done; payers still open); the
"Open" reveal action. Spec: `docs/specs/settings-and-custom-fields.md`. Design: ADR 0007.
Data: values on patients, claims, denials are **Restricted PHI** of unknown content; values on
payers are Internal (but encrypted the same way, one code path). Definitions (`custom_fields`)
remain Internal configuration.

## Data flow
Admin defines field -> user submits record form (server action, origin-checked) -> domain
validates against the active definition -> `encryptField(serialized, aad)` -> insert/update row
under tenant RLS -> audit (field keys/IDs only). Read: record page loads values -> non-sensitive
decrypted and rendered; sensitive rendered as mask -> "Open" posts reason -> server decrypts one
value -> audit -> value returned for that view only (client state, never cached or in URL).

## STRIDE

| # | Threat | Control | Residual risk / owner |
|---|---|---|---|
| S1 | Spoofing: non-member or wrong role opens a value | Session auth; server action re-checks role; reveal limited to the roles that may reveal member IDs (R-5.1.2); specialists without record access get 404 | Low |
| S2 | Spoofing: forged cross-site form post | Server actions only (Next.js origin check); no GET mutations | Low |
| T1 | Tampering: value written to a record in another tenant | FORCE RLS `tenant_id = app_current_tenant()`; trigger checks the target record and the field are in the same tenant and the field's `entity` matches the FK column set | FKs bypass RLS, hence the trigger; composite `(tenant_id,id)` FKs remain the deferred project-wide item |
| T2 | Tampering: ciphertext swapped between rows/tenants by a DB-level writer | GCM with AAD `tenant_id|field_id|record_id`; decrypt fails closed and the UI shows "Value unavailable" (audited as `custom_field.value_integrity_failed`, IDs only) | Owner DB role can still delete rows (separate DB roles: open decision) |
| T3 | Tampering: value of wrong type, oversized, or to an inactive/choice-not-listed field | Domain validation per type (text <= 200, long text <= 4,000, number finite and <= 15 significant digits, ISO date, boolean, choice must be a current option); inactive fields refused on write; DB CHECK on `length(value_enc) <= 8192` | Low |
| T4 | Tampering: stale overwrite | Patient values: saved in the same transaction as the record, under the record's `expectedUpdatedAt` check. Claim/denial values (PR 3, their own "edit custom fields" page, which never touches the claim/denial row): `saveValuesForRecord` first locks the record's own row (`lockRecordRow`, `SELECT ... FOR NO KEY UPDATE` — a `SELECT`, so it never fires `claims_require_version` or any other row trigger), which also confirms the record exists in this tenant, refusing a bad or cross-tenant id cleanly instead of surfacing a raw database trigger error later; only then, in a later statement (now guaranteed to see any transaction that already committed), does it read and compare a values-table concurrency token (`customFieldValuesToken`, count + latest `updatedAt` over the record's `custom_field_values` rows, stamped from the database's own `clock_timestamp()` rather than app or transaction-frozen clocks) against the token the edit page loaded. Without locking the record's row first, a `SELECT ... FOR UPDATE` over zero or few existing rows locks nothing, so two concurrent first saves could both pass an identical token — covered by an integration test with two real connections. | Low |
| R1 | Repudiation: who changed or opened a value | `custom_field.values_updated` (entity, recordId, changed field keys, and `patientId` when the record belongs to one) is the record of every custom-field save, for every entity — a separate event from the record's own update audit, since a claim/denial custom-field save touches no `claims`/`denials` column and so emits no `claim.updated`/`denial.updated` event at all; `custom_field.value_revealed` with field ID, record ID, entity, reason; `updated_by`/`updated_at` on the row | Low |
| I1 | Disclosure at rest (DB, backups, WAL, replicas) | Every value AES-256-GCM encrypted in the app (ADR 0007); no plaintext column; DB storage encryption (Azure) on top | Key in env for pre-prod; Key Vault in production (ADR 0002) |
| I2 | Disclosure of sensitive values in the UI | Fields with `sensitivity` render masked (fixed-width dots, no length hint) with "Open"; reason required (`appeal`, `eligibility`, `payer_call`, `other`); value held in component state for that view only; never pre-rendered in HTML/RSC payload | Shoulder surfing after opening: accepted |
| I3 | Disclosure via lists, search, exports, snapshots | List/search/export queries never join `custom_field_values` (lint-level test asserts); only detail pages load values; sensitive values not decrypted on load at all; test snapshots use synthetic values and never sensitive ones. Record-list columns (PR 2, spec addendum): a separate module `src/domain/custom-fields/list-values.ts` is the only exception, and its own query filters to `sensitivity IS NULL AND show_in_list` — a sensitive field can never reach it; for patients it also joins `patients` and keeps only records with no sensitivity tags (I7), so a tagged record shows no values in the list at all; and a DB check (`custom_fields_show_in_list_not_sensitive`, migration 0036) forbids marking one `show_in_list` even if the app check is bypassed; a guard test asserts the module's filter is present | Future features must keep this; noted in spec "Out of scope" |
| I4 | Disclosure in logs, URLs, audit, errors | Values never in audit metadata (keys/IDs only), URLs, or thrown messages; validation errors name the field label, not the value; DB errors sanitized (ADR 0006) | Low |
| I5 | Admin labels invite PHI ("Patient's HIV status") or free text is used for identifiers | Form warning (S1); values encrypted regardless of label; sensitivity category available | Users may still put a member ID in a non-sensitive text field: encrypted at rest but shown unmasked. Accepted by owner 2026-09-26 |
| I6 | Field marked non-sensitive later exposes previously protected values | Changing/removing `sensitivity` already audited with both values (S1); only administrators | Accepted: deliberate, audited admin act |
| I7 | Patient-level sensitivity tags (e.g., Part 2 record) vs. non-sensitive custom fields, including through a claim or denial that belongs to that patient (PR 3) | Values on a patient with any sensitivity tag render masked as well, using the same reveal; `recordIsSensitive` (`custom-fields/values.ts`) resolves this inside the module for claim (claim -> patient) and denial (denial -> claim -> patient) too, never trusted from the caller; the record list (I3) excludes tagged patients' claims and denials from its values query the same way | Low |
| D1 | DoS: many values or huge payloads | Max 50 active fields per type (S1); value size caps; body size limit on server actions | Low |
| E1 | Elevation: non-admin changes definitions to reach values | Definitions admin-only (S1); values writable by roles that may edit the record, readable by roles that may view it | Role/field matrix is an open project decision |
| E2 | Deletion to hide history (R-9.2.1) | No DELETE grant; clearing sets `value_enc` NULL and is audited | Owner DB role (open decision) |

## Blocking before real data
- Key management in Azure Key Vault and rotation runbook (shared with member IDs).
