# ADR 0005: Shell differentiation and third-party design IP

Status: accepted (2026-09-26)

## Context
The ERP-style shell (ADR 0004 amendment, `specs/erp-shell.md`) was first cut to follow a well-known
CRM's shell closely: a nine-dot "App Launcher" button at the left of a navy tab bar, a solid colored
app tile beside the app name, and a launcher dialog laid out as a grid of app tiles over an
"all items" list. The owner asked (2026-09-26) that DenialDesk keep the structure practices expect
from an ERP but not look like a copy of any vendor's product, and that we stay clearly on the
right side of copyright, trademark, and trade-dress law.

This ADR records what we checked and what we changed. It is engineering due diligence, not legal
advice; the owner's counsel review (open item in `PROJECT_STATE.md`) covers the legal conclusion.

## What we checked (2026-09-26)
- **No vendor code or assets.** The repo contains no third-party design-system CSS, components,
  icon sets, or fonts from any CRM/ERP vendor. Fonts are IBM Plex Sans and IBM Plex Mono
  (SIL OFL 1.1, `src/app/fonts/LICENSE-*.txt`); icons are `lucide-react` (ISC, with
  Feather-derived icons under MIT); the switcher is a native `<dialog>`, and Radix UI (MIT) is
  planned for interactive primitives but is not yet a dependency (ADR 0004); tokens, components,
  and copy are our own (`src/app/globals.css`, `src/components/`).
- **No vendor trademarks or product names** in the UI, copy, code identifiers, or public docs. The
  only mentions were in internal docs (`PROJECT_STATE.md`, `specs/erp-shell.md`, ADR 0004) and
  are removed or reduced to this record. Git history retains the earlier wording; whether that
  matters if the repository becomes public is a question for counsel.
- **Structure is generic.** A global header, a module switcher, a tab bar of the current module's
  pages, and a keyboard-shortcut "go to" palette are conventions shared by many suites (office,
  ERP, issue trackers, developer tools). We rely on the convention, never on any one vendor's
  expression of it.

## Decision
Keep the ERP structure; change the expression so it is recognizably DenialDesk:

| Before (vendor-like) | Now |
|---|---|
| Nine-dot grid icon at the left of the tab bar | The current **module's name** is the first control of the tab bar, with a chevron; it opens the switcher. No grid glyph anywhere. |
| "App Launcher" dialog: tile grid of apps, then an "all items" list | **"Go to"** (Ctrl/⌘ K): a Module | Pages table. Each module row (tinted icon, name, description) links to its home, beside its pages as one aligned column; planned pages are muted, tagged "Planned", never links. |
| Solid colored square with a white glyph as the app icon | **Tinted tile**: the module's color as the glyph on its own light tint with a 1px border (`tile-*` tokens), matching our badge language. Each glyph ≥ 5:1 on its tint. |
| "Apps" vocabulary in the UI | **Modules** and **pages** in every label (`NavApp` stays as the code type). |
| Centered header search "Search apps and pages" | Left-aligned "Go to a module or page" field beside the logo; practice, demo badge, and user menu on the right. |

Kept as they were, since they came from DenialDesk's own visual identity (ADR 0004 amendment): the
navy/teal palette, the serif page titles, the teal-underlined tabs, the white global header with
the unaltered logo, and the page header band. Trade dress is judged on the overall look and feel,
so these retained elements are part of what counsel should review.

## Rules going forward
1. Never copy a vendor's glyphs, palette, layout proportions, copy, or naming. When a screen is
   "inspired by" something, write down what convention we're using, not which product.
2. Product copy, code, and public docs don't name competitors. Internal ADRs may, for history.
3. New third-party UI assets go through the dependency check (CLAUDE.md #10, R-15.7) with the
   license recorded; icon sets and fonts included.
4. `reviewer` treats a nine-dot grid icon, "app launcher" wording, and solid-color object tiles as
   design findings.

## Consequences
- `DESIGN.md` §4 and §8 and `specs/erp-shell.md` describe the new shell; e2e names changed
  ("<Name>, switch module" button, "Go to" dialog, "<Name> module" links).
- Counsel review of the overall look and feel stays an owner item before public launch.
