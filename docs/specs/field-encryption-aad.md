# Spec: Bind AAD on every encrypted field (close SC-B7.1)

Status: draft (2026-09-28, architect; revised 2026-09-29 after agent review). The owner must approve
it with ADR 0011 before it is built.
Roadmap item: Security hardening, `docs/SECURE_CODING.md` known gap SC-B7.1 (`docs/PROJECT_STATE.md` "Next up")
Requirement IDs: R-7.3.3, R-7.3.4, R-7.2.4, R-7.5.1, R-7.5.3, R-7.4.1, R-7.4.5, R-7.4.8, R-7.2.2, R-7.1.3, R-9.2.1, R-9.2.3, R-15.1, R-15.9

## Goal
Every member ID and TOTP secret ciphertext is bound to its tenant, field, and record. A value
copied to another row, user, or practice fails to decrypt. Existing values are converted, and after
a cut-off the old unbound format is refused.

## User stories
- As a practice, I know a database-level copy of one patient's member ID onto another patient
  cannot be read back as that patient's.
- As the Security Officer, I can show that no unbound ciphertext remains. The evidence is a count
  per column plus audit events.

## Acceptance criteria
Design: ADR 0011. It covers the envelope, the AAD bytes, the legacy policy, and key retirement.

### Primitive
- [ ] `src/lib/crypto/field.ts` has two new functions.
  - `sealField(db, plaintext, aad)` writes `v2.<kid>.<iv>.<tag>.<ct>` with a fresh 12-byte IV. It
    counts the seal with `nextval('field_key_seals_k1')` on `db` (the caller's transaction).
  - `openField(payload, aad, policy)` chooses its path by the version prefix only, with no fallback.
    It never throws. It returns `{ ok: true, value }` or `{ ok: false, reason }`, where `reason` is
    one of `malformed`, `unknown_kid`, `legacy_refused`, or `auth_failed`.
  - The strict parser accepts an empty ciphertext part (`updatePatient` seals `""`).
  - `aad` is a branded `FieldAad`.
- [ ] `src/lib/crypto/aad.ts` builds AAD for four fields and holds each column's `v1` policy.
  - The builders are `memberIdAad(tenantId, patientId)`, `totpSecretAad(userId)`,
    `customFieldAad(tenantId, fieldId, recordId)`, and `providerTinAad(tenantId, providerId)`.
    `customFieldAad` replaces the two copies of `aadFor` in `src/domain/custom-fields/`.
  - `v2` AAD is `v2|<kid>|<scope>|<field>|<record>`. The `v1` custom-field AAD is ADR 0007's
    `<tenant>|<field>|<record>`, and the `v1` provider TIN AAD is PR #102's
    `<tenant>|providers.tin_enc|<provider>`, both for reading only.
  - The builders reject a non-canonical UUID (uppercase, braces, or no dashes), `|`, and any scope
    that is not a tenant UUID or the literal `global`.
- [ ] `v1` without AAD opens only for `patients.member_id` and `users.totp_secret`, and only when
      all of these hold:
  - `FIELD_LEGACY_V1_READ=on` (off by default);
  - `isProduction()` is false, whatever `onNetlify()` says;
  - the date is before `LEGACY_V1_READ_EXPIRES` (`2026-12-31`, hard-coded in `aad.ts`).

  Otherwise the result is `legacy_refused`. `v1` custom field values still open with their ADR 0007
  AAD, and `v1` provider TINs with their PR #102 AAD.
- [ ] `kid` handling.
  - The active `kid` is the constant `k1`. There is no `FIELD_ENCRYPTION_KEY_ID`.
  - The keyring is a `Map`. An unknown `kid`, including `constructor`, is refused.
  - `v1` is always read with `k1`.
- [ ] Boot checks (`src/lib/env.ts`, run from `src/instrumentation.ts`). Each logs an event name
      only.
  - Refuse to boot when `APP_ENV=production` and `FIELD_LEGACY_V1_READ` is set.
  - Refuse to boot when `APP_ENV=production` and `SEED_TOKEN` is set.
  - Refuse to boot when `FIELD_KEY_CHECK_K1` does not match the key (ADR 0011 §1). When it is
    missing, refuse under `APP_ENV=production` and log `crypto.key_check_missing` elsewhere.

### Member IDs
- [ ] Two new helpers in `src/domain/patients/member-id.ts`.
  - `sealMemberId(tx, tenantId, patientId, value)`.
  - `openMemberId(tx, actor, row)`, where `row` is the selected `{ id, memberIdEnc }`. The record in
    the AAD is `row.id`, never the caller's argument. On failure it audits
    `security.field_integrity_failed` with `audit(tx, …)` (patient ID, `column`, and `reason`; never
    the value). It returns the key `error.memberIdUnavailable` (en/es/pt, in the patients, denials,
    and appeals dictionaries) without throwing, so the event commits.
- [ ] These call sites switch to the helpers.
  - `createPatient` (the patient ID is generated before the insert), `updatePatient`, and
    `revealPatientMemberIdFor`.
  - Both `revealMemberId` actions (denials and appeals).
  - The 837P builder (`src/domain/claims/edi-837p.ts:253`), via `openMemberId` (which audits in
    `tx`); the builder maps the failure to a `no_member_id` refusal and does not audit it again.
  - `seedPractice`.
- [ ] The tenant in the AAD comes from the session (`actor.tenantId`) or the job's tenant (the seed
      tenant in `seedPractice`), never from the row.

