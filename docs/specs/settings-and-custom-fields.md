# Spec: Settings and custom fields

Status: in progress (S1 done: Settings area + custom field definitions)
Roadmap item: owner request 2026-09-26 ("Setup" becomes an enterprise-grade Settings area)
Requirement IDs: R-3.5.1 (sensitive categories), R-5.1.2 (role-based access), R-7.2.4 (tenant isolation), R-7.5.1 (audit),
R-9.2.1 (retention: deactivate, never delete)

## Goal
Practice users find everything about how DenialDesk is set up in one **Settings** module with a
tab per section; administrators add their own fields to patients, claims, denials, and payers.

## User stories
- As any practice user, I can open Settings and see the practice profile and my own account.
- As an administrator, I can add a field (short text, long text, number, date, checkbox, choice
  list) to a record type, edit its label, help, choices, and required flag, and deactivate or
  reactivate it.
- As a manager, specialist, or compliance user, I can see which custom fields exist but not change them.

## Acceptance criteria
- [x] The module switcher's "Setup" module is renamed **Settings**; it holds "Settings" (signed-in
      users). (The "Design system" page was removed 2026-09-26, owner request.)
- [x] `/settings` has section tabs: General, Custom fields, Payers, Users and roles (planned),
      Security (planned), Notifications (planned), Integrations (planned).
      Planned tabs are labelled "Planned" and are never links.
- [x] General shows practice name, environment, data residency, and the signed-in user's name,
      email, role, and whether they can change settings.
- [x] Custom fields lists fields per record type (Patients, Claims, Denials, Payers) with the
      active count per type; label, key, type, required, status.
- [x] Only administrators see Add / Edit / Deactivate; server actions and the add/edit pages refuse
      other roles.
- [x] Record type, key, and type are fixed once a field exists (form, domain, and a database trigger).
- [x] Keys are lowercase `^[a-z][a-z0-9_]{0,39}$`, unique per practice and record type; suggested
      from the label when left blank.
- [x] Choice lists need 1–50 choices; other types store none (database check).
- [x] At most 50 active fields per record type (deactivating frees a slot; reactivating needs one).
- [x] Stale edits (the field changed since the form opened) are refused with a reload message.
- [x] Fields are never deleted (no DELETE grant); deactivated fields are hidden from forms.
- [x] Tenant isolation: RLS (forced) with an isolation test.
- [x] Every create / update / deactivate / reactivate is audited with IDs and enum values only.
- [x] An administrator can mark a field sensitive with one of the record sensitivity categories
      (HIV, mental health, substance use (42 CFR Part 2), genetic testing, minor, reproductive
      health); the list shows it as "Locked". Unknown categories are refused (app and database).
      Changing or removing a category is audited with both values (enum keys only).
- [ ] S2: values of a sensitive field are **locked** on every record: shown masked with an
      "Open" button; opening asks for a reason (as the member ID reveal does), shows the value for
      that view only, and writes an audit event (field ID, record ID, reason; never the value).
      Sensitive values are left out of lists, search, exports, and snapshots unless opened.
      Field-level encryption at rest for sensitive values and free-text types.
- [x] S2: record forms (patient, claim, denial, payer) render active fields and store values.
      (PR 2 done for patients: `/patients/new`, `/patients/[id]/edit`, `/patients/[id]`. PR 3 done
      for claims and denials, but as their own "edit custom fields" pages rather than folded into
      the claim/denial's own edit flow — see the PR 3 note below — since custom fields are
      practice-internal and must never create a claim version: `/claims/[id]/fields`,
      `/denials/[id]/fields`, and both detail pages show a read-only "Custom fields" panel. PR 4
      done for payers, the same standalone-page pattern, under Settings rather than a module of
      its own since there is no payer screen yet (`/settings/payers/[id]/fields`,
      `/settings/payers/[id]` read-only "Custom fields" panel) — see the PR 4 note below.)
- [x] S2: non-sensitive custom fields marked *Show in list* appear as columns on the record list;
      sensitive fields never appear in lists, search, or exports. At most 5 list columns per record
      type (`MAX_LIST_COLUMNS`, `src/domain/settings/custom-fields.ts`). Done for patients (PR 2,
      `src/domain/custom-fields/list-values.ts`, `PatientTable`) and for claims and denials (PR 3,
      `/claims`, `/denials`, shared `ListCell`). Done for payers (PR 4, `/settings/payers`).
- [ ] S3: Users and roles tab (invite, change role, disable), then Security and Notifications.

## Data / API changes
- New table `custom_fields` (drizzle/0023): definitions only. Classification: Internal
  configuration, not PHI. Labels are warned in the form never to contain patient information.
- Audit actions: `settings.custom_field_created|updated|deactivated|reactivated`, entity type
  `custom_field`.
