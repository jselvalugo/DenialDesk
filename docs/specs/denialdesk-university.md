# Spec: DenialDesk University

Status: in progress (U1 built 2026-09-27; owner requested "a DenialDesk University" reachable from
the nav bar or the user menu)
Roadmap item: Phase 1 → Setup (role-specific training for billing staff, R-10.4); supports the
welcome page (`specs/welcome-page.md`, which left onboarding out of scope)
Requirement IDs: R-10.4, R-7.5.1, R-7.2.4, R-7.4.8, R-15.6, §11 (usability, WCAG 2.1 AA)

## Goal
Every practice user can open DenialDesk University from the global header or the user menu and
work through short courses on how DenialDesk works, how to read a denial, the Florida prompt-pay
and appeal clocks the product enforces, and how to handle patient data inside the app. Each user's
lesson completions are kept per practice so the practice has a training record (R-10.4).

## User stories
- As a new biller, I can find the University from any page and take "Getting started" so I know
  where each record lives and what the module switcher does.
- As a denial specialist, I can read what a CARC/RARC code and a denial category mean before I
  work my first queue.
- As a manager, I can point staff at the Florida prompt-pay and appeals courses instead of writing
  my own cheat sheet, and the deadlines shown are the same versioned rules the product uses.
- As a compliance officer, I can see that every deadline in a lesson carries its citation and its
  counsel-verification status, and that HIPAA guidance in the app is about product behavior, not
  legal advice.
- As any user, I can mark a lesson complete and see my progress on the course list.

## Acceptance criteria

### U1 — catalog, lessons, and completion (this PR)
- [x] Entry points: a "University" link (graduation-cap icon, text label) in the global header
      beside the practice name, and a "DenialDesk University" item in the user menu above "Sign
      out". Both go to `/university`. The University is not a module in the module switcher: it is
      not a place where practice records are worked, so the tab bar keeps the current module's
      tabs (on `/university` the bar falls back to the first module with no tab selected, as `/`
      does).
- [x] `/university` (inside the signed-in `(app)` group; every role) lists every course with its
      audience, lesson count, estimated reading time, and this user's progress ("3 of 5 lessons",
      "Complete"). The list is the same for every role; no course is role-gated.
- [x] `/university/<course>` shows the course description and its lessons in order, each marked
      complete or not for this user, and a link into each lesson.
- [x] `/university/<course>/<lesson>` renders the lesson body, a "Previous / Next lesson" footer,
      and a "Mark lesson complete" action. Completing is idempotent; the completion date is shown
      afterwards and a completed lesson can't be un-completed (it is a training record).
- [x] Content is authored in the repository (`src/domain/university/catalog.ts`), reviewed like
      code, and versioned with the product. A lesson is made of typed blocks: paragraph, bullet
      list, callout ("In DenialDesk" — links to the page being described), rule table, and
      code-list table. Course and lesson IDs are stable slugs used in URLs (no PHI, R-7.4.8).
- [x] **No statutory value is typed into lesson text.** A rule block names rule IDs from
      `rules/catalog.ts`; the page resolves each rule as of today (`resolveRule`) and renders its
      title, value + unit, citation, and a "Pending counsel verification" badge while
      `verify` is true. A rule ID that is not in the catalog fails the unit test, never the page.
      When counsel changes a value, the lesson changes with it.
- [x] CARC descriptions in lessons come from `src/domain/carc.ts` (summaries flagged ⚠️ VERIFY at
      their source), never retyped.
- [x] Progress table `university_progress` (tenant_id, user_id, lesson_id, completed_at; unique per
      tenant + user + lesson) with row-level security, the app role granted SELECT/INSERT only
      (no UPDATE or DELETE: completions are append-only), and a row in the shared isolation test.
      Contains no PHI (Internal data, REQUIREMENTS §9.1): user IDs and lesson slugs only.
- [x] Audit: `university.lesson_completed` (entity `university_lesson`, metadata `{ courseId,
      lessonId }`) is recorded in the same transaction as the completion, so the training record
      is evidenced in the audit log (R-7.5.1, SOC 2 CC1.4 / CC2.2 training evidence). Viewing a
      lesson is not audited (no PHI is read).