### TOTP secrets
- [ ] `sealTotpSecret(db, userId, secret)` and `openTotpSecret(userId, enc)` in
      `src/auth/totp-secret.ts`. They are used by `pendingEnrollmentSecret` and `claimTotp`, so they
      cover practice sign-in, operator sign-in, and step-up.
- [ ] An integrity failure fails closed.
  - `claimTotp` returns `"integrity_failed"` instead of throwing.
  - The user sees the same generic code-mismatch message, so account state is not revealed.
  - The caller audits `security.field_integrity_failed` with the user ID through `auditSystem()`,
    like its other sign-in events. There is no transaction to roll back.
  - Recovery is the existing MFA reset. For a practice admin that is admin repair
    (`src/db/demo.ts`). For the operator it is a credential rotation (`src/auth/operator-account.ts`).
- [ ] Test and E2E setup (`test/e2e/global-setup.ts`, `test/integration/step-up-session.test.ts`)
      use `sealTotpSecret`.

### Custom fields
- [ ] `loadValuesForRecord`, `saveValuesForRecord`, and `revealCustomFieldValue` lowercase
      `recordId` on entry, before any query or AAD. Today it is request input validated by
      `z.uuid()` (`src/app/(app)/patients/actions.ts:257`, route `[id]` params), which accepts
      uppercase.
- [ ] Reads use `openField` with `customFieldAad`; writes use `sealField`.
- [ ] Failures audit `security.field_integrity_failed` with `metadata.column` set to
      `custom_field_values.value_enc`. Custom-field code no longer emits
      `custom_field.value_integrity_failed`. That action stays in the union for historical rows.
      Changing which audit action a control emits is an audit-logging change: PR 2 asks the owner
      for R-15.9 sign-off.

### Provider TINs
- [ ] `src/lib/crypto/provider-tin.ts` keeps its two functions but builds them on `sealField` and
      `openField` with `providerTinAad`; the test-only `key` argument goes.
  - `decryptProviderTin(payload, tenantId, providerId)` returns the typed `openField` result and
    never throws; `v1` opens with the PR #102 AAD (PR 2).
  - `encryptProviderTin(db, tin, tenantId, providerId)` is async and writes `v2`; `db` is the
    caller's transaction for the seal counter (PR 3).
  - Callers: `seedPractice` (`src/db/seed.ts:248`) and the 837P builder
    (`src/domain/claims/edi-837p.ts:260`).
- [ ] A failure stays a `billing_tin` refusal. The 837P builder audits
      `security.field_integrity_failed` with `audit(tx, …)`, `entityType: "provider"`,
      `entityId: provider.id`, and `metadata` `{ column: "providers.tin_enc", reason, claimId }`;
      `decryptProviderTin` has no transaction and does not audit.
- [ ] The re-encryption job does not touch `providers.tin_enc` (ADR 0011 §3).

### Re-encryption job
- [ ] `src/domain/crypto/reencrypt.ts` exports `reencryptBatch({ column, tenantId?, limit, after,
      operator, reason, trigger })`, which returns `{ converted, failed, next }`. `next` is the last
      ID of the batch, or `null` when the pass is done.
- [ ] Selector, in SQL: `<col> IS NOT NULL AND <col> NOT LIKE 'v2.k1.%'`, plus `source <> 'fhir'`
      for patients, plus `id > $after`. Then `ORDER BY id LIMIT $limit FOR UPDATE SKIP LOCKED`,
      with `limit` 100 by default and 200 at most.
- [ ] A pass is done when a batch returns fewer than `limit` rows. Rows left in place (failed,
      mismatched, or locked) are not re-selected in the same run. Each is audited once per run.
- [ ] Patients pass.
  - Runs per tenant through `withTenantAsSystem`: the `denialdesk_app` role with RLS. It reuses
    PI2b's helper if that has merged, and otherwise adds it with the same design.
  - Before resealing, the job checks that the plaintext's `slice(-4)` equals `member_id_last4`. On a
    mismatch the row stays unchanged, and `security.field_integrity_failed` is audited with
    `reason: last4_mismatch`. This catches a ciphertext swapped on its own, not one swapped together
    with `member_id_last4`.
  - Each row is written with a compare-and-swap on the old ciphertext. `updated_at` is not changed.
- [ ] Users pass. The same steps inside `systemDb().transaction(…)`; only `totp_secret_enc`
      changes.
- [ ] Audit.
  - Each non-empty batch writes one `security.field_reencrypted` event **in the batch's
    transaction**: `audit(tx, …)` for patients and, for users, one helper in `src/lib/audit.ts` that
    takes the system transaction and reuses `row()`, so the IP and user agent of an endpoint-started
    run are recorded (HC-5.1 "where"). If the audit insert fails, the batch rolls back.
    `auditSystem()` is never used.
    - Columns: `actorUserId` null, `reason` = the run reason.
    - Metadata: `column`, `count`, `recordIds` (comma-joined), `fromFormat`, `toFormat`, `kid`,
      `trigger` (`cli` or `preview_endpoint`), `principal` (`field-reencrypt`), and `operator`.
  - A row that fails to decrypt, or fails the last-4 check, stays unchanged and writes
    `security.field_integrity_failed` in the same transaction.
  - An empty batch writes no event.