- S2 will add `custom_field_values` (tenant-scoped, RLS, audited). Values on patient records are PHI
  and follow the patient record's audit and encryption rules; values for free-text types will be
  encrypted at rest at field level if they can hold identifiers (decide in S2's threat model).

- Labels, help, and choices are configuration and must never contain patient information (the
  form says so). Stored values (S2) need their own classification; S2 must decide field-level
  encryption for free-text types and add a sensitivity category to definitions (R-3.5.1) before
  any value is stored.

## Legal rules used
None.

## Out of scope
- Formula or computed fields. Reordering by drag and drop (fields
  keep creation order for now). Custom fields on accounting tables.

## Open questions
- Resolved 2026-09-26 (owner): S2 (values on records) is part of the Phase 1 MVP.
- Resolved 2026-09-26 (owner): administrators only create and change fields; role permissions
  are intentionally unchanged.
- Resolved 2026-09-26 (owner): masking follows the sensitivity category set on the field; non-sensitive
  free text is shown unmasked (threat model I5 accepted). ADR 0007 accepted.
- Resolved 2026-09-26 (owner, after PR 1 review): value history **is** kept — an append-only
  `custom_field_value_versions` table (ADR 0007 addendum) — reversing the earlier "no history yet"
  plan below. Also resolved: revealing a locked value uses the exact same roles as the member ID
  reveal (`canWorkDenials`).
- Open (PR 4, builder default, owner to confirm): who may change a payer's own custom field values.
  Payers have no natural "the people who bill" owner the way claims and patients do, so PR 4 used a
  new, narrower permission (`canEditPayerFields`: admin, manager) rather than reusing
  `canCorrectClaims`/`canEditPatients` (which also include specialists) — payers are practice
  configuration, closer to the custom field definitions themselves (administrators only) than to a
  record a front-line biller corrects. The owner may want specialists included, or may want this to
  match `canConfigureSettings` (administrators only) instead.

## Implementation plan (S2)

Design: ADR `docs/decisions/0007-custom-field-value-storage.md`. Threat model:
`docs/threat-models/custom-field-values.md`. All parts built by **builder** (no legal rules, no X12).
Ship as small PRs in this order: **PR 1** crypto AAD + table + domain (done); **PR 2** patients UI
(done: form render/store, detail masking/reveal, list columns); **PR 3** claims and denials (done:
record-level sensitivity extended to claim -> patient and denial -> claim -> patient; detail-page
panel and reveal; a standalone "edit custom fields" page per module, since custom fields are
practice-internal and must never create a `claim_versions` row, with its own values-table
concurrency token; list columns); **PR 4** payers (done: a new, minimal read-only payer record
under Settings — `/settings/payers` list, `/settings/payers/[id]` detail,
`/settings/payers/[id]/fields` edit — since there is no payer screen yet outside Settings; its new
read-only query module (`src/domain/payers/queries.ts`) reuses the generic values domain
unchanged, and payer name, EDI payer ID, and regime stay uneditable here (payer-catalog P2's job).
Payers have no linked patient, so they have no record-level sensitivity (`recordIsSensitive`
returns `false` for `payer`, tested). New permission `canEditPayerFields` (admin, manager — an
owner-confirmable choice, since payers are practice configuration rather than a record a biller
corrects) gates the fields edit page and action; reveal keeps the same `canWorkDenials` roles as
every other entity).

### Data model: `drizzle/0027_custom_field_values.sql` (values and value history in one migration) (+ `src/db/schema` entry)
`custom_field_values`: `id uuid pk`, `tenant_id uuid not null -> tenants`, `field_id uuid not null
-> custom_fields`, `patient_id`, `claim_id`, `denial_id`, `payer_id` (nullable FKs), `value_enc text`
(NULL = cleared), `created_by`, `updated_by -> users`, `created_at`, `updated_at`.
- CHECK `num_nonnulls(patient_id, claim_id, denial_id, payer_id) = 1`; CHECK
  `value_enc IS NULL OR length(value_enc) <= 8192`.
- Unique partial indexes `(tenant_id, field_id, patient_id) WHERE patient_id IS NOT NULL` (and one
  per record column); lookup index `(tenant_id, patient_id)` etc.
- Trigger `custom_field_values_guard` (BEFORE INSERT/UPDATE): field and record exist in
  `tenant_id` and the set column matches `custom_fields.entity`; `tenant_id`, `field_id`, record
  columns, `created_*` immutable. Confirmed: `payers` is tenant-scoped (`payers.tenant_id`), so the
  same tenant check applies uniformly to all four record columns.
- RLS ENABLE + FORCE, policy `tenant_isolation` as in 0023. `GRANT SELECT, INSERT, UPDATE` only
  (R-9.2.1).
- `custom_field_value_versions` (`drizzle/0026`, ADR 0007 addendum): append-only history of prior
  ciphertexts, written in the same transaction as an update or clear (never the first save). Same
  RLS shape; `GRANT SELECT, INSERT` only, plus an append-only trigger (no UPDATE/DELETE, even for
  the app role).

### Crypto
- `src/lib/crypto/field.ts`: optional `aad?: string` on `encryptField`/`decryptField`
  (`cipher.setAAD`). Tests: round trip with AAD, wrong AAD fails, no-AAD callers unchanged.

### Domain: `src/domain/custom-fields/values.ts` (+ `values.test.ts`)
- `serializeValue(field, raw)` / `parseValue(field, stored)`: per-type validation and canonical
  strings (text <= 200, long_text <= 4,000, number finite, date `YYYY-MM-DD`, checkbox
  `true|false`, select must be a current option). Required enforced for active fields only.
- `activeFieldsFor(tx, entity)` (reuse `src/domain/settings/queries.ts`).
- `loadValuesForRecord(tx, actor, entity, recordId)` returns
  `{ fieldId, key, label, type, masked: boolean, value?: typed }[]`; masked when the field has
  `sensitivity` or the record itself carries sensitivity tags — looked up inside the module (today:
  patients only), never trusted from the caller; masked values are **not decrypted**. Decrypt
  failure yields `{ unavailable: true }` and audits `custom_field.value_integrity_failed`. Audits
  `custom_field.values_read` once per call that decrypts at least one unmasked value (field IDs only).
- `saveValuesForRecord(tx, actor, entity, recordId, inputs): Promise<string[]>` upserts changed
  values only (compare decrypted), returns changed keys; called inside the record's create/update
  transaction so the record's `expectedUpdatedAt` check covers them. Masked sensitive values not
  re-submitted are left unchanged (the form never receives them). Writing a masked field is refused
  unless the actor may reveal it (same roles as reveal, below). The prior ciphertext of a changed or
  cleared value is appended to `custom_field_value_versions` before it's overwritten. Audits
  `custom_field.values_updated` with the changed keys when anything changed.
- `revealCustomFieldValue(tx, actor, { fieldId, entity, recordId, reason: RevealReason })`: limited
  to the same roles as the member ID reveal (`canWorkDenials`); refuses with no decrypt attempted
  unless the field belongs to the given entity, is active, and is actually masked. Decrypts one
  value and audits.

### Audit events (IDs and enum keys only, never values)
- Existing `patient.created|updated` metadata gains custom field keys in `changedFields` as `cf:<key>`
  (same for claim/denial/payer updates).
- `custom_field.value_revealed` (entityType `custom_field_value`, metadata: fieldId, entity,
  recordId, reason).
- `custom_field.value_integrity_failed` (fieldId, recordId).
- `custom_field.values_read` (entity, recordId, the decrypted field IDs — never masked ones).
- `custom_field.values_updated` (entity, recordId, the changed field keys).

### API / UI (patients first)
- `src/app/(app)/patients/actions.ts`: `registerPatient`/`savePatient` parse `cf.<fieldId>` form
  entries into `inputs`; new `revealCustomField(prev, formData)` action (fieldId, recordId, reason;
  same roles as `revealPatientMemberId`).
- `src/components/custom-fields/CustomFieldInputs.tsx`: renders active fields by type with label,
  help, required; sensitive fields show "Locked" and a "Change" button that clears and replaces
  (no prefill).
- `src/components/custom-fields/CustomFieldValues.tsx` + `MaskedCustomValue.tsx` (pattern of
  `MaskedMemberId.tsx`): read-only list on `/patients/[id]`; masked with "Open" + reason dialog;
  revealed value held in client state only.
- Wire into `PatientForm.tsx`, `patients/new`, `patients/[id]/edit`, `patients/[id]/page.tsx`.
  `PatientTable`, `PatientSearch`, and any export do **not** load values.
- Follow `docs/DESIGN.md`. No values in URLs, titles, or toasts.

### Tests
- Unit: serializer/validator per type and boundaries (200/201 chars, 4,000/4,001, empty required,
  unknown choice, inactive field); crypto AAD.
- Integration (`pnpm test:integration`): RLS isolation (tenant B cannot read/insert/update tenant A
  values); guard trigger rejects entity mismatch, cross-tenant record/field, two record columns,
  identity change; no DELETE grant; ciphertext copied to another row fails decrypt; sensitive values
  not decrypted in `loadValuesForRecord`; reveal audits without the value (assert value string absent
  from all `audit_events` rows); stale edit refuses both record and values; a role outside
  `canWorkDenials` is refused a reveal with no decrypt and no audit event, and refused a write to a
  masked field; `custom_field_value_versions` gets a row on update/clear but not on first save, is
  append-only (UPDATE/DELETE refused, no DELETE grant), and is tenant-isolated.
- Guard test: list/search/export query modules do not import `custom-fields/values`.
- E2E (Playwright, synthetic): admin adds a text and a sensitive field; user fills them on a new
  patient; detail shows text and masked sensitive; Open with reason shows value; list page does not.

### Risks
- Values not queryable (by design, ADR 0007).
- Patient-level sensitivity masks all values on that record: more clicks, safer default.
- Owner DB role and composite tenant FKs remain the existing open decisions.
