# ADR 0013: The claim drives the workflow, an encounter groups claims, and PHI is minimized by design

Status: Accepted (owner, in chat 2026-09-29). The encounter table itself is not built yet: it needs a
spec (`spec-writer`), a design pass (`architect`), and the owner's R-15.9 sign-off on its GRANT.

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
  results attach to the encounter when those features arrive.
- **Appointments are deferred** (Phase 3 or later). If ever added, an appointment is an optional,
  read-only import from the PM/EHR linked zero-or-one to an encounter, never required and never the
  driver.
- **DenialDesk is a PHI system and a HIPAA business associate.** Claims, remittances, denials, and
  appeals are payment information tied to a person, so they are PHI whether or not appointments
  exist. We do not claim or design toward "no PHI".
- **PHI minimization is a design rule** (`HIPAA_COMPLIANCE.md` HC-3.5 to HC-3.8): one copy of patient
  identity (the `patients` record); new tables reference it instead of copying names or account
  numbers; every spec states its PHI footprint; clinical attachments are not kept after they are
  sent unless a spec justifies it; analytics use aggregates or de-identified data; retention ends
  with disposal.

## Consequences
- Encounter work: spec → ADR/threat model → migration with RLS, isolation test, and backfill
  (R-15.9 sign-off on the GRANT). It is the natural place to answer the OA-084 split question.
- Minimization backlog (tracked, not waived, in `HIPAA_COMPLIANCE.md` Known gaps): `rcm_claim_lines`
  stores patient name and account number instead of referencing the patient; retention-based purge
  of closed cases is not built; stored PHI fields not used by a feature (for example patient phone)
  are reviewed against HC-3.4.
- The 837P still needs subscriber name, address, birth date, and member ID, so those stay.
- Holding only tokens with the PM/EHR as the sole source was considered and not chosen: data stays PHI
  while linkable, and appeal letters, 837P, and work queues need the real values.
