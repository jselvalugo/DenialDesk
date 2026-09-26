# Spec: Appeals module

Status: A1 shipped (2026-09-26) — A2–A5 draft
Roadmap items: Phase 1 → Appeals ("Appeal deadline engine per payer regime" [x], "Appeal letter
templates with merge fields and attachments; human review before export", "Medicare 5-level appeal
workflow", "Appeal outcome tracking"); §8.4
Requirement IDs: §8.4, R-4.2.1, R-3.10.1, R-3.10.2, R-7.11.1–.5, R-3.8.2, R-3.9.2, R-5.1.2, R-7.5.1

## Goal
A biller can turn a denial into a tracked appeal case, take it through the standard levels a
payer or Medicare defines, record what was submitted and how, and see the outcome — all without
losing sight of the denial it came from or the deadline that governs it.

## Background: the standard appeal workflow
Established denial-management products model an appeal as its own case record, separate from the
denial, because a denial can be appealed more than once and each attempt has its own deadline,
submission, and outcome:
- **Levels.** Commercial/HMO payers typically define a first-level (reconsideration/redetermination)
  and, if upheld, a second-level appeal, sometimes followed by an external/independent review.
  Medicare has five fixed levels (REQUIREMENTS §4.2): Redetermination (120 days), Reconsideration/QIC
  (180 days), ALJ (60 days), Medicare Appeals Council (60 days), Federal district court (60 days).
  Each level is a new appeal row linked to the one before it (`previous_appeal_id`); only the
  Medicare day counts and citations are in `rules/` today (§ "Legal rules used").
- **Lifecycle.** draft → in review (a named person checks the letter and evidence before it can be
  submitted — R-3.10.2, R-7.11.2) → ready → submitted (method, date, tracking/reference number) →
  awaiting decision → decided (overturned in full / partially overturned / upheld / withdrawn /
  dismissed), with a decision date and, if money changed, a recovered amount. An upheld decision at
  a level that has a next level lets staff escalate, creating the next appeal row with its own
  rules-engine deadline (or "Not configured" — never a guess).
- **Letters.** Drafted from a template keyed to the denial's CARC group/category, merged with
  claim/patient/payer fields, editable, with an attachment checklist (medical records, prior
  authorization, notes — R-3.8.2). Attachments are tracked as a checklist in A1/A2; file storage is
  a later phase.
- **Work list.** A queue of open appeals, filterable by status/level/payer, sorted by days to
  deadline and dollar value, mirroring `docs/specs/denial-queue.md`.
- **Outcomes.** Every decided appeal feeds an overturn-rate metric, sliceable by payer and denial
  category, to show where appeals are worth the effort.

This is a description of the common industry pattern, not any one vendor's screens (ADR 0005): no
vendor names, screenshots, or copied wording are used.

## Phases
| Phase | Scope |
|---|---|
| **A1** (this PR) | Appeal record + lifecycle, `/appeals` list, appeal detail, create-appeal page from a denial, record submission, record decision, denial-status sync, audit, tests |
| A2 | Letter templates by denial category, merge fields, editable body, human-review attestation, PDF/print export |
| A3 | Multi-level escalation, including the Medicare 5-level ladder, via the rules engine |
| A4 | Outcome analytics: overturn rate by payer and denial category |
| A5 | Attachment file storage; collections hold while an appeal is pending (R-3.9.2) |

## User stories (A1)
- As a biller, I can start an appeal from a denial's page so the appeal is linked to the right
  claim and deadline from the start.
- As a biller, I can see every open appeal in one list, sorted by how soon its deadline is and how
  much money is at stake, so I work the most urgent ones first.
- As a biller, I can record that an appeal was submitted (method, date, reference number) and later
  record the payer's decision, and the linked denial's status updates to match.
- As a manager or compliance reviewer, I can see the full appeal record (level, dates, submission,
  decision) but compliance cannot change it (R-5.1.2, consistent with denial-queue.md).

## Acceptance criteria (A1)
- [x] New table `appeals` (below) with `status` progressing only draft → in_review → ready →
      submitted → awaiting_decision → decided (or withdrawn/dismissed from submitted or
      awaiting_decision); a database check or trigger rejects any other transition.
- [x] "New appeal" is its own page, `/appeals/new?denialId=<id>` (DESIGN.md §8), reachable from an
      action on the denial detail page; it pre-fills claim, payer, denial category, and level
      "first-level appeal" (level is fixed to first-level in A1; A3 adds escalation levels) and
      requires a filing basis (`payer_contract`, a Medicare rule ID, or "not configured", never
      inventing a date). Creating an appeal sets the denial's status to `appeal_drafted` (only from
      an open, awaiting-action status; otherwise the button is not offered).
  - [x] Boundary (Medicare regime): denial notice date such that the computed redetermination
        deadline is tomorrow, today, and yesterday all display correctly ("due tomorrow", "due
        today", "past deadline") and all still allow recording a submission (a late filing is
        recorded, not blocked, in A1 — blocking is a later decision, see Open questions).
