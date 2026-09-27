# Spec: Patient records

Status: in progress — P1 approved by delegated technical authority (2026-09-26)
Roadmap item: Phase 1 → practice setup (REQUIREMENTS §8.1) and charge capture prerequisites (§8.2)
Requirement IDs: R-3.5.1, R-3.4.3, R-5.1.2, R-7.2.4, R-7.3.3, R-7.5.1, R-15.1, §8.2

> **Superseded in part by `specs/patient-integrations.md`** (owner decision 2026-09-27, ADR 0010).
> The practice's EHR/PM becomes the system of record; DenialDesk keeps a read-only synced copy of
> the billing minimum. Once a practice has a non-draft Patients connection (active, paused, or
> error): "Register patient" and "Edit" are hidden and `registerPatient`/`savePatient` refuse, for
> synced and legacy manual patients alike; synced patients show "Synced from <connection>" and a
> read-only notice; phone is not synced (null); payer comes only from an administrator's payor
> mapping. Still editable on synced patients: sensitivity tags (administrators) and custom field
> values. Without a connection, the P1 forms below work unchanged (transition; retiring manual
> registration is an owner question).

## Goal
The patient is the record every claim, and through claims every denial, hangs off. Until now
patients existed only as seeded rows shown inside claim and denial pages. Staff can now find,
register, and update a patient, and open one chart that connects the patient's coverage, claims,
denials, and balances.

## Phases
| Phase | Scope |
|---|---|
| **P1** (this PR) | Patient list, search, register, edit demographics and primary coverage, patient chart linking claims and denials; links from claims and denials back to the patient; navigation entry |
| P2 | Secondary coverage (coordination of benefits), subscriber other than the patient, eligibility (270/271) results |
| P3 | Accounting of disclosures export per patient (R-5.1.1) from the audit log; demographic version history |
| P4 | Enforce sensitivity tags in queries and masking (R-3.5.1, R-3.5.2) — tracked as a deferred finding |

## User stories
- As a billing specialist, I can register a new patient with demographics and primary insurance so
  a claim can be created for them (C2 charge import will match on MRN).
- As a billing specialist, I can find a patient by name or MRN without the search appearing in a URL.
- As any team member, I can open a patient and see all of their claims and denials, with totals, and
  jump to any of them.
- As an administrator, I can mark a patient's record with sensitivity tags (HIV, mental health, SUD,
  genetic, minor, reproductive health).
- As a compliance reviewer, I can view patients but not change them (R-5.1.2).

## Acceptance criteria (P1)
- [x] `/patients` lists patients alphabetically (last, first), 25 per page; pagination uses only
      the page number in the URL.
- [x] Search by name or MRN runs as a server action (POST), so search terms never appear in URLs,
      logs, or analytics (CLAUDE.md #4). At most 25 results; the search is audited with result IDs
      and count, never the terms.
- [x] Register (`/patients/new`) and edit (`/patients/[id]/edit`) for admin, manager, and specialist;
      compliance sees the record read-only and the server actions refuse it.
- [x] Fields: MRN (blank = generated), first and last name, date of birth (not in the future, not
      before 1900), administrative sex (F/M/U, as on the 837P), address (line, city, state, ZIP),
      phone, primary payer (from the practice's payers), member ID.
- [x] Member ID is encrypted at the field level (AES-256-GCM, R-7.3.3); only the last 4 are stored in
      clear. On edit, leaving the member ID blank keeps the current one.
- [x] Revealing the full member ID on the chart requires a reason and writes
      `patient.member_id_revealed` (same as the denial page), for roles that work denials.
- [x] In synthetic-only environments (everything but Azure production) MRNs and member IDs must
      start with `SYN`, and the form says so (R-15.1).
- [x] Editing requires a reason (amendment trail); the audit event lists changed field names only.
      Tag changes also write `patient.sensitivity_changed` with the tag keys added and removed.
- [x] In synthetic-only environments, registering or editing requires ticking "this record is
      synthetic test data".
- [x] A member ID belongs to one payer: changing the payer requires a new member ID; self-pay clears it.
- [x] Only administrators see sensitivity tag names; other roles see "Restricted".
- [x] MRN is unique per practice; a duplicate is reported as a form error, not a crash.
- [x] Primary payer must belong to the practice: checked in code and by a tenant-scoped composite
      foreign key `(tenant_id, primary_payer_id) → payers (tenant_id, id)`.
- [ ] Sensitivity tags can be set by administrators only; tags are shown on the chart.
      Hidden 2026-09-26 by owner decision: the form no longer shows the tag checkboxes, stored tags
      are kept on save and still shown on the chart. New records cannot be tagged until a
      tagging path returns (R-3.5.1 gap, accepted by the owner).
- [x] Patient chart: demographics, coverage, totals (claims, billed, paid, open denied amount),
      claims table (links to `/claims/[id]`), denials table (links to `/denials/[id]`).
- [x] Claim and denial detail pages link the patient name to the chart; the claims list links it too.
- [x] "Patients" is its own module in the module switcher (`specs/erp-shell.md`), available to every role.
- [x] Page titles never include patient data (DESIGN.md §12).
- [x] Audit events: `patient.list_viewed`, `patient.searched`, `patient.viewed`,
      `patient.created`, `patient.updated` (IDs, counts, field names; never values).
- [x] Tenant isolation: another practice's patient returns 404; tests cover create, update, and read.

- [x] 2026-09-27: all four screens rebuilt on the record pattern (`specs/record-pages.md`): list
      toolbar with count, MRN chip, age beside the date of birth, sex, location, and coverage
      columns; chart with a record header (tags, MRN, birth date, sex, coverage), claim and denial
      counts, and a Record panel (created / updated); sectioned register and edit forms.

## Data / API changes
Migration `0018_patients_record`:
- `patients`: `sex` (F/M/U, default U), `address_line1`, `city`, `state` (2 letters), `postal_code`
  (ZIP or ZIP+4), `phone`, `primary_payer_id`, `updated_at`. CHECKs on sex, state, ZIP, and name/MRN
  lengths.
- `payers_tenant_id_key` unique `(tenant_id, id)` and composite FK `patients_primary_payer_fk`.
- Backfill: each existing patient's primary payer = payer of their most recent claim, run tenant by
  tenant (FORCE RLS).

Classification: Restricted PHI (REQUIREMENTS §9.1), unchanged table. State of residence supports
R-3.4.3 (affected individuals by state).

## Legal rules used
None (no legal clock).

## Out of scope
Merging duplicate patients, deleting patients (retention, R-9.2), linking revenue cycle file lines
(those carry the PM system's own patient name, not our patient ID), patient portal.

## Open questions
- Should front-desk registration be a separate role from billing specialists?
- Do we need guarantor (responsible party) now, or only with patient statements (§8.6)?
