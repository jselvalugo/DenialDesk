# Spec: Bind AAD on every encrypted field (close SC-B7.1)

Status: draft (2026-09-28, architect). The owner must approve it with ADR 0011 before it is built.
Roadmap item: Security hardening, `docs/SECURE_CODING.md` known gap SC-B7.1 (`docs/PROJECT_STATE.md` "Next up")
Requirement IDs: R-7.3.3, R-7.3.4, R-7.2.4, R-7.5.1, R-7.4.1, R-7.4.5, R-7.4.8, R-7.2.2, R-7.1.3, R-15.1

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
Design: ADR 0011. It covers the envelope, the AAD bytes, and the legacy policy.

### Primitive
- [ ] `src/lib/crypto/field.ts` has two new functions.
  - `sealField(plaintext, aad)` writes `v2.<kid>.<iv>.<tag>.<ct>` with a fresh 12-byte IV.
  - `openField(payload, aad, policy)` chooses its path by the version prefix only, with no fallback.
  - `aad` is a branded `FieldAad`.
- [ ] `src/lib/crypto/aad.ts` builds AAD for three fields and holds each column's `v1` policy.
  - The builders are `memberIdAad(tenantId, patientId)`, `totpSecretAad(userId)`, and
    `customFieldAad(tenantId, fieldId, recordId)`. The last replaces the two copies of `aadFor` in
    `src/domain/custom-fields/`.
  - The builders reject non-canonical UUIDs.
- [ ] `v1` without AAD opens only for `patients.member_id` and `users.totp_secret`. It needs the
      transition flag and `syntheticDataOnly()`.
  - Production refuses it with `LegacyFieldFormatError`.
  - `v1` custom field values still open with their ADR 0007 AAD.
- [ ] `kid` handling.
  - `FIELD_ENCRYPTION_KEY_ID` is optional and defaults to `k1`.
  - An unknown `kid` is refused.
  - `v1` is always read with `k1`.
  - The app refuses to boot if legacy read is enabled and the active `kid` is not `k1`.

### Member IDs
- [ ] Two new helpers in `src/domain/patients/member-id.ts`.
  - `sealMemberId(tenantId, patientId, value)`.
  - `openMemberId(tx, actor, patientId, enc)`. On failure it audits
    `security.field_integrity_failed` with the patient ID and a reason code, never the value, and
    returns the key `error.memberIdUnavailable` (en/es/pt, in the patients, denials, and appeals
    dictionaries).
- [ ] These call sites switch to the helpers.
  - `createPatient` (the patient ID is generated before the insert), `updatePatient`, and
    `revealPatientMemberIdFor`.
  - Both `revealMemberId` actions (denials and appeals).
  - `seedPractice`.
- [ ] The tenant in the AAD comes from the session (`actor.tenantId`), not from the row.

### TOTP secrets
- [ ] `sealTotpSecret(userId, secret)` and `openTotpSecret(userId, enc)` in `src/auth/totp-secret.ts`.
  They are used by `pendingEnrollmentSecret` and `claimTotp`, so they cover practice sign-in,
  operator sign-in, and step-up.
- [ ] An integrity failure fails closed.
  - The user sees the same generic code-mismatch message, so account state is not revealed.
  - `security.field_integrity_failed` is audited with the user ID.
  - Recovery is the existing MFA reset. For a practice admin that is admin repair
    (`src/db/demo.ts`). For the operator it is a credential rotation (`src/auth/operator-account.ts`).
- [ ] Test and E2E setup (`test/e2e/global-setup.ts`, `test/integration/step-up-session.test.ts`)
      use `sealTotpSecret`.

### Re-encryption job
- [ ] `src/domain/crypto/reencrypt.ts` exports `reencryptBatch({ column, tenantId?, limit })` and
      `verifyFormats()`.
- [ ] Patients pass.
  - Runs per tenant through `withTenantAsSystem`: the `denialdesk_app` role with RLS. It reuses
    PI2b's helper if that has merged, and otherwise adds it with the same design.
  - Each batch is `FOR UPDATE SKIP LOCKED`, `ORDER BY id`, with `limit` of 100 by default and 200 at
    most.
  - Each row is written with a compare-and-swap on the old ciphertext. `updated_at` is not changed.
  - `source = 'fhir'` rows are skipped and counted as `blocked`.
- [ ] Users pass. The same steps through `systemDb()`; only `totp_secret_enc` changes.
- [ ] Audit.
  - Each non-empty batch writes one `security.field_reencrypted` event in its own transaction.
    - Metadata: `column`, `count`, `recordIds` (comma-joined), `fromFormat`, `toFormat`, `kid`, and
      `trigger` (`cli` or `preview_endpoint`).
    - `actorUserId` is null. `principal` is `field-reencrypt`.
  - A row that fails to decrypt stays unchanged and writes `security.field_integrity_failed`.
  - An empty batch writes no event.
