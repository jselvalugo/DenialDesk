# DenialDesk design system

The UI contract for every screen. Agents building UI read this first; `reviewer` checks PRs
against it. Tokens live in `src/app/globals.css`; components in `src/components/`.
There is no in-app style guide page; this document is the reference (the `/design` page was removed 2026-09-26).

## 1. Who we design for
Billers, denial specialists, and RCM managers who sit in this app **all day**, working queues of
hundreds of claims, and the physicians and administrators who pay for it and glance at results.
They are experts. They value speed, density, precision, and trust over delight.

The product should feel like a financial instrument: **calm, exact, dense, and quiet**. Think
Bloomberg-terminal discipline with modern typography, not a consumer app.

## 2. Principles
1. **Data first.** Tables and numbers are the product. Chrome recedes; content carries color.
2. **Color means something.** Neutral by default. Color appears only for status, urgency, money
   direction, and the single primary action on a screen.
3. **Every number is formatted and aligned.** Currency `$12,480.00`, tabular figures, right-aligned.
4. **Deadlines are always visible and always explicit:** date, days remaining, and time zone.
5. **Density with breathing room.** Compact rows, generous section spacing, strict alignment grid.
6. **Nothing surprising.** Same component, same place, same behavior on every screen.
7. **Trust is shown.** Synthetic/preview banners, masked identifiers, audit-aware actions, and
   AI content labeled as such (R-7.11.5).

## 3. Not "vibe-coded" — banned patterns
- Gradients, glows, glassmorphism, blurred blobs, neon, purple-to-blue anything. (The logo keeps
  its gradient; the UI never borrows it.)
- Emoji in UI, sparkle ✨ "AI magic" icons, exclamation marks in copy.
- Big rounded "cards with heavy shadows" as the main layout device. Panels are 1px borders with at
  most a hairline `shadow-xs`.
- Pill-shaped everything, radius > 8px, oversized hero headings inside the app.
- Borrowing another product's shell: a nine-dot grid icon, "app launcher" wording, solid-color
  object tiles with white glyphs, or any vendor's palette, glyphs, or copy (ADR 0005).
- Centered layouts for working screens; fixed-width narrow columns for tables.
- Fake dashboards: invented metrics, placeholder charts, lorem ipsum, stock avatars.
- Generic empty states ("Nothing here!"). Say what's missing and the next action.
- Toasts for everything. Use inline confirmation; toasts only for background job results.
- Spinners over whole pages. Use skeletons shaped like the final layout.
- Inconsistent capitalization. Sentence case everywhere except proper nouns and codes.

## 4. Brand
DenialDesk's visual identity is navy chrome, a teal accent, serif page titles, and mono figures,
around its own logo (`docs/assets/denialdesk-logo.png`),
always shown unaltered on a white background (sign-in page, global header). Adopted 2026-09-26,
ADR 0004 amendment; ERP shell (global header, tab bar, module switcher) 2026-09-26,
`specs/erp-shell.md`, differentiated from any vendor's shell in ADR 0005.
The practice sign-in pages (`/login` and its MFA and password steps) also carry the reception image
(`public/brand/denialdesk-reception.jpg`, provenance in `public/brand/README.md`) in a matted frame
beside the card (above it under 1024px): hairline, canvas gap, navy line, white mat, hairline. It is
the one place a picture appears in the product; working screens never use imagery. The product line
next to it is Inter, not serif: Playfair stays reserved for page titles (§6).

| Token | Hex | Use |
|---|---|---|
| `navy` / `primary` | `#1A2C4E` | App bar, primary buttons, page titles (13.9:1 on white) |
| `primary-hover` | `#13213B` | Hover/pressed on primary |
| `focus` | `#2E75B6` | Focus ring on light surfaces; chart series 3 |
| `link` | `#245D93` | Text links, info status (6.9:1 on white, 4.5+ on every surface) |
| `accent` | `#1F6B75` | Teal accent: chart series 1, progress bars. Never status by itself. |
| `selected` | `#EAF0F7` | Selected table row |

App bar (navy chrome; tokens keep their `sidebar-*` names): background `#1A2C4E`, tab text
`sidebar-fg` `#E2E8F0` (11.3:1), muted text `sidebar-muted` `#8A9BB5` (4.9:1), active tab
`sidebar-active` `#243A63` with a 3px `sidebar-accent` `#5EC4CC` underline; `sidebar-accent` is also
the focus ring inside navy chrome.

Module tiles (module switcher, page headers) are a colored glyph on the module's own light tint with
a 1px border (`tile-<tone>-fg/-bg/-border`), like our badges, never a solid colored square with a
white glyph (ADR 0005): Denials teal, Claims blue, Revenue cycle navy, Insight amber, Patients and
Settings slate. Every glyph is ≥ 5:1 on its tint. Tiles identify the module; they never carry status.

