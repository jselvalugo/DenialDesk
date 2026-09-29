# ADR 0011: Every encrypted field binds AAD; a `v2` envelope with a key ID tells new from legacy

Status: Proposed (2026-09-28, architect; revised 2026-09-29 after `reviewer`, `security-reviewer`,
and `compliance-checker` review). Closes `docs/SECURE_CODING.md` known gap SC-B7.1 once built. Spec
`docs/specs/field-encryption-aad.md`; threat model `docs/threat-models/field-encryption-aad.md`.
Extends ADR 0007 and does not replace it.

## Context
SC-B7.1 requires AES-256-GCM with a fresh random 96-bit IV per value, with tenant, field, and
record bound as AAD, so a ciphertext copied to another row or tenant fails to decrypt. HC-7.3 and
R-7.3.3 require field-level encryption for member IDs. HC-7.4 and R-7.3.4 require annual key
rotation with keys held in Key Vault in production.

`src/lib/crypto/field.ts` writes `v1.<iv>.<tag>.<ct>` (base64url parts, one key from
`FIELD_ENCRYPTION_KEY`, `src/lib/env.ts`). ADR 0007 added an optional `aad` argument, but the
format stays `v1` either way. So nothing in a stored value says whether it was sealed with AAD.

Call-site inventory (2026-09-29, after PR #102;
`grep encryptField|decryptField|encryptProviderTin|decryptProviderTin`):

