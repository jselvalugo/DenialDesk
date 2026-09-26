# Spec: Welcome page

Status: in progress
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
- [x] "Your modules": the modules visible to this user (same list as the module switcher), each
      linking to its first shipped page; planned modules marked "Planned".
- [x] "Safeguards": factual platform commitments only (tenant isolation, audit trail, versioned
      deadline rules, U.S.-only residency, human approval for coding changes). No invented metrics.
- [x] Follows DESIGN.md §3: no gradients, imagery, emoji, or hero heading; panels with hairlines.
- [x] E2E: the logo opens `/welcome` and the page shows the three sections.

## Data / API changes
None. Reads only the session (name, practice). No PHI; no audit event (no PHI read).

## Legal rules used
None.

## Out of scope
Per-user onboarding progress, product tours, marketing content, changing `/` (Denials overview).

## Open questions
None.
