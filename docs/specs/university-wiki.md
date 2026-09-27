# Spec: University — Wiki

Status: in progress (2026-09-27) — approved by delegated technical authority; owner to confirm
Roadmap item: Phase 1 → "University: Wiki (reference articles)"
Requirement IDs: R-10.4, R-15.6, §3.1, §4.2, §8.3, §8.4, §11 (accessibility), R-7.4.8

## Goal
A signed-in practice user can open the DenialDesk Wiki, search it, and read short reference
articles about how denials, claims, appeals, and Florida payment rules work in DenialDesk, with every
legal value pulled live from the rules engine and every statement sourced.

The Wiki is a page of DenialDesk University (`specs/denialdesk-university.md`), beside the U1 courses:
same header, same entry points (header link, user menu), linked from the course catalog and linking
back, and, like the courses, not a module in the switcher. The owner will structure the rest of the
University separately (2026-09-27); this spec deliberately defines only the Wiki.

## User stories
- As a billing specialist, I can look up what a CARC, RARC, or group code is while working a denial
  so that I don't have to leave DenialDesk.
- As a new team member, I can read how a claim becomes a denial and an appeal in DenialDesk so that I
  understand where each screen fits.
- As a manager, I can read what the Florida prompt-pay clock and timely-filing windows measure, with
  the values DenialDesk actually uses and their citations, so that I can explain a deadline to a
  physician.
- As a compliance user, I can read which safeguards the product applies (masking, audit, synthetic
  data) so that I can answer a practice's questions.

## Acceptance criteria
- [x] `/university/wiki` lists every article grouped by category with its summary; a search box
      (`?q=`) filters by title, summary, tags, and body text, case-insensitively, and says how many
      articles matched ("No article matches" names the next step).
- [x] `/university/wiki/<slug>` renders one article: title, category, summary, body, "On this page"
      headings, sources, related articles, and the date it was last reviewed. Unknown slugs 404.
- [x] Article bodies are authored in a documented Markdown subset (headings, paragraphs, bulleted
      and numbered lists, notes, tables, bold, inline code, links). The renderer produces React
      elements only; no raw HTML is ever injected.
- [x] **No legal value is typed into an article.** A body writes `{{rule:<rule id>}}` and the
      renderer substitutes the value and unit of the version in force today from `rules/`, with its
      citation, and an "unconfirmed" marker while the rule's `verify` flag is set (R-15.6, CLAUDE.md
      "never hard-code a statutory deadline"). An article that references a rule ID that does not
      exist fails the unit tests.
- [x] Every internal link in every article resolves to another article or to a shipped page.
- [x] Every article carries at least one source, and articles state what DenialDesk does, never
      payer rules or code meanings it cannot cite (CLAUDE.md #9). Code lists (CARC, RARC) are linked
      to their maintainer, not reproduced.
- [x] Articles contain no PHI and no names, identifiers, or amounts that could be mistaken for a real
      patient or claim; the fixture check in the unit tests scans for SSN-, MBI-, and phone-shaped
      strings.
- [x] The course catalog (`/university`) has an "Open the Wiki" action and the Wiki index links back
      to Courses; both use the University header (not the shell's module tile); every role can view.
- [x] Accessible: real headings in order, a labelled search form, `aria-current` on the active
      category, keyboard-operable, no color-only meaning (DESIGN.md §11).
- [x] Unit tests: markdown parser (each block and inline type, rule tokens, unsafe link rejection),
      article catalog (unique slugs, valid links and rule IDs, sources present, PHI-shape scan),
      search, navigation. An e2e check opens the index and one article.

## Data / API changes
None. Articles are TypeScript modules under `src/domain/university/wiki/articles/` (bundled with
the app, reviewed in PRs like any other change). No database table, no per-tenant content, no
user-editable pages in this phase. Data classification: Public (product documentation; REQUIREMENTS
§9.1). No PHI is read or written, so no audit event is emitted for reading an article; the search
query is never logged.

## Legal rules used
Read-only references to `rules/` by ID through `{{rule:<id>}}`: `fl.promptpay.*`,
`fl.hmo.promptpay.*`, `fl.timely_filing.*`, `fl.overpayment.*`, `fl.retroactive_denial.limit`,
`fl.patient_refund`, `medicare.timely_filing`, `medicare.*.filing_window`,
`medicare.*.receipt_presumption`. The Wiki never computes a deadline and never changes a rule; its
⚠️ VERIFY status comes from the rule itself.

## Out of scope
- Courses, lessons, quizzes, progress tracking, certificates (the rest of the University; owner to
  structure).
- Practice-authored or user-editable articles, comments, and page history.
- Per-tenant content, payer-specific articles, and contract-derived values.
- Article versioning beyond git history; a public (signed-out) help site.
- Context-sensitive help links from other pages (a follow-up once the University's shape is set).

## Open questions
- Owner: the structure of the University beyond the Wiki (courses, role-based tracks, training
  records for R-10.4). Logged in `docs/owner/OWNER_ACTION_ITEMS.xlsx` as OA-036.
- Owner: whether practices should be able to add their own articles (would need a table with RLS,
  audit, and a content policy).
