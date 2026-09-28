# Spec: ERP shell (global header, tab bar, module switcher)

Status: done (2026-09-26) — requested by the product owner; revised 2026-09-26 (ADR 0005);
data-source drop-down added 2026-09-27, built 2026-09-28 (`specs/patient-integrations.md` PI1b-3)
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
      switcher, the "University of DenialDesk" logo button and the "DenialDesk Wiki" wordmark button (2026-09-27,
      `specs/university-wiki.md`), practice name (shown from 1280px; in the user menu below that), user menu (name truncated to keep the header
      inside 1024px, role, practice, Sign out). (The demo badge was removed with the demo,
      2026-09-26.)
- [x] Navy tab bar: the white DenialDesk mark with a chevron as its first control (changed from the
      module's name, 2026-09-26) (accessible name
      "<Module>, switch module", `aria-haspopup="dialog"`, opens the switcher), the module's shipped pages
      as tabs in `nav` "Primary", the active tab marked `aria-current="page"`. No grid icon.
- [x] Module switcher: modal dialog "Go to" with a search field (focused on open) and a two-column
      Module | Pages table: each module row (an `h3`: tinted tile, name, description) links to the module's first
      page (link name "<Module> module"), its pages follow as links in a list labelled by the
      module name; planned modules and pages are muted with a "Planned" tag and never
      links; the no-match message is a status region; Escape, the Close button, and the backdrop
      close it.
- [x] Search: a query matching a module's name or description keeps all of its pages; otherwise
      only matching pages are listed under their module (`filterModules`).
- [x] Modules respect permissions: Revenue cycle only for roles that can view it; Settings for signed-in
      users (renamed from "Setup",
      `specs/settings-and-custom-fields.md`).
- [x] Detail pages resolve to their list page's module and tab (e.g. `/denials/:id` → Denials › Denial queue).
- [x] `PageHeader` pages show the module tile and a "Module · Page" eyebrow above the serif title;
      record detail pages (claim, denial) keep their breadcrumb and the active tab instead.
- [x] Module tiles are a colored glyph on a light tint (`tile-*` tokens), not a solid square.
- [x] Usable at 1024px without horizontal page scroll in the header.
- [x] Decorative icons are `aria-hidden`; link names stay text-only.

### Data-source drop-down (owner decision 2026-09-27; `specs/patient-integrations.md`, ADR 0010)
"A drop-down in the nav bar beside the table … so we can connect to this table only."
Built 2026-09-28 (patient integrations PI1b-3) for every state that exists today; the sync actions
arrive with the features behind them (PI2a Submit/pause/resume, PI2b sync now and history).
- [x] `NavItem` gains an optional `dataSource?: { table: "patients" }` slot; only the Patients tab sets
      it today. Other tables opt in later by setting the slot (no shell redesign).
- [x] In the navy tab bar, directly after a tab with a `dataSource`, a menu button
      (`data-chrome="dark"` focus ring) reads "Source: Manual ▾", or "Source: <connection name> ·
      Synced <relative time> ▾", "Not synced yet", "Sync running", "Awaiting approval", "Paused",
      "Needs attention" (error), or "Revoked". Accessible name "Patients data source: <state>"
      (with the connection name when there is one); the status is text, never color alone. A
      disclosure like the user menu rather than a Radix menu: the project has no menu library, and
      adding one for this was not worth a dependency. The panel is `fixed`, anchored to the button,
      because the tab bar scrolls sideways; Escape, an outside click, scrolling, resizing, or tabbing
      away closes it. (`src/components/shell/DataSourceMenu.tsx`, labels in `data-source.ts`)
- [x] Every role sees the current state, last successful sync, and last run outcome.
      Administrators (`canManageIntegrations`) also get "Connect an integration…" (→ Settings ›
      Integrations; shown when no connection is a source or the last one is revoked), otherwise
      "Connection settings" (→ the connection page). Revoke lives on the connection page only.
- [ ] Administrators: "Sync now", "Pause sync" / "Resume sync" (PI2a/PI2b), "Sync history"
      (→ `/settings/integrations/[id]/runs`, PI2b).
- [ ] "Sync now" and pause/resume are server actions (POST), never links; resume requires an MFA
      verification within the last 5 minutes (step-up, as in `specs/patient-integrations.md`); the
      menu shows the result as a status message.
- [x] The summary (connection name, status, last successful sync, latest run status) is loaded by the
      signed-in layout for the tenant in one query (`connectionSummary`; the live row is found through
      the partial unique index, the revoked fallback scans the practice's few connections) and passed through
      `AppShell` → `ShellProvider`; it holds no PHI, no counts of patients, and nothing is placed in
      URLs or client storage (R-7.4.8). The source is the live connection if any, else the most
      recently revoked one that was ever submitted or synced; a draft is never a source. Actions
      that change a connection revalidate the whole signed-in layout so the drop-down is current.
- [x] Relative time (`format.relative`, from the server's render time so server and browser agree)
      and all labels come from `src/i18n/` in en/es/pt (R-11.1).
- [x] The tab bar still fits 1024px without horizontal page scroll (e2e); a long connection name
      truncates with the full name in the panel.
- [x] Menu visibility is not access control: every page and action re-checks the role on the server.

## Data / API changes
None for navigation: it is computed client-side from role flags already passed to the shell; no
PHI. The data-source drop-down (2026-09-27) adds one server-side read of the practice's
integration connection summary in `AppShell` (Confidential configuration, not PHI; not audited).

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
