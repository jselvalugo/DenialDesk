# ADR 0011: Every encrypted field binds AAD; a `v2` envelope with a key ID tells new from legacy

Status: Proposed (2026-09-28, architect). Closes `docs/SECURE_CODING.md` known gap SC-B7.1 once
built. Spec `docs/specs/field-encryption-aad.md`; threat model
`docs/threat-models/field-encryption-aad.md`. Extends ADR 0007 and does not replace it.

## Context
SC-B7.1 requires AES-256-GCM with a fresh random 96-bit IV per value, with tenant, field, and
record bound as AAD, so a ciphertext copied to another row or tenant fails to decrypt. HC-7.3 and
R-7.3.3 require field-level encryption for member IDs. HC-7.4 and R-7.3.4 require annual key
rotation with keys held in Key Vault in production.

`src/lib/crypto/field.ts` writes `v1.<iv>.<tag>.<ct>` (base64url parts, one key from
`FIELD_ENCRYPTION_KEY`, `src/lib/env.ts`). ADR 0007 added an optional `aad` argument, but the
format stays `v1` either way. So nothing in a stored value says whether it was sealed with AAD.

Call-site inventory (2026-09-28, `grep encryptField|decryptField`):

| Call site | Op | Column | AAD today |
|---|---|---|---|
| `src/domain/patients/queries.ts:346` `createPatient` | encrypt | `patients.member_id_enc` | **No** |
| `src/domain/patients/queries.ts:421`, `:423` `updatePatient` (new ID; clear to `""`) | encrypt | `patients.member_id_enc` | **No** |
| `src/domain/patients/queries.ts:555` `revealPatientMemberIdFor` | decrypt | `patients.member_id_enc` | **No** |
| `src/app/(app)/denials/[id]/actions.ts:185` `revealMemberId` | decrypt | `patients.member_id_enc` | **No** |
| `src/app/(app)/appeals/[id]/actions.ts:210` `revealMemberId` | decrypt | `patients.member_id_enc` | **No** |
| `src/db/seed.ts:256` `seedPractice` | encrypt | `patients.member_id_enc` | **No** |
| `src/auth/enrollment.ts:19`, `:23` `pendingEnrollmentSecret` (practice users and the operator) | decrypt, encrypt | `users.totp_secret_enc` | **No** |
| `src/auth/credentials.ts:174` `claimTotp`, reached from practice sign-in (`src/auth/actions.ts:147`), operator sign-in (`src/auth/operator-actions.ts:193`), and step-up (`src/app/(app)/step-up/actions.ts:86`) | decrypt | `users.totp_secret_enc` | **No** |
| `src/domain/custom-fields/values.ts:404`, `:505`, `:611`, `:670` | decrypt, encrypt | `custom_field_values.value_enc` (history rows are copied into `custom_field_value_versions.value_enc` unchanged, `:583`) | Yes, `tenant_id\|field_id\|record_id` |
| `src/domain/custom-fields/list-values.ts:118` | decrypt | `custom_field_values.value_enc` | Yes (a duplicate `aadFor`) |
| `test/e2e/global-setup.ts:51`, `:72`, `:103` (operator) | encrypt | `users.totp_secret_enc` | No |
| `test/integration/step-up-session.test.ts:157` | encrypt | `users.totp_secret_enc` | No |
| `test/integration/patients.test.ts:100`, `:204` | decrypt | `patients.member_id_enc` | No |
| `test/integration/custom-field-values.test.ts:765`, `:810`, `:817` | both | custom field values | Yes |

Not field-encryption call sites, checked:
- `src/auth/operator-account.ts:289` and `src/db/demo.ts:105` only set `totp_secret_enc` to NULL, which forces re-enrollment.
- Integration signing keys are not stored in the database. Pre-production reads
  `INTEGRATION_SIGNING_KEY` from the environment; production will use non-exportable Key Vault keys,
  and `integration_connections.key_ref` holds only a reference (ADR 0010).
- No bank account or routing numbers are stored (`src/db/schema.ts`, the comments on the remittance
  and deposit tables). SSN and MBI are not stored: an MRN shaped like either is refused
  (`docs/specs/patient-integrations.md`).
- `src/lib/rate-limit.ts:48` reuses `FIELD_ENCRYPTION_KEY` as a SHA-256 salt. This is key reuse
  across purposes. It is not in scope here, but it matters for rotation (open question in the spec).
