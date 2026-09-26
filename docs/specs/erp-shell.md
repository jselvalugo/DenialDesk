# Spec: ERP shell (global header, tab bar, module switcher)

Status: done (2026-09-26) — requested by the product owner; revised 2026-09-26 (ADR 0005)
Roadmap item: Phase 0 → design system foundation (amendment)
Requirement IDs: §11 (WCAG 2.1 AA), R-7.4.8 (no PHI in URLs or client storage), R-7.2.7 (session timeout unchanged)

## Goal
The app feels like an ERP: a global header, a module switcher ("Go to") to move between modules,
and a navigation bar with the current module's pages, around the existing DenialDesk brand (navy,
teal, Playfair/Inter/Space Mono, unaltered logo). The structure is the common ERP convention; the
expression is DenialDesk's own and does not reproduce any vendor's shell (ADR 0005).

## User stories
- As a biller, I switch between Denials, Claims, and Revenue cycle from one switcher, and the bar
  under the header shows only the pages of the module I'm in.
- As any user, I press Ctrl/⌘ K (or the "Go to" field) and type a page name to jump to it.
- As any user, I can see which module and page I'm on from the tab bar and the page header.

## Acceptance criteria
- [x] Global header: logo (home link), "Go to a module or page" button beside it that opens the
      switcher, practice name, demo badge, user menu (name, role, practice, Sign out).
- [x] Navy tab bar: the current module's name as its first control (accessible name
      "Module: <name>", `aria-haspopup="dialog"`, opens the switcher), the module's shipped pages
      as tabs in `nav` "Primary", the active tab marked `aria-current="page"`. No grid icon.
- [x] Module switcher: modal dialog "Go to" with a search field (focused on open) and one grouped
      list: each module row (tinted tile, name, description) links to the module's first page
      (link name "<Module> module"), its pages follow as links; planned modules and pages are
      shown as "Planned" and never links; Escape, the Close button, and the backdrop close it.
- [x] Search: a query matching a module's name or description keeps all of its pages; otherwise
      only matching pages are listed under their module (`filterModules`).
- [x] Modules respect permissions: Revenue cycle only for roles that can view it; Setup only when
      the style guide is available.
- [x] Detail pages resolve to their list page's module and tab (e.g. `/denials/:id` → Denials › Denial queue).
- [x] `PageHeader` pages show the module tile and a "Module · Page" eyebrow above the serif title;
      record detail pages (claim, denial) keep their breadcrumb and the active tab instead.
- [x] Module tiles are a colored glyph on a light tint (`tile-*` tokens), not a solid square.
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
- Unit: `src/components/shell/navigation.test.ts` (module visibility, path → module/page
  resolution, switcher search filter).
- E2E: `shell.spec.ts` (switcher search, keyboard shortcut, Escape, Close button, backdrop, header
  "Go to" button, module switch from the tab bar button, planned pages not links, decorative icons,
  no horizontal scroll at 1024px), `revenue-cycle.spec.ts` (module hidden from specialists in bar
  and switcher), `auth.spec.ts` (user menu), and navigation in `claims`, `operator` specs through
  the switcher.
