# ADR 0007: Custom field values are stored encrypted, one row per record and field

Status: Accepted (2026-09-26, owner; proposed by architect; spec `docs/specs/settings-and-custom-fields.md` S2)

## Context
S2 stores administrator-defined values on patient, claim, denial, and payer records. Values on
patients, claims, and denials are PHI; free text can hold anything (member IDs, diagnoses, notes),
and any field can be marked sensitive (R-3.5.1) at any time, including after values exist.
CLAUDE.md #6 requires field-level encryption for identifiers. Values are not searched, sorted, or
filtered in MVP (spec: excluded from lists, search, exports).

Options considered:
1. JSONB column on each record table (plaintext). Rejected: plaintext PHI of unknown content,
   four migrations, sensitivity changes would need re-encryption.
2. Typed plaintext columns, encrypt only text and sensitive fields. Rejected: a field marked
   sensitive later would leave plaintext history in the table and WAL/backups; two code paths.
3. **One `custom_field_values` table; every value encrypted** with the existing AES-256-GCM helper
   (`src/lib/crypto/field.ts`), bound to its row with additional authenticated data (AAD).

## Decision
- Option 3. Every value, of every type, is stored only as `value_enc` (the typed value is
  serialized to a canonical string, then encrypted). No plaintext value column exists.
- AAD = `tenant_id|field_id|record_id`. `encryptField`/`decryptField` gain an optional `aad`
  argument (format stays `v1`; GCM authenticates AAD without storing it). A ciphertext copied into
  another row, record, or tenant fails to decrypt. Existing callers are unchanged.
- The record is referenced by one of four nullable FK columns (`patient_id`, `claim_id`,
  `denial_id`, `payer_id`); a CHECK requires exactly one, and a trigger requires it to match the
  field's `entity` and tenant. This keeps real foreign keys instead of a polymorphic ID.
- Masking is decided at read time from the field definition's `sensitivity`, so marking a field
  sensitive protects existing values immediately with no data migration.

## Consequences
- Values cannot be queried by SQL (no search, reports, or uniqueness on values). A future
  "filter by custom field" needs a new ADR (for example a keyed HMAC blind index for choice lists).
- Every record page decrypts up to 50 values per record; cheap (AES-GCM, in-process), measured in
  the integration test.
- Key rotation follows the existing `v1` prefix plan; AAD does not change it.
- No new dependency. U.S. residency unchanged (Azure Key Vault in U.S. region holds the key in
  production, ADR 0002).

## Addendum (2026-09-26, owner, reviewer findings on PR 1)

- **History is kept.** A new append-only table, `custom_field_value_versions`, stores the ciphertext
  a `custom_field_values` row held just before an update or a clear (never on the first save, since
  there is no prior state then), with `changed_by`/`changed_at`. Same tenant-scoped RLS as the parent
  table; `GRANT SELECT, INSERT` only (no UPDATE/DELETE grant), plus an append-only trigger
  (`audit_events` pattern). Superseded the earlier "no history yet" framing in the spec.
- **Reveal roles match the member ID reveal exactly.** `revealCustomFieldValue` is limited to the
  same roles as `revealPatientMemberIdFor` / `revealMemberId` (`canWorkDenials`: admin, manager,
  specialist) — R-5.1.2 minimum necessary, one role list for every "open a locked value" action. It
  also refuses (with no decrypt attempted) unless the field belongs to the given entity, is active,
  and is actually masked (sensitive, or the record itself carries sensitivity tags); there is
  nothing to reveal on an ordinary value.
- **Record-level sensitivity is looked up, not trusted from the caller.** `loadValuesForRecord`,
  `saveValuesForRecord`, and `revealCustomFieldValue` each resolve whether the target record itself
  carries sensitivity tags (today: patients only) inside the domain module, rather than accepting a
  `recordSensitive` flag from the caller.
- **Writing a masked value needs reveal permission.** `saveValuesForRecord` refuses to write a field
  that is masked (sensitive, or on a sensitivity-tagged record) unless the actor may reveal it —
  otherwise masking would be cosmetic, since anyone editing the record could silently overwrite a
  locked value.
- **Two more audit actions**: `custom_field.values_read` (once per `loadValuesForRecord` call that
  decrypts at least one unmasked value; the decrypted field IDs, never values) and
  `custom_field.values_updated` (the changed field keys, never values), alongside the existing
  `custom_field.value_revealed` / `custom_field.value_integrity_failed`.
- **Crypto hardening**: `decryptField` now rejects a stored auth tag that isn't exactly 16 bytes
  before calling into Node's crypto, and both `encryptField`/`decryptField` pass
  `{ authTagLength: 16 }` explicitly rather than relying on the library default.
- **Insert race**: `saveValuesForRecord` upserts a first value with `INSERT ... ON CONFLICT
  (tenant_id, field_id, <record column>) WHERE <record column> IS NOT NULL DO UPDATE`, so two
  concurrent first saves of the same field/record can't both race a plain INSERT into the partial
  unique index and fail.