## 5. Color tokens
Neutrals are cool slate.

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F3F6F9` | App background behind panels |
| `surface` | `#FFFFFF` | Panels, tables, inputs |
| `surface-muted` | `#F1F5F9` | Table header, toolbars, read-only fields |
| `border` | `#E2E8F0` | Default 1px borders and dividers |
| `border-strong` | `#768599` | Input and checkbox borders (3.8:1 on white, 3.4:1 on `surface-muted`, WCAG 1.4.11) |
| `text` | `#0F172A` | Primary text |
| `text-muted` | `#475569` | Secondary text, labels (AA on white and canvas) |
| `text-subtle` | `#5B6B82` | Placeholder, metadata (≥ 4.5:1 on white and muted surfaces) |

Chart series: `chart-1` teal `#1F6B75`, `chart-2` navy `#1A2C4E`, `chart-3` blue `#2E75B6`,
`chart-4` amber `#B7791F`, `chart-5` orange `#C05621`, `chart-danger` `#A32D2D` (every series ≥ 3:1
on white). Charts always
have a text or table equivalent; color never carries meaning alone.

Status (each has `-fg` text, `-bg` tint, `-border`):

| Status | fg | bg | Meaning |
|---|---|---|---|
| `danger` | `#A32D2D` | `#FBEDED` | Overdue, denied, blocking error, uncontestable-obligation reached |
| `warning` | `#854F0B` | `#FBF3E6` | Due soon, needs review |
| `success` | `#0F6E56` | `#E7F4EF` | Paid, overturned, complete |
| `info` | `#245D93` | `#EAF2FA` | In progress, submitted, informational |
| `neutral` | `#475569` | `#F1F5F9` | Draft, closed, not applicable |

Rules: status is never shown by color alone — always a label or icon too (WCAG 1.4.1).

## 6. Typography
- **Page titles:** Playfair Display (600, 700), serif, navy. Page `h1` and the sign-in card title
  only; never in tables, forms, or body text.
- **UI:** Inter (400–700). Tabular figures in tables, amounts, and dates.
- **Codes, identifiers, headline figures:** Space Mono (400, 700) for claim IDs, CARC/RARC,
  CPT/ICD, NPI, control numbers, and stat-tile values.
- Self-hosted via `next/font` (no runtime requests to Google).
- Stat tiles and table headers use uppercase, letter-spaced labels (the one exception to sentence
  case, §3).

| Style | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 28 / 36 | 700 serif | Page title (one per page) |
| `title` | 18 / 26 | 600 | Section / panel title |
| `heading` | 15 / 22 | 600 | Sub-section, dialog title |
| `body` | 14 / 20 | 400 | Default text |
| `table` | 13 / 18 | 400 | Table cells (500 for primary column) |
| `label` | 12 / 16 | 500 | Form labels (sentence case, muted); column headers and stat labels uppercase 600 |
| `caption` | 12 / 16 | 400 | Metadata, helper text |

## 7. Space, shape, elevation
- 4px grid. Common steps: 4, 8, 12, 16, 24, 32, 48.
- Radius: 6px controls, 8px panels and dialogs. Nothing larger (avatars are the one circle).
- Borders do the work. Panels, stat tiles, and page headers add a hairline `shadow-xs`; floating
  layers: menus/popovers `shadow-sm`, dialogs `shadow-lg`.
- Focus: 2px `focus` ring with 2px offset, always visible on keyboard focus. Inside navy chrome
  (mark the container `data-chrome="dark"`) the ring is `sidebar-accent` (≥ 5.5:1 on navy).

## 8. Layout
- **App shell (ERP layout, `specs/erp-shell.md`, ADR 0005):**
  - *Global header*, 56px white: logo, then the "Go to a module or page" field beside it (opens the
    module switcher; Ctrl/⌘ K); practice name, demo badge, and the user menu (name, role, practice,
    a language group listing English / Español / Português with the current one marked, sign out)
    on the right. Every string on every screen comes from `src/i18n/` in all three languages
    (`specs/internationalization.md`, `src/i18n/README.md`); dates follow the language, money stays
    `$1,234.56`.
  - *Tab bar*, 44px navy: the white DenialDesk mark (logo icon, teal cross) with a chevron as the
    first control (accessible name "<Module>, switch module"; opens the switcher; the module name is
    carried by the tabs and the page-header eyebrow), then the module's shipped pages as tabs (`nav`
    "Primary"). Planned pages are not tabs. No grid or "waffle" icon.
  - *Module switcher* ("Go to"): modal dialog with a large borderless search field and a two-column
    table (Module | Pages): each row is a module (tinted tile, name, description; links to its home;
    the current module is tinted and tagged "Current") beside its pages as one aligned column of
    rows. Planned modules and pages are muted with a "Planned" tag, never links. Matches are
    highlighted; a footer shows the result count and keyboard hints.
  - Modules ("apps" in code): Denials, Patients, Claims, Revenue cycle (roles that can view it),
    Insight, Settings (section tabs: General, Custom fields, and planned sections; the design
    style guide in pre-production; `specs/settings-and-custom-fields.md`). Defined once in
    `src/components/shell/navigation.ts`.
