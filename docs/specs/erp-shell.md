# Spec: ERP shell (global header, app bar, app launcher)

Status: done (2026-09-26) — requested by the product owner
Roadmap item: Phase 0 → design system foundation (amendment)
Requirement IDs: §11 (WCAG 2.1 AA), R-7.4.8 (no PHI in URLs or client storage), R-7.2.7 (session timeout unchanged)

## Goal
The app feels like an ERP (Salesforce-style): a global header, an app launcher to switch between
modules ("apps"), and a navigation bar with the current app's pages, around the existing DenialDesk
brand (navy, teal, Playfair/Inter/Space Mono, unaltered logo).

## User stories
- As a biller, I switch between Denials, Claims, and Revenue cycle from one launcher, and the bar
  under the header shows only the pages of the app I'm in.
- As any user, I press Ctrl/⌘ K (or the search field) and type a page name to jump to it.
- As any user, I can see which app and page I'm on from the tab bar and the page header.

## Acceptance criteria
- [x] Global header: logo (home link), "Search apps and pages" button that opens the launcher,
      practice name, user menu (name, role, practice, Sign out). (The demo badge was removed with the demo, 2026-09-26.)
- [x] Navy app bar: "App launcher" button, current app tile and name, the app's shipped pages as
      tabs in `nav` "Primary", the active tab marked `aria-current="page"`.
- [x] App launcher: modal dialog "App launcher" with a search field (focused on open), app tiles
      linking to each app's first page, all pages grouped by app, planned pages shown as "Planned"
      and never links; Escape, the close button, and the backdrop close it.
- [x] Apps respect permissions: Revenue cycle only for roles that can view it; Setup only when the
      operator console or style guide is available.
- [x] Detail pages resolve to their list page's app and tab (e.g. `/denials/:id` → Denials › Denial queue).
- [x] `PageHeader` pages show the app tile and an "App · Page" eyebrow above the serif title; record
      detail pages (claim, denial) keep their breadcrumb and the active tab instead.
- [x] Usable at 1024px without horizontal page scroll in the header.
- [x] Decorative icons are `aria-hidden`; link names stay text-only.

## Data / API changes
None. Navigation is computed client-side from role flags already passed to the shell; no PHI.

## Legal rules used
None.

## Out of scope
Record search (patients, claims) from the header search field; favorites; per-user app ordering;
dark theme.

## Test evidence
- Unit: `src/components/shell/navigation.test.ts` (app visibility, path → app/page resolution).
- E2E: `shell.spec.ts` (launcher search, keyboard shortcut, Escape, close button, backdrop, header
  search button, app switch, planned pages not links, decorative icons, no horizontal scroll at 1024px), `revenue-cycle.spec.ts` (app hidden from specialists in bar and launcher),
  `auth.spec.ts` (user menu), and navigation in `claims`, `operator` specs through the launcher.
