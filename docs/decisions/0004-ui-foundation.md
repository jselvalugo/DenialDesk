# ADR 0004: UI foundation

Status: accepted (2026-09-26)

## Context
Physician practices pay a premium for this product; the UI must feel enterprise-grade and
consistent across hundreds of agent-built screens. Requirements: WCAG 2.1 AA (§11), fast pages
(ADR 0001 performance rules), no PHI leaking to third parties (R-7.4.8).

## Decision
- **Design system of record:** `docs/DESIGN.md`. Tokens implemented once as CSS variables in
  `src/app/globals.css`; components read tokens, never raw hex values.
- **Styling:** Tailwind CSS v4, with its theme mapped to our tokens. Utility classes keep agent
  output consistent and small; the token layer keeps the look ours, not a framework default.
- **Components:** our own in `src/components/ui/`. Interactive primitives (dialog, menu, popover,
  tooltip, select, tabs) built on Radix UI when first needed, for keyboard and screen-reader
  behavior we shouldn't hand-roll. No pre-styled kit (e.g. copied shadcn defaults) — that
  default look is exactly what we're avoiding.
- **Fonts:** IBM Plex Sans + IBM Plex Mono via `next/font`, self-hosted at build time.
- **Icons:** one set only, chosen when the first icon is needed; 16px, 1.5px stroke, always
  paired with text or an accessible label.
- **Tables:** TanStack Table (headless) when sorting/pagination arrives; styled by `DataTable`.
- **Living style guide:** `/design` route, disabled in production, shows every token and component.

## Consequences
- New UI dependencies still go through the dependency check (R-15.7).
- `reviewer` checks UI PRs against `docs/DESIGN.md` §3 (banned patterns) and §11 (accessibility).