- [ ] Idempotent and resumable: running the job twice converts 0 rows the second time. A run that
      was stopped is resumed by starting a new run, because converted rows leave the selector.
- [ ] How the job is run.
  - CLI `pnpm crypto:reencrypt --operator <name> --reason <reason> [--column …] [--verify]`
    (`scripts/reencrypt-fields.ts`).
    - `--operator` and `--reason` are required and validated with a strict Zod schema. `operator`
      is 2–64 characters from `[A-Za-z .'-]`. `reason` is one of `aad_migration`, `key_rotation`,
      or `rotation_drill`.
    - The CLI loops each column and tenant until `next` is `null`. It exits 0 when every pass is
      done with `failed = 0`, and 2 when every pass is done but rows remain.
    - The CLI is for local, CI, and (later) Azure worker databases. It is **never run against the
      shared pre-production database from a workstation**: the key must not leave the platform
      (SC-B7.3).
  - Pre-production endpoint `POST /api/preview/reencrypt`.
    - `404` when `isProduction()`, as the seed route does, not a `syntheticDataOnly()` check. It
      needs `SEED_TOKEN` and is rate-limited.
    - The body is strict Zod: `operator`, `reason`, and an optional `next` of
      `{ column, tenantId, after }` taken from the previous response.
    - One call does a bounded number of batches within a time budget below the route's
      `maxDuration`. It returns `{ done, next, counts }`. The caller posts `next` back and stops at
      `done: true`.
    - Responses carry counts and the cursor only.
- [ ] `verifyFormats()` returns counts per column: `v1`, `v2Active`, `v2Other`, `blocked`, and
      `unparseable`. For custom fields and `providers.tin_enc` it also adds `openFailed`: it opens
      every current value in bounded batches under each tenant's RLS, in memory only.
  - Each custom-field or provider batch writes, in its own tenant transaction (`audit(tx, …)`), one
    `security.field_formats_verified` event listing the checked record IDs (HC-5.1), never values.
    Each value that fails to open also gets `security.field_integrity_failed`, once per run.
  - The counts are summed across tenants. A final `security.field_formats_verified` event records
    the totals.
  - It prints the active `kid`'s key-check value (ADR 0011 §1) and `field_key_seals_<kid>` against
    2^30, warning (`crypto.key_usage_high`) from 2^29.
- [ ] Logs carry event names and counts only (SC-B9.1).

### Cut-off
- [ ] Cut-off happens when all of these hold.
  - The shared pre-production database verifies at `v1 = 0` and `blocked = 0` for
    `patients.member_id_enc` and `users.totp_secret_enc`, `unparseable = 0`, and custom-field and
    provider TIN `openFailed = 0` (or each failure is resolved), with no unresolved integrity
    failures. Custom-field and provider TIN `v1` values are never converted, so their `v1` count is
    reported, not gated.
  - The owner confirms.
- [ ] At cut-off:
  - The no-AAD branch, `FIELD_LEGACY_V1_READ`, `LEGACY_V1_READ_EXPIRES`, and the old
    `encryptField`/`decryptField` exports are removed.
  - The migration adds an allow-list CHECK (SC-B3.1),
    `CHECK (<col> IS NULL OR <col> ~ '^v2\.[a-z0-9]{1,16}\.')`, on `patients.member_id_enc` and
    `users.totp_secret_enc`, mirrored into `netlify/database/migrations/`.
  - The integration fixtures that store placeholder ciphertexts are changed to valid `v2` values:
    `"x"` in `patients.test.ts:174`, `:394`; `patient-integrations.test.ts:138`, `:1069`, `:1095`,
    `:1108`; `insight-reports.test.ts:111`; `claims.test.ts:588`; `sync-db.test.ts:304`;
    `operator-account.test.ts:94`, `:146`; `"not-a-real-ciphertext"` in `helpers.ts:282`;
    `"SYN-ENCRYPTED"` in `test/support/sync-fixtures.ts:157`; `'synthetic-not-a-secret'` in
    `jobs-db.test.ts:770`; and `"v1.synthetic"` in `seed-admin.test.ts:42`, `:49`.
  - The `docs/SECURE_CODING.md` SC-B7.1 row and `docs/PROJECT_STATE.md` are updated.
- [ ] After cut-off, a `v1` member ID or TOTP secret is a hard failure: audited, generic message,
      no decrypt attempted.

### Tests
See "Tests" below; SC-B11.1 negative tests are required.

## Data / API changes
- **No new table and no new column.**
- **Migrations.**
  - PR 3: sequence `field_key_seals_k1` plus `GRANT USAGE ON SEQUENCE … TO denialdesk_app` (USAGE
    only; never UPDATE or ALL). This is
    a GRANT, so the PR needs R-15.9 human sign-off.
  - PR 5: the two CHECK constraints.
- **No SECURITY DEFINER, trigger, or `audit_events` change.** `principal` and `operator` go in
  `metadata`, because `audit_events` has no such columns (`src/db/schema.ts:1370`).
