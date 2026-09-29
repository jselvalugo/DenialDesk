# ADR 0013: The claim drives the workflow, an encounter groups claims, and PHI is minimized by design

Status: Proposed (owner agreed in chat 2026-09-29; becomes Accepted with the owner's written approval
on PR #107, required by HC-13.2 because this changes `HIPAA_COMPLIANCE.md`). The encounter table is not
built yet: it needs a spec (`spec-writer`), a design pass (`architect`), and the owner's R-15.9 sign-off
on its GRANT. Requirements: §8.2, §8.3, R-5.1.2, §9.2 (R-9.2.1 to R-9.2.3). Spec and threat model for
the encounter: pending.

## Context
The owner asked which table drives DenialDesk and whether an appointment table should become the
driver, since denials start at the visit. Today `claims` is the center: `claim_lines`,
`claim_versions`, `remittance_claims`, `prompt_pay_responses`, `denials`, and `appeals` all hang off
it, and the visit itself (patient, provider, location, service date) lives inside the claim. That does
not model one visit that leads to several claims: primary and secondary billing, a split of one PM
encounter (`specs/claims.md` C2, OA-084), and corrected or void claims (frequency 7/8, §8.3).

The owner also asked whether DenialDesk holds PHI without appointments, and wants to hold less of it.

## Options considered
1. **Appointment as the driver.** Rejected: payers adjudicate claims, not appointments (the 835 refers
   to the claim and its service lines); every legal clock (prompt pay, timely filing, appeal windows)
   runs from claim dates; appointments are no-showed, rescheduled, or absent (walk-ins); scheduling
   belongs to the practice's PM/EHR and would add an SIU/FHIR `Appointment` feed and more PHI.
2. **Keep the claim as the only anchor.** Rejected: nothing groups the claims of one visit.
3. **Encounter above the claim; claim stays the operational driver (chosen).**

## Decision
- **The claim stays the driver** of billing, legal deadlines, denials, and appeals. Denials stay
  attached to the claim and claim line.
- **A new `encounters` table becomes the parent of claims** (one encounter, one or more claims): the
  service event, referencing patient, provider, location, and date of service. It carries no new
  identity fields. Existing claims get one encounter each by backfill. Eligibility and prior-auth
  results attach to the encounter when those features arrive. The encounter spec decides whether
  `claims` keeps `patient_id`, `provider_id`, `location_id`, and `service_date` (with a constraint
  that they match the encounter) or drops them, so the two never drift apart.
- **Appointments are deferred** (Phase 3 or later). If ever added, an appointment is an optional,
  read-only import from the PM/EHR linked zero-or-one to an encounter, never required and never the
  driver.
- **DenialDesk is a PHI system and a HIPAA business associate.** Claims, remittances, denials, and
  appeals are payment information tied to a person, so they are PHI whether or not appointments
  exist. We do not claim or design toward "no PHI".
- **PHI minimization is a design rule** (`HIPAA_COMPLIANCE.md` HC-3.5 to HC-3.9): one copy of patient
  identity (the `patients` record); new tables reference it instead of copying names or account
  numbers; every spec states its PHI footprint; stored clinical attachments have a stated reason and
  retention period (early disposal is a counsel question, OA-105); analytics use aggregates or
  de-identified data; retention ends with disposal, never before legal hold exists.

## Consequences
- Encounter work: spec → ADR/threat model → migration with RLS, an isolation test, audit events on
  read and write (R-7.5.1), tenant-composite foreign keys to and from `claims` (FKs bypass RLS), and a
  backfill that keeps `tenant_id` and is covered by the isolation test (R-15.9 sign-off on the GRANT).
  The encounter holds PHI (date of service). It is the natural place to answer the OA-084 split
  question.
- Minimization backlog (tracked, not waived, in `HIPAA_COMPLIANCE.md` Known gaps): `rcm_claim_lines`
  stores patient name and PM account number instead of referencing the patient (needs an
  account-to-patient link first); specs written before this ADR have no PHI footprint; retention-based purge
  of closed cases is not built; stored PHI fields not used by a feature (for example patient phone)
  are reviewed against HC-3.4.
- The 837P still needs subscriber name, address, birth date, and member ID, so those stay. When the
  subscriber is not the patient (a dependant on someone else's policy), that identity has no approved
  home yet: open question for the encounter spec and C3b.
- Holding only tokens with the PM/EHR as the sole source was considered and not chosen: data stays PHI
  while linkable, and appeal letters, 837P, and work queues need the real values.