- No code looks up, sorts, or enforces uniqueness on a member ID ciphertext, and there is no blind
  index. Patient search matches name and MRN only (`queries.ts:106-136`). `member_id_last4` is a
  plaintext display suffix.

## Decision

### 1. Envelope `v2`
- **Format:** `v2.<kid>.<iv>.<tag>.<ct>`.
  - `kid` is plain text matching `[a-z0-9]{1,16}`.
  - `iv` is 12 random bytes, `tag` is 16 bytes, and `ct` is the ciphertext, each base64url.
  - The parser is strict. It requires exactly 5 parts, a known `kid`, a 12-byte IV, and a 16-byte tag.
- **Every new write is `v2`**, for every column. AAD is mandatory. The TypeScript signature takes
  a branded `FieldAad` that only the builders in `src/lib/crypto/aad.ts` can produce, so a missing
  AAD is a compile error.
- **The version prefix alone picks the decrypt path.** There is no trial decryption and no
  fallback. For example, a `v2` value that fails authentication is never retried as `v1`.
- `v1` stays readable only as the column's registered legacy format (section 3).
- The `kid` makes rotation a change of the active key, not a new format version. During this
  migration there is one key, with `kid` `k1`: the current `FIELD_ENCRYPTION_KEY`. `v1` values are
  defined as sealed with `k1`. No rotation may happen until the legacy cut-off (section 4).

### 2. AAD bytes
AAD is the UTF-8 encoding of `<scope>|<field>|<record>`, with no whitespace and no trailing
separator. This is ADR 0007's three-part shape, unchanged.
- `<scope>` and `<record>` are canonical lowercase UUIDs. The builders reject anything else. They
  receive IDs from database rows or the verified session, never raw request input.
- The envelope version and `kid` are not part of the AAD. A relabeled version or key ID already
  fails GCM authentication, because the decrypt runs with a different key or a different AAD.

| Column | `<scope>` | `<field>` | `<record>` |
|---|---|---|---|
| `patients.member_id_enc` | `tenant_id`, taken from the session or job tenant, not from the row | `patients.member_id` | `patients.id` |
| `users.totp_secret_enc` (practice users **and** the platform operator) | literal `global` | `users.totp_secret` | `users.id` |
| `custom_field_values.value_enc` and `custom_field_value_versions.value_enc` | `tenant_id` | `custom_fields.id` (ADR 0007) | the record's ID |

- **Why TOTP uses the `global` scope.**
  - `users` is a global identity table with no `tenant_id` and no RLS.
  - A user can belong to several practices (`memberships` is unique on `(tenant_id, user_id)`), and
    the operator has no practice at all (`src/auth/operator-account.ts` refuses a practice account).
  - Binding a tenant would break sign-in to a user's other practices.
  - Binding "operator vs practice" would tie the ciphertext to `PLATFORM_OPERATOR_EMAIL`
    configuration, not to a column.
  - The user ID alone already makes the secret non-transferable. An operator secret copied into a
    practice user's row, or the reverse, fails to decrypt.
- **Why built-in field names are dotted names.** Custom-field `<field>` values are UUIDs, so the two
  namespaces cannot collide.

### 3. Legacy (`v1`) read policy, per column
The meaning of `v1` is known for each column from the inventory above. It is not guessed from the
value.
- **`patients.member_id`, `users.totp_secret`:** `v1` means sealed without AAD.
  - The read path is allowed only while the transition is open **and** `syntheticDataOnly()` is true.
  - Production (`isProduction() && !onNetlify()`) refuses `v1` from the first release of this
    change, because production holds no data yet.
  - After the cut-off, `v1` is refused everywhere with a typed `LegacyFieldFormatError`, before any
    decrypt is attempted.
- **Custom field columns:** `v1` means sealed with ADR 0007 AAD. This already meets SC-B7.1 and
  stays readable. New writes are `v2`.
  - History rows are append-only (no UPDATE grant, plus an immutability trigger in `drizzle/0027`),
    so they are not rewritten.
  - How they are handled at key rotation is left to the rotation ADR.

### 4. Migration: expand, convert, contract
1. **Readers first.** All decrypt sites go through `openMemberId`, `openTotpSecret`, and
   `openField`, which read `v2` and read `v1` under the policy in section 3. No data changes.