- **Environment.**
  - `FIELD_LEGACY_V1_READ` (`on` or unset). Off by default. Boot refuses it under
    `APP_ENV=production`. It stops working after `LEGACY_V1_READ_EXPIRES` and is removed in PR 5.
    Set it on pre-production and on developer databases that hold `v1` rows.
  - `FIELD_KEY_CHECK_K1`: the key-check value, not secret. Required in production.
  - `SEED_TOKEN`: boot now refuses it under `APP_ENV=production`.
  - `FIELD_ENCRYPTION_KEY_ID` is **not** added.
- **Route:** `POST /api/preview/reencrypt`, pre-production only.
- **Script:** `pnpm crypto:reencrypt`.
- **Audit actions:** `security.field_reencrypted`, `security.field_integrity_failed`, and
  `security.field_formats_verified`. They are added to the TypeScript union in `src/lib/audit.ts`;
  there is no database constraint to change.
- **Classification (§9.1).** Member IDs are Restricted PHI and are unchanged. Provider TINs are
  Restricted and unchanged (SSN-equivalent when the qualifier is `SY`; a provider identifier, not
  patient PHI; field-encrypted under HC-7.3). TOTP secrets are
  credentials (Secret). Counts, cursors, and record IDs in command and endpoint output are Internal.
  Audit rows take the audit log's classification and controls (append-only, 7-year retention,
  U.S.-only; HC-5.3, HC-5.4).

## Legal rules used
None (no legal clock). `LEGACY_V1_READ_EXPIRES` is an engineering date, not a statutory deadline.

## Out of scope
- Key rotation itself: multiple keys, Key Vault, the rotation runbook. The envelope and the job are
  ready for it; the Azure cutover ADR decides it.
- Re-encrypting `custom_field_value_versions`, which is append-only.
- A blind index for member ID lookup.
- `src/lib/rate-limit.ts` reusing `FIELD_ENCRYPTION_KEY` (see open questions).
- Plaintext `rcm_claim_lines.account_number`, a patient account number.
  - HC-7.3 and R-7.3.3 list only SSN, MBI, member IDs, and bank data, so storing it in plaintext
    breaks no MUST rule.
  - It is still an HC-1.1 identifier. Whether to field-encrypt it is an owner and officer decision:
    see owner row OA-104.

## Open questions
Listed at the end of the implementation plan.

## Implementation plan

**Agents.**
- **builder** builds every PR below.
- **florida-rules-engine** is not involved: there are no legal values.
- **edi-x12-specialist** is not involved now. It is consulted only if a later 835 feature needs
  member ID matching (blind index, new ADR).
- **Reviewers.** `security-reviewer` reviews every PR, and `compliance-checker` reviews PR 3,
  PR 4a, PR 4b, and PR 5.
- **SOC 2 controls.**
  - Every PR: CC6.1 (encryption and key management), CC7.2 (integrity monitoring through audit),
    CC8.1 (change management), C1.1 (protecting confidential information), CC3.2 (risk
    identification: the threat model), PI1.3/PI1.5 (processing and stored-data integrity), CC6.3
    (least privilege: PR 3's single `GRANT USAGE`), and CC7.3 (evaluating integrity-failure
    events).
  - At key rotation and key retirement, add C1.2 (disposal), CC6.5 (retiring protected assets),
    and A1.2 (backups and recovery).

**Ordering is expand, then convert, then contract.** Each PR can be reverted on its own without
making stored data unreadable.

### PRs
Each PR is about 400 changed lines or fewer, not counting generated drizzle snapshots.

**PR 0: design (this document)** [R-7.3.3, R-7.4.5]
- ADR 0011, this spec, and the threat model. Docs only.

**PR 1: `feat(crypto): v2 envelope with key ID and mandatory AAD [R-7.3.3, R-7.3.4]`** (about 380 lines)
- `src/lib/crypto/field.ts`: `sealField`, `openField` with typed results, the `Map` keyring with
  the constant `k1`, and the key-check value. The old `encryptField`/`decryptField` stay for now
  and are marked deprecated.
- `src/lib/crypto/aad.ts`: the builders with the header-bound `v2` AAD, `FieldAad`, the per-column
  `v1` policy, and `LEGACY_V1_READ_EXPIRES`.
- `src/lib/env.ts` and `src/instrumentation.ts`: `FIELD_LEGACY_V1_READ`, `FIELD_KEY_CHECK_K1`, and
  the boot refusals (the flag or `SEED_TOKEN` under production, and a KCV mismatch).
- Update `.env.example` and `docs/runbooks/netlify.md` (set `FIELD_LEGACY_V1_READ=on` and the KCV
  in pre-production).
- `.github/workflows/ci.yml` (compute `FIELD_KEY_CHECK_K1` right after the throwaway
  `FIELD_ENCRYPTION_KEY` is generated) and `playwright.config.ts`: the e2e "production" project boots
  with `APP_ENV=production`, where a missing KCV refuses to boot.
- Set `FIELD_LEGACY_V1_READ=on` in `ci.yml`'s integration and e2e environments and in the
  Playwright preview server's `webServer.env`, never in the production server's (boot refuses it).
  Until PR 3, writers and fixtures still write `v1`, so without the flag the PR 2 readers would
  refuse them. PR 5 removes these settings.
