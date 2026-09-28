# Threat model: field-encryption AAD binding and re-encryption job (SC-B7.1)

Scope:
- `src/lib/crypto/field.ts` and `aad.ts`
- the member ID and TOTP readers and writers
- `src/domain/crypto/reencrypt.ts`
- `scripts/reencrypt-fields.ts`
- `POST /api/preview/reencrypt`

Design: ADR 0011. Spec: `docs/specs/field-encryption-aad.md`.

Data:
- Member IDs are Restricted PHI.
- TOTP secrets are credentials (Secret).
- Record IDs and counts are Internal.

## Data flow
**Write.** The domain code builds the AAD from the session tenant and the database record ID, then
calls `sealField`, which produces `v2.<kid>.…`. The row is written under RLS for patients, or
through `systemDb()` for users.

**Read.** The prefix picks the path: `v2` is opened with AAD, and `v1` is opened only under the
column's legacy policy. A failure is audited and returns a generic message.

**Job.**
1. It lists tenant IDs.
2. For each tenant, under RLS, it locks one bounded batch of rows that are not yet `v2` at the
   active key.
3. For each row it decrypts in memory, reseals, and writes back with a compare-and-swap.
4. It writes one audit event per batch with IDs only.
5. `--verify` reports counts per column.

## STRIDE

| # | Threat | Control | Residual risk / owner |
|---|---|---|---|
| S1 | Anyone holding `SEED_TOKEN` triggers the job | The endpoint runs only when `syntheticDataOnly()` is true. It is rate-limited, audited (`trigger: preview_endpoint`), and returns counts only. It can only reseal existing plaintext in place. | Pre-production only. The token is shared, as for the seed endpoint (`docs/runbooks/netlify.md`). |
| T1 | A ciphertext is copied to another row, patient, user, or tenant by someone with database write access | GCM with AAD `<scope>\|<field>\|<record>`. The tenant comes from the session, not the row. Decryption fails closed and is audited as `security.field_integrity_failed`. | Closed for `v2` values. |
| T2 | Downgrade: a `v2` value is replaced with a `v1` ciphertext that has no AAD | Production refuses `v1` for these columns from day one. After the cut-off, the code refuses `v1` and a CHECK constraint (`NOT LIKE 'v1.%'`) blocks it. The version prefix decides the path, with no fallback. | Pre-production until PR 5 (synthetic data). |
| T3 | The job writes a wrong value, or overwrites a concurrent edit | The job reseals exactly the plaintext it decrypted. Batches use `FOR UPDATE SKIP LOCKED` plus a compare-and-swap on the old ciphertext. Tests cover the round trip and a concurrent edit. | Low |
| T4 | The job bypasses the synced-patient read-only rule | The job never updates `source = 'fhir'` rows; it counts them as `blocked`. The `patients_synced_readonly` trigger is unchanged. | Low |
| R1 | A conversion or a failed decrypt goes unrecorded | One `security.field_reencrypted` event per batch, in the same transaction (HC-5.2), with record IDs. `security.field_integrity_failed` per bad row. `security.field_formats_verified` for evidence. | The job principal is not a person. The trigger (CLI or endpoint) is recorded; the human who started it is not identified. |
| I1 | Plaintext leaks through logs, errors, output, or audit | Plaintext stays in memory within one row's scope. Logs carry event names and counts. Errors are typed codes with IDs. Responses carry counts only. Tests scan audit metadata and output for the synthetic values. | Low |
| I2 | Old `v1` ciphertexts remain in backups and WAL | Pre-production and synthetic only. Production never holds `v1`. | Accepted (synthetic) |
| I3 | Key material is reused across purposes | Out of scope: `src/lib/rate-limit.ts` salts with `FIELD_ENCRYPTION_KEY`. | Open question 6 in the spec |
| D1 | The job loads the database or locks out users | Bounded batches (at most 200), `SKIP LOCKED`, a time budget per endpoint call, and rate limiting. | Low |
| D2 | An unreadable legacy value locks a user out, or hides a member ID | Fails closed with a generic message. Recovery is MFA reset or re-entering the member ID (runbook). | Acceptable: this is the intended hard failure |
| E1 | The job runs with more privilege than it needs | Patients: `denialdesk_app` under RLS (`withTenantAsSystem`), with no BYPASSRLS. Users: the same `systemDb()` access the auth code already uses; a test asserts that only `totp_secret_enc` changes. No new GRANT or SECURITY DEFINER. | Owner database role (an existing open decision) |

## Blocking before real data
- Key Vault keys, the retrieval model, separation of duties, and the rotation runbook are set in the
  Azure cutover ADR. The same gap is listed in `custom-field-values.md`.
- The cut-off (PR 5) has merged, and `--verify` shows zero `v1` rows in every environment that is
  kept.