- [x] `/appeals` lists every appeal for the practice: level, payer, denial category, status, days
      to deadline, denied amount; filters for status, level, and payer; default sort by days to
      deadline ascending (overdue first), then denied amount descending; pagination like
      `/denials` (25 per page).
- [x] Totals row: open appeals, amount at stake, due in 7 days, past deadline, no deadline
      configured — same rules as `denial-queue.md`'s totals (deadline counts exclude appeals
      already submitted).
- [x] `/appeals/[id]` shows the appeal's level, linked denial and claim (with the same masked
      member ID rules as claim/denial detail), deadline with its basis and citation (or "Not
      configured"), status, submission fields once submitted, decision fields once decided, notes,
      and activity — modeled on `denial-queue.md`'s detail page.
- [x] Action: record submission — method (portal/fax/mail/electronic), submitted date (cannot be
      before the appeal was created or after today), tracking/reference number (optional, free
      text). Moves status to `submitted`, sets `denials.status = 'appeal_submitted'` and
      `denials.appealSubmittedOn`, and sets a follow-up date using the practice's configured
      default follow-up days (see below) if one isn't entered.
  - [x] Recording a submission on the deadline date, the day before, and the day after all succeed
        and are flagged in the UI as on-time / on-time / late respectively, using the same
        boundary rule as `denial-queue.md` (deadline day counts as on time).
- [x] Action: record decision — outcome (overturned full / partially overturned / upheld /
      withdrawn / dismissed), decision date (not before submission date), recovered amount cents
      (required only for overturned full/partial, must be ≤ denied amount). Moves status to
      `decided`; sets `denials.status` to `overturned` (full or partial) or `upheld` accordingly;
      `withdrawn`/`dismissed` set the denial back to a status a human chooses (A1: `closed`, with a
      required reason note) since neither is a payer decision on the merits.
- [x] Only draft/in_review/ready appeals can be edited for basic fields; once submitted, only the
      decision and notes can be added (append-only submission fields), matching the
      immutability pattern in `claims.md` C1 (no version table needed in A1 — the appeal's own
      status guards this; a future audit finding may require a history table like
      `claim_versions`, tracked as an open question).
- [x] Roles: admin, manager, specialist can create/submit/decide; compliance is read-only
      (R-5.1.2, same matrix as denial-queue.md and claims.md).
- [x] Audit: `appeal.list_viewed`, `appeal.viewed` (denial/claim IDs, not patient name),
      `appeal.created`, `appeal.submission_recorded`, `appeal.decision_recorded` — every entry logs
      who/what/when, no PHI in the audit row itself (R-7.5.1, consistent with claims.md's pattern of
      keeping free-text reasons out of the audit row).
- [x] No PHI in URLs: `/appeals/[id]` uses the appeal's own UUID, never a patient name or member ID.
- [x] New table has tenant RLS (insert/select for `denialdesk_app`, tenant-scoped) and an isolation
      test confirming one tenant cannot see or create appeals for another tenant's denial.
- [x] Navigation: "Appeals" item in the Denials module switcher (`src/components/shell/navigation.ts`)
      flips from `available: false` to `available: true`.
- [x] e2e: denial detail → new appeal → appeal detail → record submission → record decision →
      denial status reflects the outcome.

## Data / API changes (A1)
- New table `appeals` (Restricted PHI by inheritance — links to a claim/denial — §9.1):
  - `id`, `tenant_id`, `denial_id` (FK `denials.id`), `claim_id` (FK `claims.id`, denormalized for
    listing), `level` (enum: `first_level` in A1; A3 adds `second_level`, `external_review`,
    `medicare_redetermination`, `medicare_qic`, `medicare_alj`, `medicare_council`,
    `medicare_federal_court`), `previous_appeal_id` (nullable FK `appeals.id`, self-reference for
    escalation — used starting A3), `status` (enum as in Acceptance criteria), `deadline` (date,
    nullable), `deadline_basis` (text, rule ID(s) or `payer_contract` or null), `deadline_citation`
    (text, nullable), `filed_by` (user id), `submitted_method` (enum: portal/fax/mail/electronic,
    nullable), `submitted_on` (date, nullable), `tracking_reference` (text, nullable),
    `follow_up_on` (date, nullable), `decision_outcome` (enum, nullable), `decision_on` (date,
    nullable), `recovered_cents` (cents, nullable), `created_at`, `updated_at`.
  - Indexes: `(tenant_id, status, deadline)` for the work list; `(tenant_id, denial_id)`.
  - Composite tenant-scoped FKs (`denials` and `claims` gained a `(tenant_id, id)` unique index for
    this): `denial_id` must belong to the same tenant, `claim_id` must belong to the same tenant,
    and a trigger (`appeals_claim_matches_denial`) checks the denormalized `claim_id` is the same
    claim the denial itself points at (a composite FK can't cross-check two of an appeal's own
    columns against each other).
  - RLS: tenant-scoped, `denialdesk_app` gets `SELECT, INSERT, UPDATE`; isolation test in
    `test/integration` alongside the existing denial/claim isolation tests.
- New table `appeal_notes` (mirrors `denialNotes`): `id`, `tenant_id`, `appeal_id`, `author_id`,
  `body`, `created_at`. RLS: tenant-scoped, `denialdesk_app` gets `SELECT, INSERT` only — notes are
  append-only in the UI (no edit action exists), so there is no `UPDATE` grant; isolation test in
  `test/integration/tenancy.test.ts`.
- New table `practice_settings` (built as part of A1, below): `id`, `tenant_id`, `key`, `value`,
  `updated_at`, unique on `(tenant_id, key)`. A small, generic key/value store for
  practice-configured product settings that are **not** legal values (those stay in `rules/`); A1's
  only key is `appeal_follow_up_days`. RLS: tenant-scoped, `denialdesk_app` gets
  `SELECT, INSERT, UPDATE`; isolation test in `test/integration/tenancy.test.ts`. No admin UI to
  edit it ships in A1 — a missing row means the built-in default (30 days) applies.
- `denials.status` gains no new enum values in A1 (existing `appeal_drafted`, `appeal_submitted`,
  `overturned`, `upheld`, `closed` already cover the sync points); confirm no other feature reads
  those statuses assuming only a denial-side action set them (grep before merge).
- Server actions: `createAppeal(denialId, level)`, `recordAppealSubmission(appealId, {method,
  submittedOn, trackingReference})`, `recordAppealDecision(appealId, {outcome, decisionOn,
  recoveredCents, closeReason?})`, `addAppealNote(appealId, body)`. No new API routes (matches the
  server-action pattern in claims.md/denial-queue.md).
- Practice-configurable default follow-up days: a single setting (e.g. 30) stored with practice
  settings (not `rules/`, since it is not a legal deadline) — table/location TBD by the builder;
  reuse the Settings module if a general "numeric setting" store already exists, otherwise a small
  `practice_settings` key/value row scoped by tenant.

## Legal rules used
- `medicare.redetermination.receipt_presumption` + `medicare.redetermination.filing_window` — 42
  CFR § 405.942 — ⚠️ VERIFY (existing rule, reused unchanged from `rules/deadlines.ts`).
- Commercial/HMO/Medicare Advantage appeal windows: from `payers.appealWindowDays` (payer
  contract), never inferred — no statute governs a specific commercial appeal-window length in
  `rules/` today.
- Medicare levels beyond redetermination (QIC 180d, ALJ 60d, Council 60d, federal court 60d,
  amount-in-controversy thresholds) are cited in REQUIREMENTS §4.2 but are **not yet in
  `rules/catalog.ts`**; A3 must add them there (florida-rules-engine) before the escalation UI can
  compute a deadline for those levels. Until then, any A1/A2 UI that shows a future level's name
  must not compute a date for it.
- The follow-up-on-submission interval (~30/45 days) is a practice-configurable default, not a
  statute; it must never be labeled a legal deadline in the UI.
- Fla. Stat. § 408.7057 (state dispute packet) and the OIR complaint evidence export are §8.4 items
  not covered by any phase here — separate roadmap line ("OIR complaint evidence package export").

## Out of scope (A1)
- Letter drafting/templates, attachments, and human-review attestation on letter content (A2).
- Escalation to a next level and the Medicare 5-level ladder (A3).
- Overturn-rate analytics/dashboard (A4).
- Attachment file storage and the collections hold while an appeal is pending (A5, R-3.9.2).
- AI-assisted drafting or suggestion of any kind (R-7.11.x applies only if/when that is built).
- An appeal version-history table like `claim_versions` — flagged as an open question below.
- Bulk actions, saved views, CSV export (same deferral as denial-queue.md).

## Open questions
- Should a late appeal submission (past the computed deadline) be blocked, warned, or simply
  recorded with a flag, as claims.md's C3 does for timely filing? A1 records and flags; a human
  should confirm before A2/A3 lock this in.
- Does an appeal need its own immutable version history (like `claim_versions`) for what was
  submitted, given it may carry a letter and evidence list later? Recommend deciding before A2 adds
  editable letter content.
- Where should the practice-configurable follow-up-day default live — is there already a general
  practice-settings mechanism, or does this spec need its own migration? (builder to check
  `settings-and-custom-fields.md` before A1 implementation.)
- Confirm the withdrawn/dismissed → denial-status mapping (A1 proposes `closed` with a required
  reason) with the owner/compliance — an appeal withdrawn for a procedural reason may need to stay
  distinguishable from one dismissed on the merits.
- Amount-in-controversy thresholds for higher Medicare appeal levels (REQUIREMENTS §4.2, "update
  annually") need a source and an owner for keeping them current before A3 ships those levels.
- Confirm role/field visibility for `tracking_reference` and `recovered_cents` — any masking rules
  beyond the existing claim/denial matrix (R-5.1.2)?