- Unit tests. There are no caller changes and no data changes, so reverting is always safe.

**PR 2: `refactor(crypto): route every decrypt through AAD-aware readers [R-7.3.3, R-7.5.1]`** (about 400 lines)
- New `src/domain/patients/member-id.ts` and `src/auth/totp-secret.ts`.
- Switches every decrypt in the inventory: `queries.ts:555`, the denials and appeals actions,
  `enrollment.ts:19`, `credentials.ts:174`, the 837P builder (`edi-837p.ts:253`, `:260`), and the
  sync run's `decrypt` hook (`sync.ts:616`).
  Integrity failures return typed results and are audited without being rolled back.
- The provider TIN decrypt half: `decryptProviderTin(payload, tenantId, providerId, key?)` returns
  the typed result. The optional test `key` stays until PR 3, because `edi-837p.test.ts:18-25`
  seals with a test key. `claim-837p.test.ts:462` expects `{ ok: true, value }` and `:463-464`
  expect `ok: false` instead of a throw. `edi-837p.test.ts:20-25` moves to canonical UUIDs, because
  this PR puts the builders' UUID check on that path.
- Switches custom fields to `openField` with `customFieldAad`, lowercases `recordId` at the entry
  points, and moves them to the single integrity event.
- Adds the audit actions and the three i18n keys.
- Writers still write `v1`, so reverting is safe.

**PR 3: `feat(crypto): write member IDs, TOTP secrets, and provider TINs as v2 with AAD [R-7.3.3, R-7.2.4, R-15.9]`** (about 380 lines)
- Switches every encrypt in the inventory: `queries.ts:346/421/423`, `seed.ts:248/271`,
  `enrollment.ts:23`, `values.ts:505`, and the sync run's `encrypt` hook (`sync.ts:615`), which
  also reseals a stored member ID that is not `v2` at the active `kid` even when it is unchanged.
- The provider TIN encrypt half: `encryptProviderTin(db, tin, tenantId, providerId)` seals `v2`
  with `providerTinAad` (`seed.ts:248` passes its transaction).
- Migration `drizzle/00NN_field_key_seal_counter.sql` with its Netlify mirror: the sequence and
  its `GRANT USAGE`. **R-15.9 human sign-off in the PR.**
- `createPatient` gets the app-side `randomUUID()` ID.
- Updates E2E and integration setup to `sealTotpSecret`/`sealMemberId`, including
  `sync-engine.test.ts:322`, `:499`, `:539` and `claim-837p.test.ts:385`, `:402`.
- Moves the claim-837p fixtures to the `v2` sealers (`claim-837p-fixtures.ts:48`
  `encryptProviderTin(db, …)`, `:89` `sealMemberId` with an app-side patient ID) and changes
  `claim-837p.test.ts:460` from `startsWith("v1.")` to `startsWith("v2.k1.")`. The DB-free TIN
  test in `edi-837p.test.ts` now needs a `db` for the seal, so it moves to `claim-837p.test.ts`.
  `claim-837p.test.ts:466` (`decryptField` with no AAD) is removed: on a `v2` value it would fail on
  the format, not the missing AAD, and the unit test "`v1` without AAD is refused for provider
  TINs" covers it. The PR 2 test `key` on `decryptProviderTin` is dropped.
- Assertions that decrypt a value the app now writes as `v2` switch to the readers, because
  `decryptField` cannot read `v2`: `patients.test.ts:100`, `:204`; `sync-engine.test.ts:132`,
  `:151`, `:516`, `:613`; `custom-field-values.test.ts:817`.
- Adds the swapped-row, swapped-tenant, and relabeled-header tests.
- Reverting the code is safe, because the PR 2 readers still read `v2`. The sequence can stay.

**PR 4a: `feat(crypto): resumable re-encryption job [R-7.3.3, R-7.5.1, R-7.2.4]`** (about 380 lines)
- `src/domain/crypto/reencrypt.ts`: the keyset selector, completion, the last-4 check, and the
  same-transaction audit.
- `withTenantAsSystem` in `src/db/tenant.ts`, unless PI2b has added it.
- `scripts/reencrypt-fields.ts` (with `--operator` and `--reason`) and the `package.json` script.
- Integration tests.

**PR 4b: `feat(preview): format verification, pre-production re-encryption endpoint, and runbook [R-7.3.3, R-7.1.3]`** (about 330 lines)
- `verifyFormats()`, including the custom-field `openFailed` count and the KCV output, and
  `--verify` in the CLI.
- `src/app/api/preview/reencrypt/route.ts`: the `isProduction()` 404, the `SEED_TOKEN` check
  (`src/lib/seed-token.ts`), a new rate-limit bucket, the strict body, and counts-only responses.
- New `docs/runbooks/field-encryption-reencrypt.md`: run, verify, and recover from integrity
  failures by re-entering the member ID or resetting MFA.
- Update `docs/runbooks/netlify.md`.
- **If the owner chooses wipe and re-seed** (open question 2), the conversion part of the endpoint
  is dropped. On the shared database, the PR 5 CHECK migration is then the gate.

**Run.**
- **Shared pre-production database.** Either run the job through the endpoint and then verify, or
  wipe and re-seed after PR 3 is deployed (open question 2).
