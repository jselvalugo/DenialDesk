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
      users) and "Design system" (pre-production only).
- [x] `/settings` has section tabs: General, Custom fields, Users and roles (planned), Security
      (planned), Notifications (planned), Integrations (planned), Design system (pre-production).
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
- [ ] S2: record forms (patient, claim, denial, payer) render active fields and store values.
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
- Capturing values on records (S2). Formula or computed fields. Reordering by drag and drop (fields
  keep creation order for now). Custom fields on accounting tables.

## Open questions
- Resolved 2026-09-26 (owner): administrators only create and change fields; role permissions
  are intentionally unchanged.
