# Spec: DenialDesk visual identity

Status: done (2026-09-26) — requested by the product owner
Roadmap item: Phase 0 → design system foundation (amendment)
Requirement IDs: §11 (WCAG 2.1 AA), R-7.4.8 (no third-party requests carrying PHI)

## Goal
DenialDesk's own visual identity (navy chrome, teal accent, serif page titles, mono figures) around
the DenialDesk logo, kept exactly as designed. DenialDesk is a standalone product: no other
product's name, assets, or code is referenced.

## Acceptance criteria
- [x] Navy sidebar with icons, uppercase section labels, active item highlighted with a teal bar;
      the logo stays unaltered on a white header.
- [x] Navy primary buttons; serif (Playfair Display) page titles; Inter for UI; Space Mono for codes
      and stat-tile figures; uppercase letter-spaced table headers and stat labels.
- [x] Status, link, and chart colors, every text/background pair ≥ 4.5:1 and
      UI boundaries ≥ 3:1 (values in `docs/DESIGN.md` §4–5).
- [x] Fonts self-hosted through `next/font` (no runtime requests to Google).
- [x] `docs/DESIGN.md`, ADR 0004 (amendment), and the `/design` style guide updated.

## Dependencies
- `lucide-react` 1.48.0 — ISC license, actively maintained (published 2026-09-24), no runtime
  network access; icons only.

## Out of scope
Dark theme; a vector logo (open question for a designer).

## Test evidence
- Existing unit and e2e suites (shell, auth, denials, operator) pass unchanged: accessible names
  of navigation links are unchanged because icons are `aria-hidden`.
- Contrast ratios computed for each new token pair (recorded in DESIGN.md).