- [ ] Idempotent and resumable: running the job twice converts 0 rows the second time. An
      interrupted run resumes where it stopped, because the selector is the checkpoint.
- [ ] How the job is run.
  - CLI `pnpm crypto:reencrypt [--column …] [--verify]` (`scripts/reencrypt-fields.ts`).
  - Pre-production endpoint `POST /api/preview/reencrypt`.
    - It needs `SEED_TOKEN` and `syntheticDataOnly()`, and is rate-limited.
    - One call does a bounded number of batches within a time budget.
    - It returns counts only.
- [ ] `verifyFormats()` returns counts per column (`v1`, `v2Active`, `v2Other`, `blocked`,
      `unparseable`). The counts are summed across tenants under RLS, and one
      `security.field_formats_verified` event records them.
- [ ] Logs carry event names and counts only (SC-B9.1).

### Cut-off
- [ ] Cut-off happens when all of these hold.
  - The shared pre-production database verifies at `v1 = 0`, `blocked = 0`, and no unresolved
    integrity failures, for both columns.
  - The owner confirms.
- [ ] At cut-off:
  - The no-AAD branch and the old `encryptField`/`decryptField` exports are removed.
  - The migration adds `CHECK (<col> IS NULL OR <col> NOT LIKE 'v1.%')` on `patients.member_id_enc`
    and `users.totp_secret_enc`, mirrored into `netlify/database/migrations/`.
  - The `docs/SECURE_CODING.md` SC-B7.1 row and `docs/PROJECT_STATE.md` are updated.
- [ ] After cut-off, a `v1` member ID or TOTP secret is a hard failure: audited, generic message,
      no decrypt attempted.

### Tests
See "Tests" below; SC-B11.1 negative tests are required.

## Data / API changes
- **No new table and no new column.** One migration at cut-off adds two CHECK constraints.
- **No change to grants, SECURITY DEFINER, triggers, or `audit_events`.** So no R-15.9 sign-off is
  needed.
- **Environment:** `FIELD_ENCRYPTION_KEY_ID` (optional, default `k1`).
- **Route:** `POST /api/preview/reencrypt`, pre-production only.
- **Script:** `pnpm crypto:reencrypt`.
- **Audit actions:** `security.field_reencrypted`, `security.field_integrity_failed`, and
  `security.field_formats_verified`. They are added to the TypeScript union in `src/lib/audit.ts`;
  there is no database constraint to change.
- **Classification (§9.1).** Member IDs are Restricted PHI and are unchanged. TOTP secrets are
  credentials (Secret). Counts and record IDs in audit and output are Internal.

## Legal rules used
None (no legal clock).

## Out of scope
- Key rotation itself: multiple keys, Key Vault, the rotation runbook. The envelope and the job are
  ready for it; the Azure cutover ADR decides it.
- Re-encrypting `custom_field_value_versions`, which is append-only.
- A blind index for member ID lookup.
- `src/lib/rate-limit.ts` reusing `FIELD_ENCRYPTION_KEY` (see open questions).
- Plaintext `rcm_claim_lines.account_number`, a patient account number. It is not in R-7.3.3's list.
  ⚠️ VERIFY with `compliance-checker`.

## Open questions
Listed at the end of the implementation plan.

## Implementation plan

**Agents.**
- **builder** builds every PR below.
- **florida-rules-engine** is not involved: there are no legal values.
- **edi-x12-specialist** is not involved now. It is consulted only if a later 835 feature needs
  member ID matching (blind index, new ADR).
- **Reviewers.** `security-reviewer` reviews every PR, and `compliance-checker` reviews PR 4 and
  PR 5.
- **SOC 2 controls:** CC6.1 (encryption and key management), CC6.7 (data protection), CC7.2
  (integrity monitoring through audit), CC8.1 (change management). ⚠️ VERIFY the mapping with
  `compliance-checker`.

**Ordering is expand, then convert, then contract.** Each PR can be reverted on its own without
making stored data unreadable.

### PRs
Each PR is under about 400 changed lines, not counting generated drizzle snapshots.

**PR 0: design (this document)** [R-7.3.3, R-7.4.5]
- ADR 0011, this spec, and the threat model. Docs only.

**PR 1: `feat(crypto): v2 envelope with key ID and mandatory AAD [R-7.3.3, R-7.3.4]`** (about 330 lines)
- `src/lib/crypto/field.ts`: `sealField`, `openField`, `LegacyFieldFormatError`,
  `UnknownFieldKeyError`, and a one-key keyring. The old `encryptField`/`decryptField` stay for now
  and are marked deprecated.