2. **Writers second.** All encrypt sites write `v2`. Reverting this step is safe, because the
   readers from step 1 still read `v2`.
3. **Batch re-encryption job** (`src/domain/crypto/reencrypt.ts`).
   - **Selector.** Rows whose column is not `v2.<active kid>.`. The selector is the checkpoint, so
     the job is resumable and idempotent with no state table.
   - **Patients pass.**
     - Runs per tenant as `denialdesk_app` under RLS (`withTenantAsSystem`).
     - Each batch is `ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED`, with a default of 100 rows and a
       maximum of 200 (SC-B5.4).
     - Each row is decrypted, resealed, and written back with a compare-and-swap on the old
       ciphertext. `updated_at` is not touched.
     - One audit event per non-empty batch, in the same transaction, lists the record IDs and never
       values (HC-5.1–5.3).
   - **Users pass.** The same steps through `systemDb()`, as the auth code already does, because
     `users` has no tenant and no RLS, and the app role cannot read `totp_secret_enc` (`drizzle/0002`).
   - **Synced patients.** `patients_synced_readonly` (`drizzle/0040`) forbids changing
     `member_id_enc` on `source = 'fhir'` rows outside a sync run.
     - The job never touches those rows. It counts them as `blocked`.
     - `blocked` must be 0. It is 0 today, because no sync writer exists yet, and it stays 0 because
       the PI2b sync writer must use `sealMemberId`.
   - **Why not SQL.** This cannot be a SQL migration: the key must never reach the database (HC-7.4).
4. **Verify.** `--verify` reports counts per column: `v1`, `v2` at the active `kid`, `v2` at other
   keys, `blocked`, and `unparseable`. Only counts are reported.
5. **Cut-off (contract).**
   - Delete the no-AAD branch and the old `encryptField`/`decryptField` exports.
   - Add `CHECK (<col> IS NULL OR <col> NOT LIKE 'v1.%')` on `patients.member_id_enc` and
     `users.totp_secret_enc`. This migration fails if any legacy row remains, so the migration
     itself is the final gate.
   - After this, a `v1` member ID or TOTP secret is a hard failure: an audited integrity error, a
     generic message key, and fail-closed sign-in. It never silently falls back.

### 5. Keys and rotation
- **Usage limit.** NIST SP 800-38D §8.3 limits a key used with random 96-bit IVs to 2^32
  encryptions (⚠️ VERIFY exact wording at build). Rotate annually (HC-7.4), or earlier when an
  audit-derived estimate of encryptions under the active `kid` reaches 2^30.
- **Rotation procedure.** Add a new active `kid`, keep old keys as decrypt-only, run the same job,
  verify, then retire the old key.
- **Pre-production.** One Netlify environment key (the HC-7.4 gap stays open).
- **Azure cutover.** Production gets fresh keys created in Key Vault, with a new `kid` such as `az1`.
  The Netlify key is never reused. Production starts empty, so nothing is re-encrypted at cutover.
  The retrieval model (secret vs HSM-wrapped data key), the Key Vault SDK (R-15.7), separation of
  duties, and the rotation runbook belong to the cutover ADR.

## Consequences
- **No new dependency.** `node:crypto` only (SC-A1.2).
- **No GRANT, REVOKE, SECURITY DEFINER, trigger, or audit-table change**, so no R-15.9 sign-off is
  needed. The one migration adds CHECK constraints on `patients` and `users`.
- **Patient IDs are generated in the app.** `createPatient` must generate the patient ID before the
  insert (`randomUUID()`), because the AAD needs it. The seed already generates IDs this way
  (`idFor`).
- **Ciphertext is never copied.** A future patient merge, tenant move, or re-link that must carry a
  member ID decrypts under the old AAD and reseals under the new one. A copied ciphertext fails, and
  tests prove it.
- **Member ID lookup needs a new ADR.** No search by member ID remains possible. A future 835
  NM109 or "find by member ID" feature would need a tenant-keyed HMAC blind index and a new ADR.
- **Transition residual risk.** Until the cut-off, someone with database write access could replace
  a value with another row's legacy `v1` ciphertext, and it would decrypt. This affects
  pre-production only (synthetic data). Production refuses `v1` from day one.
- **Old ciphertexts in backups.** Pre-production backups and WAL keep old `v1` ciphertexts until
  they age out. This is synthetic data only.