- **Developer databases.** Re-seeding is not enough: `seedDemoPractice` keeps `totpSecretEnc`
  unless `resetMfa` is passed, and it leaves other users untouched. Either run
  `pnpm crypto:reencrypt` locally, or reset the database (`docker compose down -v`, then
  `pnpm db:migrate` and `pnpm db:seed`).
- **CI databases** are fresh on every run.
- **Old deploy-preview branches** that fail after the cut-off are deleted or re-seeded (synthetic
  data).

**PR 5: `feat(crypto): refuse legacy unbound ciphertexts [R-7.3.3]`** (about 320 lines)
- Remove the no-AAD branch, the flag, the expiry constant, and the deprecated exports.
- Migration `drizzle/00NN_field_format_v2_only.sql` with its Netlify mirror: the two allow-list
  CHECK constraints.
- Fix the placeholder fixtures listed under "Cut-off".
- Replace the remaining test uses of `encryptField`/`decryptField` (for example the `v1`
  custom-field fixture in `custom-field-values.test.ts:765` and `:810`)
  with `v1` fixtures built with `node:crypto` in the test, or with the readers.
- Tests move to "refused after the cut-off".
- Remove the SC-B7.1 row from `docs/SECURE_CODING.md` and update `docs/PROJECT_STATE.md`. Because
  it changes that standard, the PR needs the owner's written approval in the PR and is never
  self-merged (HC-13.2).
- This PR merges only after the owner confirms the verified counts.

### Edge cases
- **A member ID moving with its patient.**
  - The patient ID never changes, and nothing moves a patient between practices. Editing a patient
    reseals under the same AAD.
  - A payer change requires a new member ID, which is sealed fresh (`updatePatient`).
  - Any future move or copy must reseal, never copy the ciphertext. The swapped-row and
    swapped-tenant tests enforce this.
