# Spec: Welcome page

Status: done
Roadmap item: ERP shell follow-up (`specs/erp-shell.md`)
Requirement IDs: §11 (usability), R-7.11.5 (trust shown)

## Goal
Clicking the DenialDesk logo opens a welcome page that explains, at a high level, how the platform
works and where to start.

## User stories
- As a new practice user, I can see how a claim moves through DenialDesk so I know where to work.
- As any signed-in user, I can reach every module I have access to from one page.

## Acceptance criteria
- [x] The global-header logo links to `/welcome` (accessible name "DenialDesk home").
- [x] `/welcome` requires sign-in (inside the `(app)` group) and shows the user's first name,
      practice name, and today's date in the practice time zone.
- [x] "How DenialDesk works": five numbered steps (claims, classification, prioritization, appeals,
      outcomes). Shipped steps link to their page; unshipped steps show a "Planned" badge, never a link.
- [x] "From patient record to claim and denial" (owner request 2026-09-26): four numbered steps
      showing how the patient record (demographics, primary coverage) feeds claims, how charges
      arrive (CSV from the PM/EHR system; direct EHR connections out of scope per PRODUCT_BRIEF),
      filing and remittance, and how denials link back to the patient chart. Same shipped/planned rule.
- [x] "Your modules": the modules visible to this user (same list as the module switcher), each
      linking to its first shipped page; planned modules marked "Planned".
- [x] "Safeguards": factual platform commitments only (tenant isolation, audit trail, versioned
      deadline rules, human approval for coding changes, MFA + 15-minute idle timeout, field-level
      encryption of member IDs and no names in URLs, BAA on file per practice, missing ones flagged). No invented metrics. The safeguards text is
      a customer-facing compliance representation: any change needs `compliance-checker` review.
      Data-residency wording is left off until counsel approves it and production is live
      (Fla. Stat. § 408.051(3) allows U.S., territories, or Canada; U.S.-only is our policy, R-3.3.1).
- [x] Follows DESIGN.md §3: no gradients, imagery, emoji, or hero heading; panels with hairlines.
- [x] E2E: the logo opens `/welcome` and the page shows the four sections; record-flow steps 1 and 4 link, 2 and 3 are Planned.

## Data / API changes
None. Reads only the session (name, practice). No PHI; no audit event (no PHI read).

## Legal rules used
None.

## Out of scope
Per-user onboarding progress, product tours, marketing content, changing `/` (Denials overview).

## Open questions
None.