| Call site | Op | Column | AAD today |
|---|---|---|---|
| `src/domain/patients/queries.ts:346` `createPatient` | encrypt | `patients.member_id_enc` | **No** |
| `src/domain/patients/queries.ts:421`, `:423` `updatePatient` (new ID; clear to `""`) | encrypt | `patients.member_id_enc` | **No** |
| `src/domain/patients/queries.ts:555` `revealPatientMemberIdFor` | decrypt | `patients.member_id_enc` | **No** |
| `src/app/(app)/denials/[id]/actions.ts:185` `revealMemberId` | decrypt | `patients.member_id_enc` | **No** |
| `src/app/(app)/appeals/[id]/actions.ts:210` `revealMemberId` | decrypt | `patients.member_id_enc` | **No** |
| `src/domain/claims/edi-837p.ts:253` 837P builder (PR #102; decrypts in memory to build the claim file) | decrypt | `patients.member_id_enc` | **No** |
| `src/db/seed.ts:271` `seedPractice` | encrypt | `patients.member_id_enc` | **No** |
| `src/domain/integrations/sync.ts:615`, `:616` sync run `encrypt`/`decrypt` (PI2b part 1, PR #98; synced patients' Coverage member ID) | encrypt, decrypt | `patients.member_id_enc` | **No** |
| `src/auth/enrollment.ts:19`, `:23` `pendingEnrollmentSecret` (practice users and the operator) | decrypt, encrypt | `users.totp_secret_enc` | **No** |
| `src/auth/credentials.ts:174` `claimTotp`, reached from practice sign-in (`src/auth/actions.ts:146`), operator sign-in (`src/auth/operator-actions.ts:192`), and step-up (`src/app/(app)/step-up/actions.ts:85`) | decrypt | `users.totp_secret_enc` | **No** |
| `src/domain/custom-fields/values.ts:404`, `:505`, `:611`, `:670` | decrypt, encrypt | `custom_field_values.value_enc` (history rows are copied into `custom_field_value_versions.value_enc` unchanged, `:583`) | Yes, `tenant_id\|field_id\|record_id` |
| `src/domain/custom-fields/list-values.ts:118` | decrypt | `custom_field_values.value_enc` | Yes (a duplicate `aadFor`) |
| `src/lib/crypto/provider-tin.ts:13-14` `encryptProviderTin`, `:17-23` `decryptProviderTin`, AAD `:8-10` (PR #102), called by `src/db/seed.ts:248` (encrypt) and `src/domain/claims/edi-837p.ts:260` (decrypt) | encrypt, decrypt | `providers.tin_enc` | Yes, `tenant_id\|providers.tin_enc\|provider_id` |
| `test/e2e/global-setup.ts:51`, `:72`, `:103` (operator) | encrypt | `users.totp_secret_enc` | No |
| `test/integration/step-up-session.test.ts:157` | encrypt | `users.totp_secret_enc` | No |
| `test/integration/patients.test.ts:100`, `:204` | decrypt | `patients.member_id_enc` | No |
| `test/integration/custom-field-values.test.ts:765`, `:810`, `:817` | both | custom field values | Yes |
| `test/integration/sync-engine.test.ts:322`, `:499`, `:539` (encrypt); `:132`, `:151`, `:516`, `:613` (decrypt) | both | `patients.member_id_enc` | No |
| `test/integration/claim-837p-fixtures.ts:89` `manualPatient`; `test/integration/claim-837p.test.ts:385`, `:402` | encrypt | `patients.member_id_enc` | No |
| `test/integration/claim-837p-fixtures.ts:48` `seedBilling` | encrypt | `providers.tin_enc` | Yes (PR #102) |
| `test/integration/claim-837p.test.ts:460` (asserts `startsWith("v1.")`), `:462-464` `decryptProviderTin`, `:466` `decryptField` without AAD (expects a throw) | decrypt | `providers.tin_enc` | Yes (`:466` No) |
| `src/domain/claims/edi-837p.test.ts:20-25` (non-UUID IDs `"tenant-a"`, `"provider-a"`, which the canonical-UUID builders reject) | both | `providers.tin_enc` | Yes (PR #102) |

Not field-encryption call sites, checked:
- `src/auth/operator-account.ts:289` and `src/db/demo.ts:105` only set `totp_secret_enc` to NULL, which forces re-enrollment.
- Integration signing keys are not stored in the database. Pre-production reads
  `INTEGRATION_SIGNING_KEY` from the environment; production will use non-exportable Key Vault keys,
  and `integration_connections.key_ref` holds only a reference (ADR 0010).
- No bank account or routing numbers are stored (`src/db/schema.ts`, the comments on the remittance
  and deposit tables). SSN and MBI are not stored: an MRN shaped like either is refused
  (`docs/specs/patient-integrations.md`).
- `src/lib/rate-limit.ts:61` reuses `FIELD_ENCRYPTION_KEY` as a SHA-256 salt. This is key reuse
  across purposes. It is not in scope here, but it matters for rotation (open question in the spec).
- No code looks up, sorts, or enforces uniqueness on a member ID ciphertext, and there is no blind
  index. Patient search matches name and MRN only (`queries.ts:106-136`). `member_id_last4` is a
  plaintext display suffix.

Facts that shape the design (checked 2026-09-29):
- `decryptField` throws. `revealPatientMemberIdFor` (`queries.ts:546-555`) inserts its audit event,
  then decrypts, so a failure rolls back the whole transaction, audit included.
- The custom-field `recordId` is request input: `z.uuid()` in `src/app/(app)/patients/actions.ts:257`
  (and route `[id]` params), which accepts uppercase. PostgreSQL returns `uuid` values in lowercase.
- `syntheticDataOnly()` is `!isProduction() || onNetlify()`, and `onNetlify()` is true when any of
  `NETLIFY`, `NETLIFY_DB_URL`, `DEPLOY_ID`, or `SITE_ID` is set (`src/lib/env.ts:65-74`).
- `auditSystem()` (`src/lib/audit.ts:227`) inserts through `systemDb()`, outside the caller's
  transaction. `audit(tx, …)` (`:213`) inserts inside it. `audit_events` has no `principal` column
  (`src/db/schema.ts:1370`); `metadata` is a flat JSON object.

## Decision

### 1. Envelope `v2`
- **Format:** `v2.<kid>.<iv>.<tag>.<ct>`.
  - `kid` is plain text matching `[a-z0-9]{1,16}`.
  - `iv` is 12 random bytes, `tag` is 16 bytes, and `ct` is the ciphertext, each base64url. `ct`
    may be empty: `updatePatient` seals `""` to clear a member ID (`queries.ts:423`).
  - The parser is strict: exactly 5 parts, base64url characters only, a known `kid`, a 12-byte IV,
    and a 16-byte tag.
- **Keyring.** A `Map<kid, Buffer>`, read with `Map.get`. Never index a plain object: `constructor`
  matches the `kid` pattern and would resolve to `Object`.
- **Active `kid` is hard-coded `k1`** in `src/lib/crypto/field.ts`. There is no key-ID environment
  variable. Changing only such a variable would relabel the key: every `v2.k1` value would fail and
  every TOTP sign-in would be locked out. The rotation ADR adds a real key/`kid` set.
- **Key-check value (KCV) per `kid`.** `KCV(kid)` is the first 8 bytes of
  `HMAC-SHA256(HKDF-SHA256(key, info = "denialdesk.field-key-check." + kid), "check")`, base64url:
  a subkey with its own label, so the AES-GCM key itself is never used for a second primitive. It
  is not secret. Never use the conventional "encrypt a zero block" check value: for GCM,
  AES_K(0^128) is the hash subkey H, and exposing any of it weakens forgery resistance.
  - Pre-production stores it as `FIELD_KEY_CHECK_K1` next to the key.
  - Boot computes it and compares with `timingSafeEqual`. A mismatch refuses to boot everywhere. A
    missing value refuses to boot under `APP_ENV=production` and logs `crypto.key_check_missing`
    elsewhere. Logs carry the event name only.
  - `--verify` prints the active `kid`'s KCV, so it can be set without the key leaving the platform.
  - Where the KCV lives in production is part of the cutover ADR (for example, Key Vault key tags).
- **Every new write is `v2`**, for every column. AAD is mandatory. The TypeScript signature takes
  a branded `FieldAad` that only the builders in `src/lib/crypto/aad.ts` can produce, so a missing
  AAD is a compile error.
- **The version prefix alone picks the decrypt path.** There is no trial decryption and no
  fallback. For example, a `v2` value that fails authentication is never retried as `v1`.
- **Readers return a typed result and never throw** (`{ ok: true, value }` or
  `{ ok: false, reason }`, with `reason` one of `malformed`, `unknown_kid`, `legacy_refused`, or
  `auth_failed`). Section 4 explains why.
- `v1` stays readable only as the column's registered legacy format (section 3). `v1` values are
  defined as sealed with `k1`, the current `FIELD_ENCRYPTION_KEY`. No rotation may happen until the
  legacy cut-off (section 5).

### 2. AAD bytes
- **`v2` AAD** is the UTF-8 encoding of `v2|<kid>|<scope>|<field>|<record>`, with no whitespace and
  no trailing separator.
  - The header is bound because a relabeled header does **not** always fail GCM by itself. Legacy
    `v1` custom-field values are sealed under `k1` with `<tenant>|<field>|<record>`. Without the
    header in the AAD, a `v2.k1` custom value relabeled as `v1` would still open. With it, any
    relabel of the version or `kid` fails, for every column.
- **Legacy `v1` AAD** is read-only: ADR 0007's `<tenant>|<field>|<record>` for custom fields,
  `<tenant>|providers.tin_enc|<provider>` for provider TINs, and none for member IDs and TOTP
  secrets (section 3).
- **Canonical inputs.** `<scope>` is a lowercase canonical UUID (the tenant) or the literal
  `global`. `<record>` is a lowercase canonical UUID. `<field>` is a dotted built-in name or a
  custom-field UUID. The builders reject anything else, including `|`.
- **Where the IDs come from.**
  - Tenant: the verified session, the job's tenant, or (in `seedPractice`, which has no session) the
    seed's tenant; never the row.
  - Member ID record: `patients.id` from the selected row, not the function argument.
  - Custom-field record: lowercased at the domain entry points (`loadValuesForRecord`,
    `saveValuesForRecord`, `revealCustomFieldValue`) after `z.uuid()`. `list-values.ts` already uses
    the row's ID.

| Column | `<scope>` | `<field>` | `<record>` |
|---|---|---|---|
| `patients.member_id_enc` | `tenant_id`, taken from the session, job, or seed tenant, not from the row | `patients.member_id` | `patients.id` |
| `users.totp_secret_enc` (practice users **and** the platform operator) | literal `global` | `users.totp_secret` | `users.id` |
| `custom_field_values.value_enc` and `custom_field_value_versions.value_enc` | `tenant_id` | `custom_fields.id` (ADR 0007) | the record's ID |
| `providers.tin_enc` | `tenant_id`, taken from the session or seed tenant, not from the row | `providers.tin` | `providers.id` |

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
- **`patients.member_id`, `users.totp_secret`:** `v1` means sealed without AAD. The read path is open
  only when all of these hold:
  - `FIELD_LEGACY_V1_READ=on` (off by default);
  - `APP_ENV` is not `production`. This uses `isProduction()`, not `syntheticDataOnly()`, because
    `onNetlify()` must not unlock a weaker path;
  - the date is before `LEGACY_V1_READ_EXPIRES`, a constant in `src/lib/crypto/aad.ts` set to
    `2026-12-31`. Extending it takes a PR.

  Otherwise the reader returns `legacy_refused` before any decrypt. Boot refuses when
  `FIELD_LEGACY_V1_READ` is set and `APP_ENV=production`, whatever `onNetlify()` says. The flag,
  the constant, and the branch are removed at the cut-off.
- **Custom field columns:** `v1` means sealed with ADR 0007 AAD. This already meets SC-B7.1 and
  stays readable, with no flag. New writes are `v2`.
  - History rows are append-only (no UPDATE grant, plus an immutability trigger in `drizzle/0027`),
    so they are not rewritten.
  - How they are handled at key rotation is left to the rotation ADR.
- **`providers.tin_enc`:** `v1` means sealed with `<tenant>|providers.tin_enc|<provider>` (PR #102,
  `src/lib/crypto/provider-tin.ts`). Like custom fields, this already meets SC-B7.1 and stays
  readable with no flag; new writes are `v2`. The job does not convert it, and the rotation ADR
  decides how it is resealed.

### 4. Integrity failures are audited and committed
- A reader that fails returns a typed failure. The caller then records
  `security.field_integrity_failed` (IDs, `column`, and `reason` only) and returns a generic message
  key. Nothing throws inside the transaction, so the event commits.
  - Tenant reads (member ID reveal, custom fields, and the 837P builder, which reads the member ID
    and the provider TIN) insert the event with `audit(tx, …)`. For the 837P builder, the member ID
    event comes from `openMemberId` and the TIN event from the builder itself (`decryptProviderTin`
    has no transaction and does not audit).
  - Sign-in, operator sign-in, and step-up have no transaction. `claimTotp` returns
    `"integrity_failed"`, and the caller audits with `auditSystem()`, like its other sign-in events.
- **One event name for every column.** Custom-field code switches from
  `custom_field.value_integrity_failed` to `security.field_integrity_failed` with
  `metadata.column`. The old action stays in the TypeScript union for historical rows. The SIEM
  alert rule (HC-5.3, R-7.5.3; SIEM arrives at the Azure cutover) must match both names.

### 5. Migration: expand, convert, contract
1. **Readers first.** All decrypt sites go through `openMemberId`, `openTotpSecret`, and
   `openField`, which read `v2` and read `v1` under the policy in section 3. No data changes.
2. **Writers second.** All encrypt sites write `v2`. Reverting this step is safe, because the
   readers from step 1 still read `v2`.
3. **Batch re-encryption job** (`src/domain/crypto/reencrypt.ts`).
   - **Selector (SQL).** `<col> IS NOT NULL AND <col> NOT LIKE 'v2.k1.%'`, plus
     `source <> 'fhir'` for patients (`source` is NOT NULL). Then `id > $after ORDER BY id LIMIT n
     FOR UPDATE SKIP LOCKED`, with a default of 100 rows and a maximum of 200 (SC-B5.4).
   - **Keyset cursor within a run.** Each batch starts after the last ID of the previous one, so
     rows the job leaves in place (failed, mismatched, or locked) are never re-selected in the same
     run. Each integrity failure is therefore audited once per run.
   - **Completion.** A pass over one column and tenant ends when a batch returns fewer than `limit`
     rows. `reencryptBatch` returns `{ converted, failed, next }`, where `next` is the cursor or
     `null` when the pass is done.
   - **Resumable across runs** with no state table: converted rows leave the selector, and a new run
     starts from the beginning.
   - **Patients pass.**
     - Runs per tenant as `denialdesk_app` under RLS (`withTenantAsSystem`).
     - Each row is decrypted and checked: the plaintext's last 4 characters (`slice(-4)`) must equal
       `member_id_last4`. On a mismatch the row is not converted, and an integrity failure is
       audited (`reason: last4_mismatch`). This stops the job from resealing a legacy ciphertext
       swapped into the wrong row on its own. It does not stop a swap that also copies
       `member_id_last4`, and four characters can collide by chance, so wipe and re-seed stays the
       recommended pre-production path (open question 2).
     - The row is resealed and written back with a compare-and-swap on the old ciphertext.
       `updated_at` is not touched.
   - **Users pass.** The same steps through `systemDb().transaction(…)`, as the auth code already
     does, because `users` has no tenant and no RLS, and the app role cannot read `totp_secret_enc`
     (`drizzle/0002`). There is no plaintext check value for TOTP secrets.
   - **Audit (HC-5.1–5.3).**
     - One `security.field_reencrypted` event per non-empty batch, inserted **in the batch's
       transaction**: `audit(tx, …)` for patients, and for users one `src/lib/audit.ts` helper that
       takes the system transaction and reuses `row()` (so the request IP and user agent are
       kept). A failed audit insert rolls the batch back. `auditSystem()` is never used here.
     - The event lists record IDs and never values. `actorUserId` is null. `metadata.principal` is
       `field-reencrypt`, `metadata.operator` is the person who started the run, and `reason` is the
       run reason. No `audit_events` change is needed.
   - **Synced patients.** `patients_synced_readonly` (`drizzle/0040`) forbids changing
     `member_id_enc` on `source = 'fhir'` rows outside a sync run.
     - The job excludes those rows in SQL. `--verify` counts them as `blocked`.
     - PI2b part 1 (PR #98) already writes synced member IDs unbound (`sync.ts:615-616`). PR 2 and
       PR 3 switch those `decrypt`/`encrypt` hooks to `openMemberId`/`sealMemberId` (the run knows
       the tenant and the patient row ID), and a sync run reseals a stored value that is not `v2`
       at the active `kid` even when the plaintext is unchanged. Existing synced rows are therefore
       converted by the next sync run (inside a run the trigger allows it) or by wipe and re-seed,
       never by the job. `blocked` must be 0 before the cut-off.
   - **Why not SQL.** This cannot be a SQL migration: the key must never reach the database (HC-7.4).
4. **Verify.** `--verify` reports counts per column: `v1`, `v2` at the active `kid`, `v2` at other
   keys, `blocked`, and `unparseable`. For custom fields and `providers.tin_enc` it also opens every
   current value under the canonical AAD and counts `openFailed`. It reports counts and the active
   KCV only. Their `v1` values are never converted, so `v1 = 0` and `blocked = 0` gate the cut-off
   only for `patients.member_id_enc` and `users.totp_secret_enc`.
5. **Cut-off (contract).**
   - Delete the no-AAD branch, `FIELD_LEGACY_V1_READ`, `LEGACY_V1_READ_EXPIRES`, and the old
     `encryptField`/`decryptField` exports (by then `provider-tin.ts` uses `sealField`/`openField`).
   - Add an allow-list CHECK (SC-B3.1) on `patients.member_id_enc` and `users.totp_secret_enc`:
     `CHECK (<col> IS NULL OR <col> ~ '^v2\.[a-z0-9]{1,16}\.')`. This migration fails if any other
     value remains, so the migration itself is the final gate.
   - After this, a `v1` member ID or TOTP secret is a hard failure: an audited integrity error, a
     generic message key, and fail-closed sign-in. It never silently falls back.
   - Custom-field and provider TIN columns get no CHECK: their `v1` values stay readable with their
     AAD (section 3).

### 6. Keys, usage, and retirement
- **Usage limit.** NIST SP 800-38D §8.3 limits a key used with random 96-bit IVs to 2^32
  encryptions (⚠️ VERIFY exact wording at build). Rotate annually (HC-7.4), or earlier when the
  counter below reaches 2^30.
- **Usage counter.** One PostgreSQL sequence per `kid` (`field_key_seals_k1`). `sealField` calls
  `nextval` in the caller's transaction for every seal.
  - It is durable. `nextval` is never rolled back, so it over-counts, which is the safe direction
    for a limit. It also avoids a hot counter row that would serialize every write.
  - Audit events cannot serve as the count: they undercount (one event per batch, and the create
    and update paths do not record each seal).
  - It needs `GRANT USAGE` (only; never `UPDATE` or `ALL`, so the app role cannot `setval` it
    back) to `denialdesk_app`, so that PR needs R-15.9 human sign-off.
  - The count is per database. Where `k1` seals into more than one database (Netlify branch
    databases, restored copies), the counts add up; negligible against 2^30, but `--verify`
    reports the counter against 2^30 and logs `crypto.key_usage_high` from 2^29, so it is read
    somewhere.
- **Option for the cutover ADR: per-tenant subkeys.** `HKDF-SHA256(master, info = <kid>|<tenant>)`
  spreads usage across tenants and limits the damage of one tenant's key. TOTP would use a `global`
  subkey.
- **Rotation procedure.** Add a new active `kid`, keep old keys decrypt-only, run the same job,
  verify, then retire the old key.
- **Retiring a key** means removing it from encryption and keeping it **decrypt-only** (Key Vault
  soft-delete and purge protection in production) for as long as any of these may still reference
  its `kid`: a backup, a point-in-time copy, an append-only history row
  (`custom_field_value_versions`), a synced row, a retention period (HC-10.1, R-9.2 defaults), or a
  legal hold (R-9.2.1).
- **Destroying a key** makes every value under it unreadable, so it is a disposal action (HC-10.2,
  R-9.2.3). It needs a legal-hold check and sign-off from both the Security Officer and the Privacy
  Officer, recorded in the audit log, whose 7-year retention (HC-5.4) is unaffected. Until the
  legal-hold capability exists (HC-10.1 known gap), no field key is destroyed.
- **Pre-production.** One Netlify environment key (the HC-7.4 gap stays open).
- **Azure cutover.** Production gets fresh keys created in Key Vault, with a new `kid` such as `az1`.
  The Netlify key is never reused. Production starts empty, so nothing is re-encrypted at cutover.
  The retrieval model (secret vs HSM-wrapped data key), the Key Vault SDK (R-15.7), separation of
  duties, where the KCV lives, per-tenant subkeys, and the rotation runbook belong to the cutover ADR.

## Consequences
- **No new dependency.** `node:crypto` only (SC-A1.2).
- **One GRANT, and no SECURITY DEFINER, trigger, or audit-table change.** The writers PR adds the
  counter sequence with `GRANT USAGE … TO denialdesk_app`, which needs R-15.9 human sign-off in that
  PR. The cut-off migration adds CHECK constraints on `patients` and `users`.
- **Environment changes.** New: `FIELD_LEGACY_V1_READ` (temporary) and `FIELD_KEY_CHECK_K1`. Boot
  refuses `SEED_TOKEN` under `APP_ENV=production`, because the re-encryption endpoint widens that
  token's power. No key-ID variable.
- **Patient IDs are generated in the app.** `createPatient` must generate the patient ID before the
  insert (`randomUUID()`), because the AAD needs it. The seed already generates IDs this way
  (`idFor`).
- **Ciphertext is never copied.** A future patient merge, tenant move, or re-link that must carry a
  member ID decrypts under the old AAD and reseals under the new one. A copied ciphertext fails, and
  tests prove it.
- **Member ID lookup needs a new ADR.** No search by member ID remains possible. A future 835
  NM109 or "find by member ID" feature would need a tenant-keyed HMAC blind index and a new ADR.
- **Transition residual risk.** Until the cut-off, someone with database write access could replace
  a value with another row's legacy `v1` ciphertext, and it would decrypt.
  - For member IDs, the job's last-4 check refuses to reseal a ciphertext swapped on its own (not
    one swapped together with `member_id_last4`).
  - For TOTP secrets there is no such check, so a swapped secret would be resealed under the
    victim's user ID.
  - Wiping and re-seeding pre-production instead of converting removes this risk (spec, open
    question 2). This affects pre-production only (synthetic data). Production refuses `v1` from day
    one.
  - Custom-field and provider TIN `v1` values stay readable after the cut-off. Their AAD stops a
    cross-row copy, but not a same-row rollback to an older `v1` value of that row.
- **Old ciphertexts in backups.** Pre-production backups and WAL keep old `v1` ciphertexts until
  they age out. So `k1` is retired decrypt-only, never destroyed, while they exist (section 6).
