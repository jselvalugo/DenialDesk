# Threat model: field-encryption AAD binding and re-encryption job (SC-B7.1)

Scope:
- `src/lib/crypto/field.ts` and `aad.ts`
- the member ID, TOTP, and custom-field readers and writers
- `src/domain/crypto/reencrypt.ts`
- `scripts/reencrypt-fields.ts`
- `POST /api/preview/reencrypt`
- the boot checks in `src/lib/env.ts` and `src/instrumentation.ts`

Design: ADR 0011. Spec: `docs/specs/field-encryption-aad.md`. Revised 2026-09-29 after agent review.

Data:
- Member IDs are Restricted PHI.
- TOTP secrets are credentials (Secret).
- Record IDs, cursors, and counts in command and endpoint output are Internal.
- Audit rows take the audit log's classification and controls (HC-5.3, HC-5.4).

## Data flow
**Write.** The domain code builds the AAD from the session tenant and the database record ID, then
calls `sealField`. It counts the seal (`nextval`) and produces `v2.<kid>.…` with AAD
`v2|<kid>|<scope>|<field>|<record>`. The row is written under RLS for patients and custom fields, or
through `systemDb()` for users.

**Read.** The prefix picks the path: `v2` is opened with AAD, and `v1` is opened only under the
column's legacy policy. A failure returns a typed result. The caller audits it in the same
transaction (or through `auditSystem()` on sign-in, which has no transaction) and returns a generic
message.

**Job.**
1. An operator starts it with `--operator` and `--reason` (CLI), or through the endpoint with the
   same fields in the body.
2. It lists tenant IDs.
3. For each column and tenant, under RLS, it locks one bounded batch of rows after the cursor that
   are not yet `v2` at the active key, excluding `source = 'fhir'`.
4. For each row it decrypts in memory, checks the last 4 characters for member IDs, reseals, and
   writes back with a compare-and-swap.
5. It writes one audit event per batch, in the batch's transaction, with IDs only.
6. The pass ends when a batch returns fewer than `limit` rows.
7. `--verify` reports counts per column and the active key-check value.

## STRIDE