- `src/lib/crypto/aad.ts`: the builders, `FieldAad`, and the per-column `v1` policy.
- `src/lib/env.ts`: `FIELD_ENCRYPTION_KEY_ID`.
- Unit tests. No caller changes, so no data changes; reverting is always safe.

**PR 2: `refactor(crypto): route every decrypt through AAD-aware readers [R-7.3.3, R-7.5.1]`** (about 380 lines)
- New `src/domain/patients/member-id.ts` and `src/auth/totp-secret.ts`.
- Switches every decrypt in the inventory: `queries.ts:555`, the denials and appeals actions,
  `enrollment.ts:19`, and `credentials.ts:174`.
- Switches custom fields to `openField` with `customFieldAad`.
- Adds the audit actions and the three i18n keys.
- Writers still write `v1`, so reverting is safe.

**PR 3: `feat(crypto): write member IDs and TOTP secrets as v2 with AAD [R-7.3.3, R-7.2.4]`** (about 300 lines)
- Switches every encrypt in the inventory: `queries.ts:346/421/423`, `seed.ts:256`,
  `enrollment.ts:23`, and `values.ts:505`.
- `createPatient` gets the app-side `randomUUID()` ID.
- Updates E2E and integration setup to `sealTotpSecret`/`sealMemberId`.
- Adds the swapped-row and swapped-tenant tests.
- Reverting is safe, because the PR 2 readers still read `v2`.

**PR 4a: `feat(crypto): resumable re-encryption job and format verification [R-7.3.3, R-7.5.1, R-7.2.4]`** (about 400 lines)
- `src/domain/crypto/reencrypt.ts`.
- `withTenantAsSystem` in `src/db/tenant.ts`, unless PI2b has added it.
- `scripts/reencrypt-fields.ts` and the `package.json` script.
- Integration tests.

**PR 4b: `feat(preview): pre-production re-encryption endpoint and runbook [R-7.3.3, R-7.1.3]`** (about 200 lines)
- `src/app/api/preview/reencrypt/route.ts`: the `SEED_TOKEN` check (`src/lib/seed-token.ts`), the
  `syntheticDataOnly()` guard, a new rate-limit bucket, and counts-only responses.
- New `docs/runbooks/field-encryption-reencrypt.md`: run, verify, and recover from integrity
  failures by re-entering the member ID or resetting MFA.
- Update `docs/runbooks/netlify.md`.

**Run.** Run the job on the shared pre-production database, then `--verify`. Local databases can
simply be re-seeded. CI databases are fresh on every run. An old deploy-preview branch that fails
after the cut-off is deleted or re-seeded (synthetic data).

**PR 5: `feat(crypto): refuse legacy unbound ciphertexts [R-7.3.3]`** (about 250 lines)
- Remove the no-AAD branch and the deprecated exports.
- Migration `drizzle/00NN_field_format_v1_refused.sql` with its Netlify mirror: the two CHECK
  constraints.
- Tests move to "refused after the cut-off".
- Remove the SC-B7.1 row from `docs/SECURE_CODING.md` and update `docs/PROJECT_STATE.md`.
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
    ID with `sealMemberId(tenant, thatRowId, value)`.
  - `replaced-by` only sets `source_status = 'merged'`. Nothing moves, and merge tooling is out of
    scope there.
  - A new synced row needs its ID before it is inserted.
  - **Dependency:** PI2b's sync writer must use `sealMemberId`, so `blocked` stays 0. `spec-writer`
    should add this to PI2b.
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
  - Test fixtures that insert `memberIdEnc: "x"` still satisfy the `NOT LIKE 'v1.%'` CHECK.

### Tests
**Unit** (`src/lib/crypto/field.test.ts`, `aad.test.ts`)
- Round trip.
- A fresh IV on each seal.
- The parser rejects bad inputs: wrong part count, a bad `kid`, IV not 12 bytes, tag not 16 bytes.
- A swapped record, swapped tenant, swapped field, and the `global` scope versus a tenant scope each
  fail.
- A `v2` value relabeled as `v1` fails. No fallback path is taken.
- Legacy `v1` without AAD:
  - opens for member ID and TOTP while `syntheticDataOnly()` is true;
  - is refused under `APP_ENV=production` off Netlify;
  - is refused for custom fields.
- An unknown `kid` is refused.
- The builders reject uppercase, non-UUID, and `|` input.

**Integration**
- **Swapped-row and swapped-tenant member IDs.** Copy one patient's `member_id_enc` to another
  patient in the same tenant, and to a patient in another tenant.
  - The reveal fails on all three paths: patient chart, denial, and appeal.
  - The audit event carries IDs only.
  - No plaintext appears in the response, the logs, or the audit metadata.
