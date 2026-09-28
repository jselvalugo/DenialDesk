# Spec: Record pages and edit forms (the record pattern)

Status: in progress — P1 built on Patients (owner request 2026-09-27: "modernize the Patient pages
… and create the staple to edit other tables as well")
Roadmap item: cross-cutting UI (`docs/DESIGN.md` §8–9); first applied to `specs/patients.md`
Requirement IDs: R-7.1.3, R-7.4.8, R-11.1; REQUIREMENTS §11 (accessibility, WCAG 2.1 AA)

## Goal
Every table in DenialDesk (patients, claims, denials, appeals, payers, custom fields, users) gets
the same three screens built from the same parts: a **list** (toolbar, dense table, pagination), a
**record** (breadcrumb, header band with facts and actions, work tables beside the record's own
fields), and an **edit form** (named sections with a short explanation each, one footer with the
primary action). A biller who learns one module's screens knows every module's screens.

## User stories
- As a biller, I open any record and find its identifier, status, key facts, and actions in the same
  place on every module, so I never hunt for "Edit" or a claim number.
- As a builder agent, I make a new table's pages by composing the record components instead of
  copying page markup, so the screens stay consistent and reviews stay short.
- As a compliance reviewer, I see the same masked identifiers, "Not on file" placeholders, and
  audit notes wherever a record is shown or changed.

## The parts (`src/components/records/`, `src/components/ui/`)
| Part | Where | Use |
|---|---|---|
| `Breadcrumbs` | `ui/Breadcrumbs.tsx` | `List / Identifier / Action`; identifiers in mono; last item is `aria-current="page"` |
| `RecordHeader` | `records/RecordHeader.tsx` | Panel band: module tile, "Module · <eyebrow>" line, `h1` (serif for names, mono for numbers), badges beside it, actions right, and a `meta` strip of uppercase label + value pairs |
| `RecordLayout` | `records/RecordLayout.tsx` | Wide main column (work tables) + 320–360px aside (the record's own fields); stacks under 1024px |
| `FieldList` / `Field` | `records/FieldList.tsx` | Label-over-value facts in 1 or 2 columns; `empty` text for missing values; `mono` / `tabular` |
| `FormSection` / `FormRow` / `FormActions` / `FormNotices` | `records/FormShell.tsx` | Sectioned form inside `<Panel flush>`: section title + explanation on the left, fields on the right, one footer bar with the primary button, Cancel, and an audit note |
| `TextField`, `SelectField`, `TextareaField` | `ui/` | Form fields with the same label / hint / error structure |
| `TableToolbar`, `SearchInput` | `ui/` | The strip above a table: search and filters left, count or actions right |

Rules the parts encode (DESIGN.md §3, §8, §12): page `h1` is the record's own name or number; no
patient data in `<title>`, URLs, or breadcrumbs beyond an opaque identifier (MRN, claim number);
all text via `src/i18n/`; a list never embeds a create form; the record's meta strip never repeats
a masked identifier (member ID, SSN) — those stay in the aside behind `MaskedValue`-style reveal.

## Acceptance criteria
- [x] P1 — Patients uses the pattern on all four screens: `/patients` (toolbar with search + count,
      table with MRN chip, age beside the date of birth, sex, location, coverage), `/patients/[id]`
      (breadcrumb, record header with tags, MRN, birth date + age, sex, coverage, "Edit record";
      claims and denials with counts; demographics, primary insurance, and record dates in the aside),
      `/patients/new` and `/patients/[id]/edit` (sections: Demographics, Primary insurance, Audit
      trail on edit, Confirmation in synthetic-only environments; footer with the one primary button).
- [x] `ageOn(birthDate, today)` is a pure helper with boundary tests (day before / of / after the
      birthday); the server passes `today` so client tables don't read the browser clock.
- [x] Existing behaviour unchanged: POST search, audited reveal, reason on edit, synthetic
      attestation, role gating; the patients e2e suite passes without edits.
- [x] Every new string is a key in English, Spanish, and Portuguese.
- [x] P2 — Claims and Denials record pages move to `RecordHeader` / `RecordLayout`. Claims: title is
      the claim number (mono); badges the status tag; meta strip is Patient (link), Payer, Date of
      service, Version, Billed, Paid. Denials: title is the denial category + CARC-RARC code;
      badges the status tag plus, when the category came from an unmapped remittance, an
      "unverified category" tag; meta strip is Claim (link), Patient (link), Denied amount, and
      Appeal deadline (with a small "pending verification" marker when the deadline basis or a
      rolled date is still pending counsel). Both pages use `FieldList`/`Field` in place of
      hand-rolled `dl`s for every fact panel, including a "Payer" field with its regime line and a
      "Payer received" field restored in the claim's own "Claim details" aside. The single primary
      action ("Correct claim", "Start appeal"/"View appeal") is in the header, passed as `undefined`
      (not an always-truthy empty fragment) when none applies. The claim correction form opens from
      the header action while living in the claim-lines panel (`CorrectionProvider` shares open
      state and save result across the two; opening focuses the form's first field, and Cancel
      returns focus to the header button). The denial's assign/status controls move into the
      "Denial" panel in the main column, next to the codes they act on, each keyed to its current
      value (`key={denial.status}` / `key={denial.assigneeId ?? "none"}`) so a successful change
      remounts them with the fresh value instead of an uncontrolled `defaultValue` sticking to the
      old one; a read-only Assignee field in the "Denial details" aside shows the same value from
      plain server data regardless. Unchanged: data loading, `claim.viewed`/`denial.viewed` audits,
      the member ID reveal, the custom-field reveal, role gates, server actions, and the
      timely-filing and appeal-deadline values (read as-is, never recomputed).
- [x] P3 — Appeals, Remittances, Prompt pay, Settings › Custom fields, Operator › Practices forms
      move to `FormShell`: the "new" create-flow pages (appeal, remittance, prompt-pay contest,
      custom field, practice) now use `Breadcrumbs` + `FormSection`/`FormRow`/`FormActions`/
      `FormNotices` inside `<Panel flush>`; appeal submission/decision, the remittance void reason,
      the prompt-pay void-in-error reason, and the BAA agreement dates now use `FormRow`,
      `SelectField`, `TextField`, and `TextareaField` in place of hand-rolled grids and inputs,
      unchanged behavior and unchanged accessible names.
- [x] P4 — `DataTable` gains sortable column headers (`SortableHeader`: a link setting
      `?sort=<key>&dir=asc|desc`, `aria-sort` on the `th`, a visible arrow, and an accessible label
      naming the direction a click applies) and a `density="compact"` option (a CSS custom property
      on `<table>`, so `Table`/`Th`/`Td` stay server-renderable). Server-side sorting, no new
      dependency — ADR 0004 addendum records why TanStack stays deferred. Applied to Claims (claim
      number, patient name, payer, service date, billed, status — patient name sorts by last, then
      first), Denials (amount, appeal deadline — the notice-date "Sort by" dropdown is retired since
      it had no column of its own), Appeals (amount, deadline), Patients (name, MRN, date of birth —
      the list's own headers only; search results, still POSTed and out of the URL, keep plain
      headers), and Payers (name). Every sort key is allow-listed with zod and maps to an indexed or
      cheap column; a stable `id` tie-break keeps paging deterministic. With no `sort` in the URL,
      each list keeps its existing default order exactly — soonest deadline first for Denials and
      Appeals, filing urgency first for unsubmitted Claims — including the D1 priority (denials
      still awaiting action sort ahead of already-handled ones) for either direction of a deadline
      sort. Unchanged: which rows are returned, role gates, and `*.list_viewed`/`*.queue_viewed`
      audits (Claims' and Denials' events already record the filter query string, which now includes
      `sort`/`dir` when non-default; Appeals' and Patients' events record no such string and were not
      changed, to avoid inventing a new audit shape).

## Data / API changes
`listPatients` also selects `sex`, `city`, `state` for the list columns (same table, same RLS;
classification unchanged: Restricted PHI). Minimum-necessary rationale (45 CFR 164.502(b)): billers
pick a patient from a list of same-surname rows, and sex plus city/state tell apart patients who share
a name and a birth date before a chart (and its `patient.viewed` event) is opened. Restricted
(sensitivity-tagged) rows show neither in the list. The owner confirms or trims the columns in
OA-043. `patient.list_viewed` and `patient.searched` now record `fields` (which columns the row
showed) so an auditor can reconstruct what was disclosed after this change. No new tables.

## Legal rules used
None. Age is a display convenience, never a clock or eligibility rule.

## Out of scope
Inline editing in tables, bulk edit, column chooser, saved views, dark theme.

## Review record
2026-09-27 (P1): `reviewer` — one blocking finding (form section `<legend>` not first in its
fieldset) fixed by naming the group with `aria-labelledby`; search form no longer `display:
contents`; search hint linked by `aria-describedby`. `security-reviewer` — no Critical/High/Medium;
Low: list exposes more identifiers (OA-043). `compliance-checker` — no blocking findings; the
minimum-necessary rationale above, the restricted-row rule, and the `fields` audit marker are its
non-blocking asks. SOC 2: CC6.1, CC6.3, CC7.2, CC8.1, C1.1.

## Open questions
- Should the list show the last claim date or open balance per patient (needs an aggregate query
  per page; cheap at 25 rows)? Owner call — it decides which column replaces Sex.