| # | Threat | Control | Residual risk / owner |
|---|---|---|---|
| S1 | Anyone holding `SEED_TOKEN` triggers the job | The endpoint returns `404` when `isProduction()`, and boot refuses `SEED_TOKEN` under `APP_ENV=production` whatever `onNetlify()` says. It is rate-limited, audited (`trigger: preview_endpoint`), and returns counts only. It can only reseal existing plaintext in place. | Pre-production only. The token is shared, as for the seed endpoint (`docs/runbooks/netlify.md`), so the `operator` it records is self-asserted. Gone if the owner chooses re-seed (spec, open question 2). |
| S2 | `onNetlify()` (true when any of `NETLIFY`, `NETLIFY_DB_URL`, `DEPLOY_ID`, or `SITE_ID` is set) unlocks legacy reads or the endpoint under `APP_ENV=production` | Legacy reads, the endpoint, and the boot refusals test `isProduction()`, never `syntheticDataOnly()`. Tests set `SITE_ID` under production. | Low |
| T1 | A ciphertext is copied to another row, patient, user, or tenant by someone with database write access | GCM with AAD `v2\|<kid>\|<scope>\|<field>\|<record>`. The tenant comes from the session, not the row; the record comes from the database row, lowercased. Decryption fails closed and is audited as `security.field_integrity_failed`. | Closed for `v2` values. |
| T2 | Downgrade: a `v2` value is replaced with a `v1` ciphertext, or its header is relabeled | The header is inside the AAD, so a relabeled version or `kid` fails for every column, including custom fields, whose `v1` values use `k1` and ADR 0007 AAD. Legacy reads need `FIELD_LEGACY_V1_READ=on`, a non-production `APP_ENV`, and a date before the hard-coded expiry. After the cut-off, an allow-list CHECK (`^v2\.[a-z0-9]{1,16}\.`) blocks every other value. There is no fallback. | Pre-production until PR 5, or the expiry date (synthetic data). |
| T3 | The job writes a wrong value, overwrites a concurrent edit, or launders a swapped value | The job reseals exactly the plaintext it decrypted. Batches use `FOR UPDATE SKIP LOCKED` plus a compare-and-swap on the old ciphertext. For member IDs, a plaintext whose last 4 characters differ from `member_id_last4` is not converted and is audited; this catches a ciphertext swapped on its own, not one swapped together with `member_id_last4`. Tests cover the round trip, a concurrent edit, and a swapped row. | TOTP secrets have no check value, so a swapped `v1` secret would be resealed under the victim's ID (pre-production only). Wipe and re-seed removes it (open question 2). |
| T4 | The job bypasses the synced-patient read-only rule | The SQL selector excludes `source = 'fhir'` rows. `--verify` counts them as `blocked`. The `patients_synced_readonly` trigger is unchanged. | Low |
| T5 | The key under `k1` is changed silently (the environment variable is replaced), so `k1` now labels a different key | No key-ID variable; `k1` is a constant. The boot check compares a per-`kid` key-check value and refuses on mismatch. | A missing KCV only warns outside production, until the operator sets it. |
| R1 | A conversion or a failed decrypt goes unrecorded | One `security.field_reencrypted` event per batch, inserted in the batch's transaction (HC-5.2; never `auditSystem()`). A failed audit insert rolls the batch back, and a test proves it. `security.field_integrity_failed` is recorded once per failing row per run, and it commits on reveal because readers return typed failures instead of throwing. `security.field_formats_verified` is written for evidence. | — |
| R2 | The human who ran the job is not identified | The CLI requires `--operator` and `--reason`. The event records `metadata.principal = field-reencrypt`, `metadata.operator`, and `reason`; `actorUserId` is null. | The operator name is self-asserted, and a CLI run has no IP or device. Blocking before production (below). |
| R3 | SIEM misses integrity failures because two event names exist | One name, `security.field_integrity_failed`, for every column from PR 2 on. The alert rule also matches the historical `custom_field.value_integrity_failed`. | There is no SIEM until the Azure cutover (HC-5.3 known gap). |
| I1 | Plaintext leaks through logs, errors, output, or audit | Plaintext stays in memory within one row's scope. Logs carry event names and counts. Errors are typed codes with IDs. Responses carry counts and a cursor only. Tests scan audit metadata and output for the synthetic values. | Low |
| I2 | Old ciphertexts remain in backups, WAL, point-in-time copies, or append-only history | A retired key stays decrypt-only while anything may reference its `kid`. Destroying a key is a disposal action: a legal-hold check plus Security Officer and Privacy Officer sign-off (HC-10.1, HC-10.2). No key is destroyed before the legal-hold capability exists. | Pre-production `v1` backups are synthetic. Backup retention periods are an open question (OA-082). |
| I3 | Key material is reused across purposes | Out of scope: `src/lib/rate-limit.ts` salts with `FIELD_ENCRYPTION_KEY`. | Open question 6 in the spec (OA-081) |
| I4 | A key exceeds the random-IV usage limit (IV collision breaks GCM) | A durable per-`kid` sequence counts every seal, including rolled-back ones. Rotate at 2^30 or annually. Per-tenant HKDF subkeys are an option for the cutover ADR. | Low |
| D1 | The job loads the database, locks out users, or never finishes | Bounded batches (at most 200), `SKIP LOCKED`, and a keyset cursor, so rows left in place are not re-selected in the same run. The pass ends at a short batch with an explicit `done`/`next = null`. The endpoint has a time budget per call and rate limiting. | Low |
| D2 | An unreadable legacy value locks a user out, or hides a member ID | Fails closed with a generic message. Recovery is MFA reset or re-entering the member ID (runbook). | Acceptable: this is the intended hard failure |
| E1 | The job runs with more privilege than it needs | Patients: `denialdesk_app` under RLS (`withTenantAsSystem`), with no BYPASSRLS. Users: the same `systemDb()` access the auth code already uses; a test asserts that only `totp_secret_enc` changes. The only new GRANT is `USAGE` on the counter sequence (R-15.9 sign-off). No SECURITY DEFINER. | Owner database role (an existing open decision) |
| E2 | A crafted `kid` resolves to an object prototype property | The keyring is a `Map`; `constructor` and similar names are refused. | Low |
| E3 | The key leaves the platform to run the CLI on shared data | The CLI is never run against the shared pre-production database from a workstation (SC-B7.3); pre-production uses the endpoint or a re-seed. | Low |

## Blocking before real data
- Key Vault keys, the retrieval model, separation of duties, where the key-check value lives, and
  the rotation runbook are set in the Azure cutover ADR. The same gap is listed in
  `custom-field-values.md`.
- The cut-off (PR 5) has merged, and `--verify` shows zero `v1` rows in every environment that is
  kept.
- **Job attribution in production.** Before any production run, the person who starts the job and
  their IP or device are captured and recorded with the run (HC-5.1), for example through the
  authenticated identity that starts the Azure worker. A self-asserted `--operator` is not enough.
- **Key retirement.** Backup and point-in-time retention periods are known, a legal-hold check
  exists (R-9.2.1), and key destruction has a Security Officer and Privacy Officer sign-off step.
- SIEM alerting covers `security.field_integrity_failed` and `custom_field.value_integrity_failed`
  (HC-5.3, R-7.5.3).
