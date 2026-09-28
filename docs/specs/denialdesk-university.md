# Spec: DenialDesk University

Status: in progress (U1 built 2026-09-27; owner requested "a DenialDesk University" reachable from
the nav bar or the user menu)
Roadmap item: Phase 1 → Setup (role-specific training for billing staff, R-10.4); supports the
welcome page (`specs/welcome-page.md`, which left onboarding out of scope)
Requirement IDs: R-7.5.1, R-7.2.4, R-7.4.8, R-15.6, §11 (usability, WCAG 2.1 AA); supports practices'
own workforce training (R-10.4 is DenialDesk's staff requirement; whether practice completions count as
HIPAA training evidence is OA-035)

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
- [x] Entry points: the owner's "University of DenialDesk" logo as a button in the global header
      beside the Wiki button (accessible name "University of DenialDesk"; background removed,
      otherwise unaltered; `public/brand/university-of-denialdesk.png`; it replaced the
      graduation-cap text link on 2026-09-27, matching the Wiki wordmark button), the same logo
      button on the welcome page, and a "DenialDesk University" item in the user menu above "Sign
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
- [x] CARC descriptions come from `src/domain/carc.ts` and claim adjustment group codes from
      `src/domain/group-codes.ts` (summaries flagged ⚠️ VERIFY at their source), never retyped.
- [x] A rule shows "Confirmed by counsel <date>" only when `verify` is false and `confirmedBy` is
      recorded; otherwise "Pending counsel verification".
- [x] Progress table `university_progress` (tenant_id, user_id, lesson_id, completed_at; unique per
      tenant + user + lesson) with row-level security, the app role granted SELECT/INSERT only
      (no UPDATE or DELETE: completions are append-only), and its own isolation tests in
      `test/integration/university.test.ts` (the shared tenancy test assumes UPDATE is granted).
      Row-level security is per practice; per-user scoping is done in code from the session's user
      ID, never a request value. Contains no PHI (Internal data, REQUIREMENTS §9.1): user IDs and
      lesson slugs only.
- [x] Audit: `university.lesson_completed` (entity `university_lesson`, metadata `{ courseId,
      lessonId }`) is recorded in the same transaction as the completion, so the training record
      is evidenced in the audit log (R-7.5.1; SOC 2 CC7.2, and CC2.3 as a complementary user-entity
      control; not DenialDesk workforce training evidence, CC1.4). Viewing a
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

### Access (owner request 2026-09-27: prompt on every visit; courses locked until purchased)
- [x] A practice's University access is a platform record, `university_access` (migration 0037,
      one row per practice; RLS + FORCE with the shared tenant policy; the app role has SELECT and
      INSERT/UPDATE on the `requested_*` columns only, so a practice session can never grant
      itself access; grant/revoke run as the owner role under the same policy through
      `withTenantAsPlatform` in `src/domain/platform/university-access.ts`, which practice code
      never imports). Access = granted and not revoked. Practice sessions read only the state
      columns (migration 0038 narrows SELECT; the operator's note, revoke reason, and grantor are
      hidden). Tests in `test/integration/university-access.test.ts`, including an unfiltered
      cross-practice read that the policy alone must hide.
- [x] While the practice has no access, every visit to `/university` opens a modal dialog "Get
      access to DenialDesk University" (`AccessPrompt.tsx`, a native `<dialog>` like the module
      switcher): what the program is, how long it is (courses, lessons, reading minutes computed
      from the catalog by `programSummary()`, Wiki article count), "Access starts at $299.00"
      (`UNIVERSITY_ACCESS_FROM_CENTS`, owner-set business content formatted by the platform money
      rule, never a legal value), that the courses unlock for the whole practice once access is
      confirmed, and the courses disclaimer. Close, Escape, backdrop, and "Browse the catalog" dismiss it; nothing is remembered, so it opens again next visit. Once access is
      granted the prompt is not rendered.
- [x] "Request access" records the request on the practice's row (latest request wins) and audits
      `university.access_requested` (entity `university_access`, the row id, metadata
      `{ priceFromCents }`); the dialog confirms inline and, on later visits, shows "Access requested
      on <date>" while the request is pending. A repeat within a minute, or a request from a
      practice that already has access, writes nothing. After a revoke the practice can request
      again; that shows as a new pending request (state "Requested") for the operator. No promise of
      contact is made: the operator sees the request on the practice page.