- **Page header:** white band (panel style) with the module tile, an uppercase "Module · Page"
  eyebrow, the serif title, a one-line description, and actions on the right.
- **Preview banner:** 32px strip above everything in non-production (ADR 0003).
- **Page:** page header, then filters toolbar, then content. Page padding 24px (16px under 1024px).
- Tables use the full content width. Forms max 720px wide, labels above fields.
- **Create flows get their own page** (owner rule, 2026-09-26). A list page never embeds a
  "create" form: it has a primary "New <thing>" button in the page header's actions that opens
  `/<list>/new`, which has a breadcrumb back to the list, a Cancel link, and after saving links to
  the new record and back to the list. Examples: `/patients/new`, `/operator/practices/new`.
  Small row-level actions (suspend, mark in error) may stay inline.
- Minimum supported viewport 1280×800 for working screens; usable down to 1024px.

## 9. Components (build these, reuse them, don't fork them)
| Component | Notes |
|---|---|
| `Button` | `primary` (one per view), `secondary`, `ghost`, `danger`. Sizes `sm` 28px, `md` 32px. Verb labels: "Submit appeal", not "OK". |
| `Badge` | Status tones from §5. Short label, optional leading dot. |
| `DeadlineIndicator` | Date + days remaining + tone: overdue → danger, within the configured "due soon" window → warning, otherwise neutral. Windows are product settings, never legal values. |
| `Money` | Integer cents in, formatted USD out, tabular, right-aligned; negatives with a minus sign, never red-only. |
| `Code` | Mono, small, `surface-muted` background, for CARC/RARC/CPT/ICD/IDs. |
| `DataTable` | Sticky header, 40px rows (32px compact), zebra off, row hover `surface-muted`, selected `selected`, sortable headers with arrow, numeric columns right-aligned, pagination footer with counts. |
| `PageHeader`, `Panel`, `EmptyState`, `Skeleton` | Layout primitives. |
| `MaskedValue` | Member ID / SSN / MBI shown as `•••• 1234`; "Reveal" is an audited action (R-7.5.1). |
| `AIContent` | Labeled "AI draft — review before sending" with the approving user recorded (R-7.11.2). Phase 3. |

Interactive primitives (dialog, menu, popover, tooltip, select) use Radix UI for accessibility,
styled with our tokens (ADR 0004).

## 10. Content and formatting
- Voice: plain, precise, calm. "Appeal deadline in 5 days", not "Hurry! Deadline soon!"
- Dates: `10/14/2026`; with time `10/14/2026 5:00 PM ET`. Legal clocks always show the time zone.
- Relative time only as secondary text ("5 days left"), never alone.
- Currency: `$1,234.56`. Large aggregates may use `$1.2M` only in summary tiles, with exact value on hover.
- Codes: prefix with type when ambiguous: `CARC 197`, `RARC N30`, `CPT 99214`.
- Errors: what happened + how to fix, never a stack trace or PHI.

## 11. Accessibility (WCAG 2.1 AA, REQUIREMENTS §11)
- Contrast ≥ 4.5:1 for text, 3:1 for UI boundaries. Text tokens above were checked on `surface`,
  `surface-muted`, and `canvas`; re-check any new token before adding it.
- Full keyboard operation; visible focus; logical tab order; skip-to-content link.
- Tables use real `<table>` semantics with `scope` and `aria-sort`.
- Respect `prefers-reduced-motion`; motion max 150ms, ease-out, no decorative animation.

## 12. PHI-safe UI (REQUIREMENTS §7.4.8)
- No PHI in URLs (use opaque IDs), page titles, browser notifications, or client logs.
- Mask high-risk identifiers by default (`MaskedValue`).
- Session timeout warning at 13 minutes idle, logout at 15 (R-7.2.7).
- Print and export are explicit, audited actions.

## 13. Themes
Light theme only for the MVP. All colors are CSS variables, so a dark theme can be added
without touching components.