- [x] Every lesson that touches HIPAA or Florida law says it describes how DenialDesk behaves and
      is not legal or compliance advice; practice policy and the practice's privacy officer govern.
      This is customer-facing compliance wording: any change goes through `compliance-checker`.
- [x] DESIGN.md: panels with hairlines, sentence case, serif page title only, no imagery, no emoji,
      lucide icons `aria-hidden`, lesson body max 720px wide, keyboard-operable, WCAG AA.
- [x] Tests: unit (catalog integrity: unique slugs, every rule ID resolves, every CARC exists,
      every internal link points at a shipped page; progress summary math), integration
      (completion is idempotent, tenant-scoped, audited, and append-only), e2e (header and user
      menu links open the University; a lesson can be completed and the course list reflects it).

### U2 — knowledge checks (planned)
- [ ] Optional short "Check your understanding" per course (3–5 questions, answers in the
      repository, no free text). A pass is recorded like a completion. Never a gate on using the
      product.

### U3 — practice training record (planned)
- [ ] Administrators and compliance see a per-user completion table under Settings and can export
      it as .xlsx (same role rule as Insight export) for HIPAA training evidence (R-10.4).
- [ ] Optional per-practice "required courses" with an annual re-take reminder (R-10.4 "annually");
      due dates are practice settings, never legal values.

### U4 — content growth (planned)
- [ ] Courses for remittances (835) posting, revenue cycle month-end, and the payer catalog once
      those flows settle; short "what changed" notes when a rule version changes.

## Data / API changes
- New table `university_progress` (migration 0033): `id`, `tenant_id`, `user_id`, `lesson_id`
  (slug, `^[a-z0-9-]+/[a-z0-9-]+$`), `completed_at`. Unique `(tenant_id, user_id, lesson_id)`.
  RLS `tenant_isolation` as every tenant table; `GRANT SELECT, INSERT` only to `denialdesk_app`.
- Server action `completeLesson(courseId, lessonId)` in `src/app/(app)/university/actions.ts`:
  validates the slugs against the catalog, inserts `ON CONFLICT DO NOTHING`, audits when a row
  was inserted, revalidates the lesson, course, and catalog pages.
- Audit action `university.lesson_completed`; entity type `university_lesson`.
- Data classification: Internal. No PHI anywhere in the feature. Logs: none beyond the audit row.

## Legal rules used
Displayed only, never computed here: `fl.promptpay.electronic.pay_or_contest`,
`fl.promptpay.electronic.provider_response`, `fl.promptpay.electronic.pay_or_deny`,
`fl.promptpay.electronic.uncontestable`, `fl.promptpay.paper.pay_or_contest`,
`fl.promptpay.paper.pay_or_deny`, `fl.promptpay.paper.uncontestable`, `fl.promptpay.interest_rate`,
`fl.timely_filing.initial`, `medicare.timely_filing`, `medicare.redetermination.receipt_presumption`,
`medicare.redetermination.filing_window`, `medicare.reconsideration.filing_window`,
`medicare.alj_hearing.filing_window`, `medicare.council_review.filing_window`,
`medicare.judicial_review.filing_window`. Each carries its own citation and ⚠️ VERIFY flag from
`rules/catalog.ts`; the University adds nothing to them. No new rules.

## Notes
- The header link is the second entry point the owner asked for; the user-menu item is the first.
  Both are always shown to signed-in practice users; the operator console has neither (it has no
  practice context and its own shell).
- Lessons never quote a payer's policy. Where a payer's window applies (commercial appeal
  deadlines), the lesson says the value comes from the payer setup and shows "Not configured"
  behavior, matching `specs/denial-queue.md`.
- Reading time is words ÷ 200 per minute, rounded up, computed from the catalog at build time.

## Out of scope
Videos, external LMS integration, certificates, SCORM/xAPI, per-user reminders (U3), marketing
content, role-gated courses, anything that writes to a claim, denial, or code.

## Open questions
- U3: does the practice's HIPAA training program want DenialDesk completions as evidence, and in
  what form (owner / practice compliance officer)? Tracked as `OA-034`.
- Should "Getting started" be suggested on a user's first sign-in (a one-time banner on `/`)?
  Not built; the welcome page already links to the University.
