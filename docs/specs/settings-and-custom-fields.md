# Spec: Settings and custom fields

Status: in progress (S1 done: Settings area + custom field definitions)
Roadmap item: owner request 2026-09-26 ("Setup" becomes an enterprise-grade Settings area)
Requirement IDs: R-5.1.2 (role-based access), R-7.2.4 (tenant isolation), R-7.5.1 (audit),
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
- [x] At most 50 fields per record type.
- [x] Stale edits (the field changed since the form opened) are refused with a reload message.
- [x] Fields are never deleted (no DELETE grant); deactivated fields are hidden from forms.
- [x] Tenant isolation: RLS (forced) with an isolation test.
- [x] Every create / update / deactivate / reactivate is audited with IDs and enum values only.
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

## Legal rules used
None.

## Out of scope
- Capturing values on records (S2). Formula or computed fields. Reordering by drag and drop (fields
  keep creation order for now). Custom fields on accounting tables.

## Open questions
- Should managers be allowed to add fields, or administrators only? (Built as administrators only.)
