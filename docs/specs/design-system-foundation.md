# Spec: Design system foundation

Status: approved (by delegated technical authority, 2026-09-26)
Roadmap item: `docs/ROADMAP.md` → Phase 0 → "Design system foundation + app shell"
Requirement IDs: §11 (WCAG 2.1 AA), R-7.1.3, R-7.4.8

## Goal
Every future screen is built from one set of tokens and components that look enterprise-grade,
and anyone can see the system at `/design`.

## Acceptance criteria
- [ ] Tokens from `docs/DESIGN.md` §4–7 implemented as CSS variables and mapped into Tailwind.
- [ ] IBM Plex Sans / Mono loaded with `next/font`; tabular numerals utility.
- [ ] App shell: sidebar (logo, navigation; unbuilt sections shown as unavailable, not links),
      top bar, skip-to-content link, content area on `canvas`.
- [ ] Preview banner in non-production (from the skeleton spec) sits above the shell.
- [ ] Components: `Button`, `Badge`, `DeadlineIndicator`, `Money`, `Code`, `PageHeader`,
      `Panel`, `EmptyState`, table styles for `DataTable`.
- [ ] `formatCents` and deadline-tone helpers are pure functions with unit tests.
- [ ] `/design` page (404 in production) shows colors, type scale, buttons, badges, deadline
      indicators, and a sample work-queue table with clearly synthetic data.
- [ ] Home page is an honest empty state, not a fake dashboard.
- [ ] Playwright checks: banner visible, skip link works, `/design` renders its table.
- [ ] No banned patterns from `docs/DESIGN.md` §3.

## Data / API changes
None. Sample rows on `/design` are hard-coded synthetic data (no patient names).

## Legal rules used
None. Deadline dates on `/design` are illustrative; tone thresholds are UI settings.

## Out of scope
Radix primitives, icons, TanStack Table, dark theme, real navigation targets.