- **Swapped TOTP.** Copy a practice user's secret to another user, and the operator's secret to a
  practice user. Sign-in fails with the generic message and is audited.
- **Legacy values during the transition.** A `v1` member ID and a `v1` TOTP secret still open.
  - The fixtures are built with `node:crypto` in the test itself, because PR 5 deletes the old
    function.
- **Legacy values after the cut-off** (PR 5). The same fixtures are refused with
  `LegacyFieldFormatError`, audited, and no decrypt is attempted. The CHECK rejects a `v1` insert.
- **Job.**
  - Tenant-isolated: a run for tenant A leaves tenant B's rows byte-identical.
  - Idempotent: a second run converts 0 rows and writes no audit event.
  - Resumable: stopped after one batch, a later run completes.
  - Plaintext is unchanged after conversion, and `updated_at` is unchanged.
  - `source = 'fhir'` rows are counted as `blocked` and left alone.
  - A row locked by another transaction is skipped, then converted on the next pass.
  - A corrupt row is audited and left in place.
  - No audit event lists more than `limit` IDs.
  - The users pass changes no column except `totp_secret_enc`.
  - `verifyFormats` returns correct counts.
- **E2E.** The existing sign-in and step-up specs pass with `v2` secrets written by
  `global-setup.ts`.
- **R-15.9.** None of the migrations above adds GRANT/REVOKE or SECURITY DEFINER, or changes audit
  tables or triggers, so none needs human sign-off. Running the job against **production** at a
  future rotation is a production action and needs a human (CLAUDE.md #2, #12).

### Rollback
- **PR 1 to PR 3:** revert. Stored values stay readable, as explained per PR above.
- **PR 4:** revert the code. Converted rows are `v2` and remain readable. There is no reverse job,
  because returning to unbound `v1` would reopen the gap.
- **PR 5:** revert the code only. The CHECK prevents any `v1` row from existing, so nothing depends
  on the legacy path.
- **Data.** Pre-production can be wiped and re-seeded (synthetic). Keys are unchanged throughout: `k1`
  is the current key, and no key is destroyed.

### Key rotation interaction
- **No rotation during the transition.** `v1` means `k1`.
- **After PR 5, a rotation works like this:**
  1. Add a new active `kid` and keep the old key as decrypt-only.
  2. Run the job with the selector "not `v2.<active>`".
  3. Verify.
  4. Retire the old key.
- **Trigger:** annually, or at an estimated 2^30 encryptions per key under NIST SP 800-38D §8.3
  (⚠️ VERIFY). The estimate comes from write audit events.
- **Pre-production:** the key stays in the Netlify environment (HC-7.4 gap, OA-064).
- **Azure cutover:**
  - New Key Vault keys with a new `kid`. The Netlify key is never used in production.
  - Production starts empty, so nothing is converted.
  - Retrieval model, SDK, and separation of duties are decided in the cutover ADR.
  - The same job runs as a human-started Azure worker at rotation.

### Risks
- **Transition window.** A database-level writer can swap one legacy `v1` ciphertext for another,
  because legacy values have no AAD to fail on. This affects pre-production only (synthetic data),
  and closes at PR 5.
- **Pre-production values that no longer decrypt.** A pre-production row sealed under an earlier
  key cannot be converted. The job reports it, and the fix is to re-enter the member ID or reset MFA
  (open question 5).
- **PI2b landing first without `sealMemberId`.** That would create `blocked` rows, which the trigger
  prevents the job from fixing. Mitigation: the PI2b dependency above.
- **Netlify function time limits** (⚠️ VERIFY): the endpoint does bounded work per call and the
  caller loops.

### Open questions for the owner
In `docs/owner/OWNER_ACTION_ITEMS.xlsx`: questions 1-5 are OA-074, 6 is OA-075, and 7-9 are OA-076.
1. Approve ADR 0011: the `v2` envelope with `kid`, the AAD formats, and the `global` scope for TOTP
   secrets, including the platform operator.
2. Pre-production conversion: run the job (recommended, and needed anyway for annual rotation), or
   wipe and re-seed? Re-seeding is acceptable legally, because the data is synthetic (R-7.1.3). The
   cost: every tester and the operator re-enroll MFA, and practices created in the console are lost.
3. Who confirms the cut-off, and when, after the pre-production `--verify` shows zero legacy rows?
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
8. Run one pre-production key-rotation drill with this job after the cut-off?
9. Should a future 835 or "find patient by member ID" feature get a tenant-keyed blind index (new
   ADR), or is it not needed for the MVP?