- **Patient link or merge** (`docs/specs/patient-integrations.md`).
  - PI2b "linking" keeps the manual patient's row and ID. The sync then writes the Coverage member
    ID with `sealMemberId(tx, tenant, thatRowId, value)`.
  - `replaced-by` only sets `source_status = 'merged'`. Nothing moves, and merge tooling is out of
    scope there.
  - A new synced row needs its ID before it is inserted.
  - **Sync writer:** PI2b part 1 (PR #98) landed first and writes synced member IDs unbound
    (`sync.ts:615-616`). PR 2/PR 3 switch its hooks; existing synced rows are converted by the next
    sync run (the trigger allows writes inside a run) or by wipe and re-seed, never by the job.
    `spec-writer` should record this in PI2b.
- **Cleared member IDs.** `updatePatient` seals `""` with `member_id_last4 = ""`. The parser accepts
  the empty ciphertext part, and the last-4 check passes (`"".slice(-4) === ""`).
- **TOTP re-enrollment.**
  - Resets set the column to NULL: operator credential rotation and demo admin repair with
    `resetMfa`. The next `pendingEnrollmentSecret` seals a new `v2` secret.
  - A pending, not-yet-verified `v1` secret is converted by the job like any other row.
  - The compare-and-swap skips a row that changed mid-batch.
- **Seed script.**
  - `seedPractice` already assigns patient IDs in the app (`idFor`), so it switches to
    `sealMemberId` directly in PR 3.
  - Seed data is synthetic. Seeding stays refused in production.
- **Lookup and uniqueness.**
  - No code searches, sorts, or enforces uniqueness on `member_id_enc`, and there is no blind index.
    Random IVs already made equal plaintexts produce different ciphertexts, so AAD changes nothing
    here.
  - Placeholder fixtures (`"x"`, `"v1.synthetic"`) fail the allow-list CHECK. PR 5 fixes them.

### Tests
**Unit** (`src/lib/crypto/field.test.ts`, `aad.test.ts`, `src/lib/env.test.ts`)
- Round trip, including an empty plaintext.
- A fresh IV on each seal.
- The parser rejects bad inputs: wrong part count, a bad `kid`, non-base64url characters, IV not 12
  bytes, tag not 16 bytes. It accepts an empty ciphertext part.
- A swapped record, swapped tenant, swapped field, and the `global` scope versus a tenant scope each
  fail.
- A relabeled header fails for every column: a `v2` value relabeled as `v1` (member ID, TOTP,
  **custom field, and provider TIN**), and a `v2` value with its `kid` changed. No fallback path is
  taken.
- Legacy `v1` without AAD:
  - opens for member ID and TOTP when the flag is on, `APP_ENV` is not `production`, and the date is
    before the expiry;
  - is refused when the flag is off, after the expiry date, and under `APP_ENV=production`,
    including when `NETLIFY` or `SITE_ID` is set;
  - is refused for custom fields and provider TINs.
- A `v1` provider TIN opens only with the PR #102 AAD, with no flag: a swapped tenant or a swapped
  provider fails.
- An unknown `kid` is refused, including `constructor`.
- The builders reject uppercase, non-UUID, and `|` input, and any scope other than a UUID or
  `global`.
- Boot refuses: the flag under production, `SEED_TOKEN` under production, a KCV mismatch, and a
  missing KCV under production. Each also holds when `SITE_ID` is set.
- The readers return typed failures and never throw.

**Integration**
- **Swapped-row and swapped-tenant member IDs.** Copy one patient's `member_id_enc` to another
  patient in the same tenant, and to a patient in another tenant.
  - The reveal fails on all three paths: patient chart, denial, and appeal.
  - The `security.field_integrity_failed` event **is committed** (read back after the request) and
    carries IDs only.
  - No plaintext appears in the response, the logs, or the audit metadata.
- **Swapped TOTP.** Copy a practice user's secret to another user, and the operator's secret to a
  practice user. Sign-in and step-up fail with the generic message, and the failure is audited.
- **Custom fields.** A save and a reveal with an uppercase `recordId` use the lowercase AAD, and the
  value opens through the normal lowercase path. A copied value audits
  `security.field_integrity_failed`.
- **837P builder.** A `tin_enc` copied from another provider gives a `billing_tin` refusal, and
  `security.field_integrity_failed` with `metadata.column = providers.tin_enc` is committed (read
  back after the call). A copied `member_id_enc` gives a `no_member_id` refusal, and the event from
  `openMemberId` is committed too. Neither value appears in the refusal or the audit metadata.
- **Seal counter.** Each seal increments `field_key_seals_k1`, including a seal in a transaction
  that rolls back.
- **Legacy values during the transition.** A `v1` member ID and a `v1` TOTP secret still open while
  the flag is on.
  - The fixtures are built with `node:crypto` in the test itself, because PR 5 deletes the old
    function.
- **Legacy values after the cut-off** (PR 5). The same fixtures are refused (`legacy_refused`),
  audited, and no decrypt is attempted. The CHECK rejects a `v1` value and `"x"`, and accepts a `v2`
  value with an empty ciphertext part.
- **Job.**
  - Tenant-isolated: a run for tenant A leaves tenant B's rows byte-identical.
  - Idempotent: a second run converts 0 rows and writes no `field_reencrypted` event.
  - Resumable: stopped after one batch, a new run completes.
  - **No stall:** with at least `limit` corrupt rows at the lowest IDs, the run still converts every
    good row, reaches `next = null`, and audits each corrupt row exactly once.
  - `source = 'fhir'` rows are never selected, are counted as `blocked` by `--verify`, and are left
    byte-identical.
  - **Swap laundering refused:** a `v1` member ID copied from another patient fails the last-4
    check, is not converted, and is audited.
  - **Audit in the same transaction:** when the `field_reencrypted` insert is made to fail, the
    batch's rows are unchanged.
  - The audit event has `metadata.principal`, `metadata.operator`, and `reason`. The CLI refuses to
    start without `--operator` and `--reason`.
  - Plaintext is unchanged after conversion, and `updated_at` is unchanged.
  - A row locked by another transaction is skipped, then converted by the next run.
  - No audit event lists more than `limit` IDs.
  - The users pass changes no column except `totp_secret_enc`.
  - A run leaves `providers.tin_enc` (`v1` and `v2`) byte-identical.
  - `verifyFormats` returns correct counts, including custom-field and provider TIN `openFailed`.
- **Endpoint.** `404` under `APP_ENV=production`, also with `SITE_ID` set, and without the token.
  `done` becomes true. A cursor posted back continues the run. Unknown body keys are rejected.
- **E2E.** The existing sign-in and step-up specs pass with `v2` secrets written by
  `global-setup.ts`.
- **R-15.9.** PR 3's `GRANT USAGE` on the counter sequence needs human sign-off in that PR. No
  other migration adds GRANT/REVOKE or SECURITY DEFINER, or changes audit tables or triggers.
  Running the job against **production** at a future rotation is a production action and needs a
  human (CLAUDE.md #2, #12).

### Rollback
- **PR 1 to PR 3:** revert. Stored values stay readable, as explained per PR above.
- **PR 4a and PR 4b:** revert the code. Converted rows are `v2` and remain readable. There is no
  reverse job, because returning to unbound `v1` would reopen the gap.
- **PR 5:** revert the code only. The CHECK prevents any non-`v2` row from existing, so nothing
  depends on the legacy path.
- **Data.** Pre-production can be wiped and re-seeded (synthetic). Keys are unchanged throughout: `k1`
  is the current key, and no key is destroyed.

### Key rotation interaction
- **No rotation during the transition.** `v1` means `k1`.
- **After PR 5, a rotation works like this:**
  1. Add a new active `kid` (the rotation ADR adds the key/`kid` set, the KCVs, and the counter
     sequence), and keep the old key as decrypt-only.
  2. Run the job with the selector "not `v2.<active>`".
  3. Verify.
  4. Retire the old key: remove it from encryption, and keep it decrypt-only while any backup,
     point-in-time copy, append-only history row, synced row, retention period, or legal hold may
     still reference its `kid` (ADR 0011 §6).
- **Destroying a key** is a disposal action (HC-10.2, R-9.2.3). It needs a legal-hold check
  (R-9.2.1) and sign-off from the Security Officer and the Privacy Officer. No key is destroyed
  until the legal-hold capability exists.
- **Trigger:** annually, or when `field_key_seals_<kid>` reaches 2^30 under NIST SP 800-38D §8.3
  (⚠️ VERIFY the wording at build).
- **Pre-production:** the key stays in the Netlify environment (HC-7.4 gap, OA-064).
- **Azure cutover:**
  - New Key Vault keys with a new `kid`. The Netlify key is never used in production.
  - Production starts empty, so nothing is converted.
  - Retrieval model, SDK, separation of duties, where the KCV lives, and per-tenant HKDF subkeys
    are decided in the cutover ADR.
  - The same job runs as a human-started Azure worker at rotation. The person who starts it and
    their IP or device are captured before any production run (threat model, "Blocking before real
    data").

### Risks
- **Transition window.** A database-level writer can swap one legacy `v1` ciphertext for another,
  because legacy values have no AAD to fail on.
  - The job refuses to reseal a member ID that fails the last-4 check.
  - There is no equivalent check for TOTP secrets.
  - Wipe and re-seed removes the risk. It affects pre-production only (synthetic data), and closes at
    PR 5.
- **Custom-field and provider TIN `v1` values stay readable after PR 5.** Their AAD stops a
  cross-row copy; a same-row rollback to an older `v1` value of that row is not detected (question
  12). Same-row replay of an older value is out of scope for every column: the AAD has no per-row
  version counter, so an older `v2` value of the same row also opens.
- **Pre-production values that no longer decrypt.** A pre-production row sealed under an earlier
  key cannot be converted. The job reports it, and the fix is to re-enter the member ID or reset MFA
  (open question 5).
- **Custom values sealed under an uppercase record ID** (a hand-typed URL). Today they open only
  through that exact uppercase string, not through links built from database IDs, which are
  lowercase. So PR 2's lowercasing should not make a normally reachable value unreadable.
  `verifyFormats` arrives after PR 2 (PR 4b), so the count (`openFailed`) is taken before the
  cut-off, not before the reader switch. A value that fails is audited on every read in between.
- **PI2b landed first without `sealMemberId`** (PR #98). Synced rows are `blocked` for the job;
  mitigation: the sync writer reseals them on its next run after PR 3, or pre-production is wiped
  and re-seeded. The cut-off waits for `blocked` = 0.
- **Key-check value missing in pre-production** until the operator sets it from the first
  `--verify` output. Until then boot only logs a warning.
- **Netlify function time limits** (⚠️ VERIFY; the seed route sets `maxDuration = 60`). The endpoint
  does bounded work per call, returns a cursor, and reports `done`.

### Open questions for the owner
In `docs/owner/OWNER_ACTION_ITEMS.xlsx`: questions 1–5 and 12 are OA-078, 6 is OA-102, 7–10 are OA-103,
and 11 is OA-104.
1. Approve ADR 0011: the `v2` envelope with `kid`, the header-bound AAD, and the `global` scope for
   TOTP secrets, including the platform operator.
2. Pre-production conversion: run the job, or wipe and re-seed after PR 3 is deployed?
   - **`security-reviewer` recommends wipe and re-seed.** It removes the swap-laundering risk
     (including for TOTP, which has no check value) and the conversion endpoint. It is acceptable
     legally, because the data is synthetic (R-7.1.3).
   - The cost: every tester and the operator re-enroll MFA, and practices created in the console
     are lost.
   - The job (PR 4a) is built either way, for annual rotation.
3. Who confirms the cut-off, and when, after the pre-production evidence (the `--verify` counts, or
   the PR 5 CHECK migration after a re-seed)?
4. Confirm the Azure production database starts empty, with no pre-production data carried over.
   That is why production refuses `v1` from day one.
5. Has the pre-production `FIELD_ENCRYPTION_KEY` ever been changed? If it has, some `v1` rows may
   already be unreadable. Is it acceptable that they are fixed by re-entering the member ID or
   re-enrolling MFA?
6. `src/lib/rate-limit.ts` reuses `FIELD_ENCRYPTION_KEY` as a hash salt. Approve a separate
   `RATE_LIMIT_HASH_KEY` in a follow-up PR, so keys are not shared across purposes and rotation does
   not reset rate-limit windows.
7. Rotation for append-only `custom_field_value_versions` and for synced patients: keep retired keys
   as decrypt-only indefinitely, or approve a re-encryption path? A re-encryption path would need
   R-15.9 sign-off, because it changes an append-only table and a security trigger. To be decided in
   the cutover ADR.
8. Key retirement, backups, and legal hold.
   - How long are backups and point-in-time copies kept in each environment, so a retired key's
     decrypt-only period can be set?
   - Confirm that no field key is destroyed until the legal-hold capability (R-9.2.1) exists.
   - Confirm that destroying a key needs a legal-hold check plus Security Officer and Privacy
     Officer sign-off.
9. Run one pre-production key-rotation drill with this job after the cut-off?
10. Should a future 835 or "find patient by member ID" feature get a tenant-keyed blind index (new
    ADR), or is it not needed for the MVP?
11. Should `rcm_claim_lines.account_number` be field-encrypted? No MUST rule requires it (HC-7.3,
    R-7.3.3), but it is an HC-1.1 identifier.
12. Production starts with no `v1` provider TINs. Should production refuse `v1` provider TINs, as
    it does member IDs, so a same-row rollback to an older `v1` TIN cannot happen there? If not,
    the rollback stays an accepted risk.
