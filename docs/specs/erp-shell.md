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
      switcher, practice name, user menu (name, role, practice, Sign out). (The demo badge was
      removed with the demo, 2026-09-26.)
- [x] Navy tab bar: the white DenialDesk mark with a chevron as its first control (changed from the
      module's name, 2026-09-26) (accessible name
      "<Module>, switch module", `aria-haspopup="dialog"`, opens the switcher), the module's shipped pages
      as tabs in `nav` "Primary", the active tab marked `aria-current="page"`. No grid icon.
- [x] Module switcher: modal dialog "Go to" with a search field (focused on open) and one grouped
      list: each module row (an `h3`: tinted tile, name, description) links to the module's first
      page (link name "<Module> module"), its pages follow as links in a list labelled by the
      module name; planned modules and pages are shown as "Planned" with a dashed border and never
      links; the no-match message is a status region; Escape, the Close button, and the backdrop
      close it.
- [x] Search: a query matching a module's name or description keeps all of its pages; otherwise
      only matching pages are listed under their module (`filterModules`).
- [x] Modules respect permissions: Revenue cycle only for roles that can view it; Settings for signed-in
      users, its Design system page only when the style guide is available (renamed from "Setup",
      `specs/settings-and-custom-fields.md`).
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
Record search (patients, claims) from the "Go to" field; favorites; per-user module ordering; dark
theme. Today the query only filters the static navigation list in the browser (no request, URL,
storage, or log). If record search is added, it must follow the patients pattern: POST search, no
names in URLs, and an audit event (`specs/patients.md`, R-7.4.8). Module visibility in the switcher
is a menu, not access control: every page enforces its own permission on the server.

## Test evidence
- Unit: `src/components/shell/navigation.test.ts` (module visibility, path → module/page
  resolution, switcher search filter).
- E2E: `shell.spec.ts` (switcher search, keyboard shortcut, Escape, Close button, backdrop, header
  "Go to" button, module switch from the tab bar button, planned pages not links, decorative icons,
  no horizontal scroll at 1024px), `revenue-cycle.spec.ts` (module hidden from specialists in bar
  and switcher), `auth.spec.ts` (user menu), and navigation in `claims`, `operator` specs through
  the switcher.