- [x] Locked catalog: course titles are not links, "Open course" is replaced by a "Locked" mark,
      and the course and lesson routes redirect to `/university`; the completion action refuses
      with "The courses are locked…" through `completeLessonIfUnlocked` (integration-tested for
      locked, granted, and revoked practices). The Wiki is not gated.
- [x] Operator console, practice page: a "DenialDesk University" panel shows the state (Not
      requested / Requested on <date> / Access granted on <date> [+ note] / Revoked on <date>:
      reason) with "Grant access" (optional order/invoice note, audited
      `operator.university_access_granted`) and, once granted, "Revoke access" (reason of at least
      five characters, audited `operator.university_access_revoked`). Only one grant can be active
      (a repeat is refused so a stale tab can't erase the reference) and a row is revoked once; a
      revoked practice can be granted again. Customer practices only, checked in the domain. The
      panel shows only the latest outcome.
- [x] Copy in the `university` (`access.*`) and `operator` (`university.*`) namespaces in all three
      languages; the modal is `aria-labelledby`/`aria-describedby` (the body paragraph), focus is
      contained by the native dialog and moves to "Browse the catalog" after a request.
- [x] E2E: the e2e practice has access (seeded in `global-setup.ts`; no prompt, courses open); the
      manager practice is locked (prompt with price and length, three dismiss paths, reload
      re-opens, locked marks, course/lesson redirects, Wiki open, request recorded and remembered);
      the operator grants and revokes on a fresh practice (`operator.spec.ts`).

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
- New table `university_access` (migration 0037): `tenant_id` (unique), `requested_at/by`,
  `granted_at/by`, `note`, `revoked_at/by`, `revoke_reason`, timestamps; CHECKs keep each pair
  together and revocation after a grant. RLS + FORCE with the tenant policy; app role: SELECT,
  INSERT (request columns), UPDATE (request columns, `updated_at`). Internal data, no PHI.
- `src/db/tenant.ts` `withTenantAsPlatform(ctx, fn)`: owner role with `app.tenant_id` set (no role
  switch), for the operator's writes to a practice's records; reads also filter by tenant in code
  because a superuser connection (local, CI) bypasses the policy.
- Server actions: `requestUniversityAccess()` (practice; `src/app/(app)/university/actions.ts`),
  `grantUniversity` / `revokeUniversity` (operator; `src/app/operator/(console)/actions.ts`).
- Audit actions `university.access_requested`, `operator.university_access_granted`,
  `operator.university_access_revoked`; entity type `university_access`.
- Data classification: Internal. No PHI anywhere in the feature. Logs: none beyond the audit row.

## Legal rules used
Displayed only, never computed here: the FL insurer and FL HMO prompt-pay sets
(`fl.promptpay.{electronic,paper}.{acknowledgment,pay_or_contest,pay_or_deny,uncontestable}`,
`fl.promptpay.electronic.provider_response`, `fl.promptpay.interest_rate`, and their `fl.hmo.*`
counterparts), `fl.timely_filing.{initial,secondary}` and the HMO counterparts,
`medicare.timely_filing`, `medicare.redetermination.{receipt_presumption,filing_window}`,
`medicare.appeals.receipt_presumption`, and the level 2–5 `medicare.*.filing_window` rules. Each carries its own citation and ⚠️ VERIFY flag from
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
content beyond the owner-requested access prompt (OA-044), role-gated courses, online payment,
anything that writes to a claim, denial, or code.

## Open questions
- Retention of completions after a user leaves the practice, and whether a content version should
  be stored with each completion before they are used as evidence (U3). The FK to `memberships`
  blocks deleting a membership with completions; offboarding must deactivate instead. Counsel
  wording review of all lesson copy before production (customer-facing compliance statement).
- Medicare amount-in-controversy thresholds (levels 3 and 5) still need an effective-dated entry in
  `rules/` (florida-rules-engine; see the TODO in `rules/catalog.ts`).
- U3: does the practice's HIPAA training program want DenialDesk completions as evidence, and in
  what form (owner / practice compliance officer)? Tracked as `OA-035`.
- Access (OA-044): the owner decided on 2026-09-27 to lock the courses until access is purchased
  (done: operator grants it). Still open: what "starting at $299" covers (term, renewals, what a
  higher tier adds), how a practice pays (today the operator records the purchase by hand after a
  request), and who at DenialDesk watches for requests (they appear on the practice page only).
- The "University" name itself (OA-038, counsel).
- Should "Getting started" be suggested on a user's first sign-in (a one-time banner on `/`)?
  Not built; the welcome page already links to the University.
