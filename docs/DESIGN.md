# DenialDesk design system

The UI contract for every screen. Agents building UI read this first; `reviewer` checks PRs
against it. Tokens live in `src/app/globals.css`; components in `src/components/`.
The living style guide is `/design` (non-production only).

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
- Big rounded "cards with shadows" as the main layout device. Use 1px borders and panels.
- Pill-shaped everything, radius > 8px, oversized hero headings inside the app.
- Centered layouts for working screens; fixed-width narrow columns for tables.
- Fake dashboards: invented metrics, placeholder charts, lorem ipsum, stock avatars.
- Generic empty states ("Nothing here!"). Say what's missing and the next action.
- Toasts for everything. Use inline confirmation; toasts only for background job results.
- Spinners over whole pages. Use skeletons shaped like the final layout.
- Inconsistent capitalization. Sentence case everywhere except proper nouns and codes.

## 4. Brand
From `docs/assets/denialdesk-logo.png`.

| Token | Hex | Use |
|---|---|---|
| `ink` | `#0B1A33` | Wordmark navy. Primary text, headings. |
| `brand-700` | `#0A3FA8` | Logo mark deep blue. Selected nav, pressed states. |
| `brand-600` | `#0B5CD5` | Primary actions, links, focus ring. AA on white (5.6:1). |
| `brand-500` | `#1E7BF0` | Hover on brand surfaces; charts series 1. |
| `brand-50`  | `#EEF4FE` | Selected row, subtle brand background. |
| `care-500`  | `#12B8A2` | Logo cross teal. **Brand accent only** (logo, onboarding). Never status. |

## 5. Color tokens
Neutrals are cool slate, tuned to the navy ink.

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F6F8FB` | App background behind panels |
| `surface` | `#FFFFFF` | Panels, tables, inputs |
| `surface-muted` | `#F1F4F8` | Table header, toolbars, read-only fields |
| `border` | `#DDE3EB` | Default 1px borders and dividers |
| `border-strong` | `#8592A6` | Input and checkbox borders (3:1 on white, WCAG 1.4.11) |
| `text` | `#0B1A33` | Primary text (ink) |
| `text-muted` | `#4A5A73` | Secondary text, labels (AA on white and canvas) |
| `text-subtle` | `#5F6E84` | Placeholder, metadata (≥ 4.5:1 on white and muted surfaces) |

Status (each has `-fg` text, `-bg` tint, `-border`):

| Status | fg | bg | Meaning |
|---|---|---|---|
| `danger` | `#B42318` | `#FEF3F2` | Overdue, denied, blocking error, uncontestable-obligation reached |
| `warning` | `#B54708` | `#FFFAEB` | Due soon, needs review |
| `success` | `#067647` | `#ECFDF3` | Paid, overturned, complete |
| `info` | `#0B5CD5` | `#EEF4FE` | In progress, submitted, informational |
| `neutral` | `#4A5A73` | `#F1F4F8` | Draft, closed, not applicable |

Rules: status is never shown by color alone — always a label or icon too (WCAG 1.4.1).

## 6. Typography
- **UI:** IBM Plex Sans (400, 500, 600). Designed for enterprise software; excellent numerals.
- **Codes and identifiers:** IBM Plex Mono (400, 500) for claim IDs, CARC/RARC, CPT/ICD, NPI,
  control numbers.
- Self-hosted via `next/font` (no runtime requests to Google).
- Numbers: `font-variant-numeric: tabular-nums` in tables, amounts, dates.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 24 / 32 | 600 | Page title (one per page) |
| `title` | 18 / 26 | 600 | Section / panel title |
| `heading` | 15 / 22 | 600 | Sub-section, dialog title |
| `body` | 14 / 20 | 400 | Default text |
| `table` | 13 / 18 | 400 | Table cells (500 for primary column) |
| `label` | 12 / 16 | 500 | Form labels, column headers (sentence case, muted) |
| `caption` | 12 / 16 | 400 | Metadata, helper text |

## 7. Space, shape, elevation
- 4px grid. Common steps: 4, 8, 12, 16, 24, 32, 48.
- Radius: 4px controls, 6px panels and dialogs. Nothing larger.
- Borders do the work. Shadows only for floating layers: menus/popovers `shadow-sm`, dialogs `shadow-lg`.
- Focus: 2px `brand-600` ring with 2px offset, always visible on keyboard focus.

## 8. Layout
- **App shell:** left sidebar 240px (collapsible to 64px), top bar 56px, content on `canvas`.
- **Preview banner:** 32px strip above everything in non-production (ADR 0003).
- **Page:** header (title, one-line description, primary action right-aligned), then filters
  toolbar, then content. Page padding 24px (16px under 1024px).
- Tables use the full content width. Forms max 720px wide, labels above fields.
- Minimum supported viewport 1280×800 for working screens; usable down to 1024px.

## 9. Components (build these, reuse them, don't fork them)
| Component | Notes |
|---|---|
| `Button` | `primary` (one per view), `secondary`, `ghost`, `danger`. Sizes `sm` 28px, `md` 32px. Verb labels: "Submit appeal", not "OK". |
| `Badge` | Status tones from §5. Short label, optional leading dot. |
| `DeadlineIndicator` | Date + days remaining + tone: overdue → danger, within the configured "due soon" window → warning, otherwise neutral. Windows are product settings, never legal values. |
| `Money` | Integer cents in, formatted USD out, tabular, right-aligned; negatives with a minus sign, never red-only. |
| `Code` | Mono, small, `surface-muted` background, for CARC/RARC/CPT/ICD/IDs. |
| `DataTable` | Sticky header, 40px rows (32px compact), zebra off, row hover `surface-muted`, selected `brand-50`, sortable headers with arrow, numeric columns right-aligned, pagination footer with counts. |
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
