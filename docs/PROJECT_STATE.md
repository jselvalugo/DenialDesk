# Project state — shared memory

Read this at the start of every session, after `CLAUDE.md`. Update it at the end of every session
that changes decisions, status, or open questions. Keep it short: facts and links, not narrative.

_Last updated: 2026-09-27_

## Where we are
- University — Wiki (`specs/university-wiki.md`, 2026-09-27): a new **University** module whose only
  page is the Wiki (`/university/wiki`; `/university` redirects there). Twelve reference articles
  (getting started, denials and appeals, claims and payments, Florida and Medicare rules, data
  safety, glossary) authored as TypeScript modules in `src/domain/university/wiki/articles/` in a
  small Markdown subset rendered to React (no raw HTML). **No legal value is typed into an article:**
  `{{rule:<id>}}` tokens render the rule version in force today from `rules/` with its citation and
  an "unconfirmed" marker while `verify` is set; unit tests fail on a typed "N calendar days", an
  unknown rule ID, a dead internal link, or an SSN/MBI/phone/e-mail-shaped string. Every role can
  read it; nothing is audited (public product documentation, no PHI). The owner will structure the
  rest of the University separately (OA-035), so the module lists no other page, not even as planned.
- Appeals A1 (`specs/appeals.md`): `appeals` + `appeal_notes` tables (tenant RLS, isolation test,
  a DB trigger enforcing the status lifecycle draft → in_review → ready → submitted →
  awaiting_decision → decided, with withdrawn/dismissed reachable from submitted/awaiting_decision).
  `/appeals` work list (level/payer/status filters, deadline/amount sort, totals row); "Start
  appeal" on the denial detail page opens `/appeals/new?denialId=<id>` (own create page, deadline
  computed fresh from the rules engine, never guessed); `/appeals/[id]` records the submission
  (method, date, tracking ref) and the decision (outcome, date, recovered amount, close reason),
  syncing the linked denial's status. "Appeals" is now a live item in the Denials module switcher.
  A practice-configurable appeal follow-up-day default lives in a new small `practice_settings`
  key/value table (no admin UI yet to edit it in A1 — it always reads the built-in 30-day default
  until one is set directly in the table). Next: A2 letter templates, A3 escalation/Medicare
  5-level ladder, A4 overturn-rate analytics, A5 attachment storage. Open questions from the spec
  (late-filing blocking, appeal version history, withdrawn/dismissed → denial status mapping,
  amount-in-controversy source) are added to `docs/owner/OWNER_ACTION_ITEMS.xlsx`.
- Remittances and prompt pay R1/PP1 (`specs/remittances-and-prompt-pay.md`): 835 upload (parser in
  `src/edi/x12/`), `/remittances` table and record page with balance check, post (claim version +
  prompt-pay response per claim) and void with reason; `/prompt-pay` table and clock record page
  (milestones, interest worksheet, contests with "recorded in error"); claim page Payments panel.
  Migration 0026: append-only history enforced by triggers, RLS + isolation tests. Seed now posts
  synthetic remittances. External data sources to connect are tracked in `docs/data-sources.xlsx`.
  R2 (reversals, denial capture from posted adjustments, event-row guard; migration 0028) done;
  CARC mapping is ⚠️ VERIFY (OA-021). Next: R2b line-level + deposit reassociation, PP2 alerts, R3 feed.
  Open (counsel): interest accrual start; paper provider-response window.
- Welcome page (`specs/welcome-page.md`) now explains how the patient record feeds claims and
  denials (4 steps; charge import and 837P/835 marked Planned) and lists more safeguards (MFA,
  field encryption, BAA on file). Wording passed `compliance-checker`; owner sign-off on copy pending.
- Settings (`specs/settings-and-custom-fields.md`): the "Setup" module is now **Settings**, with
  section tabs (General, Custom fields; Users and roles, Security, Notifications, Integrations
  planned). The `/design` style-guide page was removed 2026-09-26 (owner request). Administrators define custom fields on patients,
  claims, denials, and payers (`custom_fields`, migration 0023, RLS + isolation test, audited).
  Next: S2 render and store field values on record forms.
- Phase 0 engineering done: skeleton, design system, tenancy + RLS, audit log, sign-in with MFA,
  rules engine, synthetic data, Netlify config (not yet deployed — see `docs/runbooks/netlify.md`).
- Phase 1 started: Overview, denial queue, and denial detail work end to end on seeded data.
- Claims module C1 (`specs/claims.md`): claims list with timely-filing warnings, claim detail,
  corrections of draft/rejected claims with a required reason, and append-only version history
  enforced by database triggers. Next: C2 CSV charge import, C3 837P + filing block, C4 999/277CA.
- UI shell is ERP-style: global header with a "Go to" field (Ctrl/⌘ K), navy tab bar whose first
  control is the current module's name, and a grouped module switcher (`specs/erp-shell.md`).
  Deliberately not a copy of any vendor's shell: no grid icon, no "app launcher", tinted module
  tiles, "modules/pages" vocabulary (ADR 0005).
- Patient records P1 (`specs/patients.md`): `/patients` list, POST search (no names in URLs),
  register/edit with primary coverage (encrypted member ID), admin-only sensitivity tags, and a
  patient chart linking claims and denials; claim and denial pages link back. "Patients" is in the
  module switcher as its own module. Next: P2 secondary coverage/eligibility, P3 accounting of disclosures.
- Practice sign-in page shows the owner's DenialDesk reception image in a matted frame beside the
  card (`specs/sign-in-and-sessions.md`); the operator sign-in has no image.
- Whole-product review (2026-09-26, `docs/reviews/2026-09-26-billing-structure-review.md`): the
  billing lifecycle is implemented only from "denial exists" onward plus claim corrections and the
  PM-file accounting module; claim status, paid amounts and denials are seed-only. Seven confirmed
  calculation/display bugs (comma charges, `-$0.00`, "filed on time" with no deadline, prompt-pay
  "Met" on any notice), missing catalog rules, and a page-by-page record-model gap list with a
  prioritized order of work (P0–P4). Next session should start with its P0 list.
- Insight standard reports (`specs/insight-standard-reports.md`): `/insight` lists 6 available
  reports (denials by category/CARC, denials by payer, denial rate, open denials by appeal-deadline
  bucket, claims by status/A/R summary, appeal outcomes) plus 2 planned (prompt-pay scorecard,
  underpayment variance). Every role can view; export (owner decision 2026-09-26) is limited to
  admin/manager/compliance. Reports are aggregate-only (no patient/claim drill-down), tenant-scoped
  through `withTenant`, and every view/export is audited (`insight.report_viewed`,
  `insight.report_exported`). The primary export is a formatted **.xlsx workbook** (not CSV — owner
  decision 2026-09-26: "business people need to export the data"), built server-side with the new
  `exceljs` dependency (MIT, `src/domain/insight/workbook.ts`): an About cover sheet plus data
  sheet(s) with a bold frozen header, autofilter, real numeric/date/percent cells, a totals row, and
  formula-injection sanitization; an "All reports" workbook is also offered. New indexes:
  `denials(tenant_id, notice_date)`, `claims(tenant_id, submitted_at)`,
  `claims(tenant_id, service_date)` (migration 0029). Navigation's Insight "Reports" item now
  points at `/insight` and is `available: true`. Small-cell suppression (owner decision
  2026-09-26, R-8.7): a report row whose underlying claims include a sensitivity-tagged patient
  (R-3.5.1) and whose count is under `SMALL_CELL_SUPPRESSION_THRESHOLD` (default 11, config in
  `src/domain/insight/suppression-config.ts`, ⚠️ VERIFY with counsel — modeled on CMS's public-
  use-file cell-size suppression policy, not a Florida statute) shows "Suppressed (<11)" instead
  of its count/dollars/rate, on-screen and in the export; complementary suppression (decided once
  per whole sheet, never per sub-group, and never picking a zero-count row) also hides the
  next-smallest sibling row when only one row would otherwise be suppressed. A reviewer fix
  (2026-09-26) closed a back-calculation gap: whenever any row in a sheet is suppressed, that
  sheet's own totals row is suppressed too (previously it showed the true grand total, letting
  `Total − visible rows` reconstruct a hidden value). Suppression is a typed `SuppressedCell`
  marker (`src/domain/insight/suppression.ts`), never a string comparison, and the decision is
  made once on the actual sheet rows in `src/domain/insight/report-sheets.ts` (not in
  `calculations.ts`, which only computes each group's `sensitive` flag), so the on-screen table
  and the .xlsx always agree. Accepted residual risks, documented on the About sheet: cross-report
  / overlapping-date-range differencing isn't guarded against, and report #3 (denial rate)'s
  tenant-wide denied-claims count is never suppressed (it's one scalar, not a row breakdown).
  Exporting to a production (Azure) tenant is gated on `OA-033` (the still-open written
  handling/retention policy question). Next: custom/user-built reports, patient-level drill-down
  once broader sensitivity-tag enforcement lands (R-3.5.1), and the two planned reports once their
  blockers clear.
- Fixed the same date: `isSameOrigin()` (`src/lib/same-origin.ts`), used by the Insight export
  routes' CSRF check, rejected every real "Download Excel" click with a 403 — this app's own
  `Referrer-Policy: no-referrer` makes browsers send a literal `Origin: null` for a same-origin
  full-page form POST, which `new URL("null")` can't parse. Now checks `Sec-Fetch-Site` first
  (unaffected by referrer policy; reliable in all modern browsers), falling back to the
  Origin/Host comparison only when that header is absent.
- Payer catalog P1 (`specs/payer-catalog.md`): `payers.edi_payer_id`/`regime` are now nullable plus
  a `payers.source` column; a payer missing either is "unverified". Starter Florida insurer catalog
  by name only (`src/domain/payers/florida-catalog.ts`, no payer IDs/regimes) loaded per-tenant,
  idempotently, by `ensureCatalogPayers` (`src/domain/payers/catalog.ts`), called from the seed and
  from `seedRevenueCycleDefaults`/practice setup. Primary Insurance's Payer field is a searchable
  input+datalist (`PatientForm.tsx`) labelling unverified payers. `regimeLabel()`
  (`domain/denial-status.ts`) and `filingStatus()` (`domain/claims/status.ts`, new
  `"payer_unverified"` state) handle a null regime everywhere it's shown; unverified payers get no
  computed deadline. `assertPayerVerified` (`domain/payers/verification.ts`) guards future 837P
  submission. Next: P2 clearinghouse payer IDs + admin regime verification + payer admin screen.
- Live preview: https://denialdesk.netlify.app (Netlify Database, us-east-2). A platform operator
  console (`/operator`) for the owner, with its own sign-in at
  `/operator/login` and an operator account that belongs to no practice (`specs/operator-login.md`).
  The operator account exists only from hosting configuration (`PLATFORM_OPERATOR_PASSWORD_HASH`,
  made with `pnpm operator:credential`); no page can create or reset it (owner rebaseline 2026-09-26).
  An unusable value (e.g. the password pasted instead of its hash) switches the console off and is
  reported once in the function log as `operator.credential_unusable` (runbook has the fix). Since
  2026-09-26 every refused operator sign-in also logs a fixed-word reason
  (`operator.sign_in_refused`) and `GET /api/preview/operator-status` (`SEED_TOKEN`, pre-production
  only) reports the configuration and account state in one request; the runbook's
  "Operator sign-in shows the generic error" section maps each word to its fix.
- Next (owner rebaseline): tenancy lifecycle in the console: Pause for non-payment (read-only +
  export), Suspend for security, Terminate → offboarding (export, legal hold, certified destruction),
  BAA-on-file gate in production (later the same day the owner chose
  to keep that manual for now: the console flags a missing BAA and the owner decides;
  `specs/practice-agreements.md`).
- Operator console: each customer practice has a page (`/operator/practices/<id>`) where the
  operator records the signed Business Associate Agreement (PDF, dates, signers) and downloads
  it; renewals supersede, older ones can be back-filled as historical, mistakes are marked
  "recorded in error" with a reason; nothing is deleted; the practices list shows BAA status
  (`specs/practice-agreements.md`). Practices are still created by the operator only (owner
  decision 2026-09-26: no self-service sign-up; a BAA must be signed before a practice exists).
  Creating a practice now has its own page, `/operator/practices/new` ("New practice" button on
  the list). Owner rule: every create flow on the platform gets its own page (`DESIGN.md` §8).
- The one-click demo practice was removed entirely (owner request, 2026-09-26); migration 0021
  archived any live demo practice and ended demo sessions; 0022 disabled demo-only accounts and
  audited each retired demo practice (`system.demo_retired`). Practices are created from the console.
- Archived demo practices purged (owner decision, 2026-09-26; ADR 0008): migration 0032 deletes
  every demo practice, its synthetic data, and its demo-only users, so none appear in the console.
  Audit events are kept (no longer foreign-keyed to tenants/users) and each purge is audited
  (`system.demo_purged`, `system.demo_user_purged`).
- Open item: the operator uses TOTP; R-7.2.2 requires phishing-resistant MFA (WebAuthn) for admins
  before production.
- Open item (human decision): single-administrator risk acceptance with compensating controls
  (independent log review, sealed break-glass holder) and R-7.2.6 alerting, before production.
- Production branch on Netlify: `claude/quirky-feynman-ufql5a` (default). Each session works on its
  own branch and merges through a PR.

## Decisions made (details in `docs/decisions/`)
| Date | Decision | Record |
|---|---|---|
| 2026-09-26 | MVP = Florida claims + denial platform (REQUIREMENTS §12 Phase 1) | `PRODUCT_BRIEF.md`, `ROADMAP.md` |
| 2026-09-26 | 8-agent roster instead of 11 | `AGENT_WORKFLOW.md` |
| 2026-09-26 | App opens on the welcome page at `/` (sign-in and logo land there); Denials overview moved to `/overview` | `specs/welcome-page.md` |
| 2026-09-26 | Stack: TypeScript, Next.js, PostgreSQL + Drizzle, Vitest, Playwright | ADR 0001 |
| 2026-09-26 | Production on Azure, U.S. only; primary likely East US 2 (confirm at cutover) | ADR 0002 |
| 2026-09-26 | Pre-production on Netlify, synthetic data only | ADR 0003 |
| 2026-09-26 | Enterprise design system; Tailwind v4 + own components + Radix | ADR 0004, `DESIGN.md` |
| 2026-09-26 | DenialDesk visual identity (navy/teal, Playfair/Inter/Space Mono, lucide icons); logo unchanged | ADR 0004 amendment, `specs/visual-identity.md` |
| 2026-09-26 | Revenue cycle accounting module (rules engine, journal vouchers, A/R aging, deposits, statements), tenant-scoped, phases B1–B5 | `specs/revenue-cycle-accounting.md` |
| 2026-09-26 | DenialDesk is standalone (owner instruction): the owner's earlier prototype was reference only; the revenue cycle module uses DenialDesk's own file layout, rules, accounts, vouchers, aging, and reconciliation (C0) | `specs/revenue-cycle-accounting.md` |
| 2026-09-26 | Secrets scanning: gitleaks in CI | `specs/project-skeleton.md` |
| 2026-09-26 | Agents merge their own PRs once CI is green and reviewers have no blocking findings | `CLAUDE.md` #12 |
| 2026-09-26 | Rate limits on demo login, sign-in, MFA, and seed endpoint | `specs/rate-limiting.md` |
| 2026-09-26 | Insight standard reports: all roles view, export limited to admin/manager/compliance, aggregate-only (no drill-down), primary export is a formatted .xlsx workbook (not CSV); `exceljs` added | `specs/insight-standard-reports.md` |
| 2026-09-26 | Insight small-cell suppression (R-8.7): rows tied to a sensitivity-tagged patient with a count under 11 (config, ⚠️ VERIFY) show "Suppressed (<11)" instead of values on-screen and in exports, with complementary suppression to prevent back-calculation | `specs/insight-standard-reports.md` |
| 2026-09-26 | ERP shell: global header, navy tab bar, module switcher (replaces the sidebar) | ADR 0004 amendment, `specs/erp-shell.md` |
| 2026-09-26 | Operator two-step is off on the Netlify console for now (`PLATFORM_OPERATOR_MFA=off`; ignored in production); unset the variable to turn it back on | `specs/operator-login.md` |
| 2026-09-26 | No self-service sign-up; the operator creates practices after the BAA is signed, and records the BAA on the practice page | `specs/practice-agreements.md` |
| 2026-09-26 | BAA handling is manual by design: no sign-in blocking without a BAA, no template version, corrections via "recorded in error", nothing automatic at termination | `specs/practice-agreements.md` (Decisions) |
| 2026-09-26 | Shell differentiated from any vendor's product; no third-party design IP; competitor names out of product copy and public docs | ADR 0005 |
| 2026-09-26 | Every DB error sanitized where Drizzle creates it (system and tenant); kept messages opt-in (owner: fix both in PR #28) | ADR 0006 |
| 2026-09-26 | Custom field values on records (settings S2) are in the Phase 1 MVP; sensitivity checkboxes hidden from the patient form (owner, 2026-09-26; R-3.5.1 tagging gap accepted, compliance sign-off pending) | `specs/settings-and-custom-fields.md` |
| 2026-09-26 | Owner answers on the billing-structure review's open questions (§8) — **pending counsel confirmation; not yet implemented in rule logic**: (1) timely filing counts from the submission date, evidenced by the clearinghouse acknowledgement (not the payer's receipt date); (2) a deadline landing on a weekend or Florida/federal holiday rolls to the next business day; (4) Medicare Advantage is not under Florida prompt pay per the owner — MA payment timing follows the plan contract (⚠️ VERIFY: 42 CFR § 422.520 sets a 30-day clean-claim rule for non-contracted providers; counsel to confirm this doesn't reintroduce a statutory clock); (5) late-payment interest starts accruing the first calendar day after the prompt-pay deadline passes. Item (3), month-end clamping of the 6-/12-month timely-filing windows, is still open and being researched separately. | `docs/reviews/2026-09-26-billing-structure-review.md` §8 |
| 2026-09-27 | University module starts with the Wiki only; articles are code (PR-reviewed, no per-tenant or user-edited content), legal values only through rule tokens; the rest of the University waits for the owner's structure (OA-035) | `specs/university-wiki.md` |
| 2026-09-27 | Roll-forward pending counsel (OA-034), option 1: the date conservative for the practice governs. Provider-side deadlines (timely filing, secondary payer, 35-day response, overpayment response, Medicare appeal levels, payer-contract appeal windows, patient refund) alert, sort, go "past deadline" and block on the UNROLLED date; payer-side prompt-pay milestones and interest start use the UNROLLED date (interest from the day after). The rolled date is computed and shown as "(pending counsel: date)" only. One switch: `ROLL_FORWARD_POLICY` in `rules/roll-forward.ts` (effective-dated, needs `confirmedBy`) plus rule attribute `side`. Applying rule-reading attributes to baseline versions was an engineering choice, pending owner/counsel acceptance (OA-034 item 7). | `specs/rules-engine-skeleton.md`, `rules/roll-forward.ts` |

The product owner delegated technical decisions to the implementing agent ("make the best
technical decisions"). Decisions still get an ADR so a human can review them.

## Next up
0. Revenue cycle module (`specs/revenue-cycle-accounting.md`): B1 rules and ledger, B2 monthly file
   import, C0 (own design: month-end activity file, routing-only rules), B3 journal vouchers, and
   B4 aging/deposits/reconciliation, and B5 statements and RCM dashboard (denial tie-ins by
   payer-class regime) done; the module's planned phases are complete. Follow-ups: coded reasons
   for deposit reversals, credit-balance refund tracking (roadmap), multi-account deposits.
1. Deploy the Netlify preview (human: create site, database, env vars — runbook).
2. 835 ERA ingestion → real denial capture (edi-x12-specialist).
3. Payer setup screen (appeal windows from contracts) and practice/provider setup.
4. Claims C2–C4 (`specs/claims.md`): CSV charge import → draft claims; 837P via clearinghouse
   stub with the timely-filing block; 999/277CA capture.
5. Appeal letter templates (human review before export).
6. Custom field values on records, settings S2 (MVP): ADR 0007 and threat model accepted; PR 1
   (encrypted storage, value history, role-gated reveal) merged as #53. Next: PR 2 patient form,
   PR 3 claims/denials, PR 4 payers.
7. Claim page timely-filing copy (review D2, builder PR): "Sent; the filing window is met once the
   payer confirms receipt" in `src/app/(app)/claims/[id]/page.tsx` must change to the owner's answer —
   timely if **submitted** by the deadline, evidenced by the clearinghouse acknowledgement.
8. Re-seed pre-production data after PR #59 (P1 rules): `denials.appeal_deadline` rows written
   before it hold the old rolled (later) date and show no "pending counsel" marker.
9. Patient records P2–P4 (`specs/patients.md`): secondary coverage and eligibility, accounting of
   disclosures export (R-5.1.1), sensitivity-tag enforcement. After P1 deploys, re-seed or create a practice so
   seeded patients carry addresses and coverage (existing rows get coverage from the migration).

## Open questions for humans
- Month-end clamping of the 6- and 12-month timely-filing windows (billing-structure review §3.4,
  §8 item 3): being researched separately; not yet decided.
- Appeals A1 (`specs/appeals.md`): late-filing blocking (OA-023), withdrawn/dismissed → denial
  status mapping (OA-024), appeal version history before A2 (OA-025), Medicare amount-in-controversy
  thresholds source (OA-026), tracking/recovered-amount field masking (OA-027), abandoning a draft
  appeal (OA-028), compliance member-ID reveal on appeals (OA-029), counsel sign-off on the level
  2–5 Medicare rules added in this review round (OA-030), sensitivity-tag masking timing (OA-031),
  appeal record retention (OA-032).
- Budget, timeline, team, success targets (`PRODUCT_BRIEF.md` TODOs).
- Regulatory role memo, counsel, clearinghouse choice (ROADMAP Phase 0, human items).
- Confirm Azure regions at cutover.
- Counsel review of the overall look and feel (trade dress) before public launch, including the
  elements ADR 0005 kept (navy/teal chrome, white header, tab bar with teal underline, serif
  titles); ADR 0005 records the engineering checks and the changes made, and is not legal advice.
  Related: git history still carries a competitor's name in earlier doc wording, and no
  requirement ID covers third-party IP / brand compliance yet (R-15.7 covers licensing).
- A vector (SVG) version of the logo from a designer; the app currently uses the PNG.
- Confirm and record the license and generating tool for the sign-in reception image
  (`public/brand/README.md`); it is owner-supplied and described as a synthetic render.
- The repo has no `main` branch; the default branch is `claude/quirky-feynman-ufql5a`. Rename it
  to `main` and protect it (R-7.4.4) before more PRs land.
- Insight exported .xlsx workbooks (R-9.2.1, SOC 2 C1.1/CC6.7): owner said "not sure, let's
  confirm" on 2026-09-26 whether practices need a written handling/retention policy for downloaded
  workbooks (they leave the audited system as files on a user's device). See `OA-033` in
  `docs/owner/OWNER_ACTION_ITEMS.xlsx`. **Export to a production (Azure) tenant is gated on this
  item being resolved** — don't enable Insight export for a real practice before `OA-033` closes.

- Revenue cycle imports (before real data, `docs/threat-models/revenue-cycle-imports.md`):
  sensitivity tags for lines (Part 2/HIV/behavioral CPTs); encrypt account numbers or confirm
  PM exports never put member IDs there; accept the synthetic-only guard as attestation-level.
- Revenue cycle: the starter chart of accounts and payer-class codes are illustrative; each practice
  maps them to its own GL and PM financial classes (rule/GL editing UI needs version history first).
  Accountant to confirm the net-revenue presentation (posted write-offs vs. GAAP price concessions).
  The Statements page and dashboard are labelled a management view until that review.
- Revenue cycle deposits: the database owner role can still modify deposit rows (insert-only
  applies to the app role). Accept the risk or add a guard trigger? Owner decision.
- Git history still contains the reference prototype's names from before C0. Rewrite history
  (force-push of the default branch), or leave it? Owner decision.
- Claims: which Florida timely-filing exceptions (§ 627.6131(2)) the C3 submission block must
  honor; Medicare Advantage filing windows assumed to come from payer contracts (`specs/claims.md`).
- Patients before real data (`specs/patients.md`, P1 reviews): enforce sensitivity tags in access
  and masking (R-3.5.1, R-3.5.2) and a Part 2 consent decision before SUD-tagged data; demographic
  version history for HIPAA amendments (§164.526), P3; confirm compliance needs address and phone.
  Pre-prod entry relies on the SYN prefixes plus a synthetic attestation checkbox (ADR 0003).
- Patients: should front-desk registration be its own role? Guarantor now or with statements (§8.6)?

- Claims before real data: sensitivity masking of diagnosis codes in `claim_versions` snapshots and
  history; retention/legal-hold path for append-only history; PIP/workers' comp/Medicaid filing
  rules and the HMO citation for timely filing (`specs/claims.md`).

### Decisions from the 2026-09-26 agent reviews (need a human)
1. **MFA enrollment on first sign-in** needs only the password, so a stolen password for a
   never-enrolled account could enroll an attacker's authenticator. Recommended: admin-issued,
   expiring one-time enrollment links. (security #4)
2. **Separate database roles:** the app connects as the schema owner, which could disable RLS or
   the audit trigger if the app were compromised. Recommended: a migration-only owner and a
   non-owner runtime login; required before the Azure cutover. (security #6, R-15.9)
3. **Role/field matrix (R-5.1.2):** compliance can no longer reveal member IDs; every role still
   sees name, DOB, MRN, and diagnoses. Confirm who should see what. (compliance #5)
4. **Synthetic NPIs** pass the check digit and could coincide with real NPIs. Keep, or use a
   reserved/marked range? (compliance #7)

### Deferred review findings (tracked, not blocking pre-prod)
- Sensitivity tags (HIV, SUD/Part 2, …) not yet enforced in queries — before any real data (R-3.5.1, R-4.5.1).
- Composite `(tenant_id, id)` foreign keys; today code validates referenced IDs.
- WORM audit export at Azure cutover (owner can still drop the trigger).
- Member-ID reveal on a denial decrypts the patient's primary-payer member ID even when the claim was
  billed to another payer (R-5.1.2); fix with coverage records (review §6.1), and until then reveal
  only when the claim's payer is the patient's primary payer (2026-09-26 review, security).
- `claims.status` / `paid_cents` are not covered by the version trigger, and no DB CHECK enforces
  0 ≤ paid ≤ billed, 0 < denied ≤ billed, charges ≥ 0; must land with C3 / 835 posting, before the
  Azure cutover (2026-09-26 review, security; owner decision §8.4).
- Azure deploy gate, logging (owner decision 2026-09-26: hold until the Azure deployment; PR #28 reviews):
  - Log-sink residency and BAA (R-7.5.5): the Azure log destination is U.S.-only and under a BAA.
  - Tracing: Drizzle puts every query's params in the `drizzle.query.params` span attribute when
    OpenTelemetry is present. Before adding Azure Monitor / Application Insights, disable Drizzle
    spans or scrub that attribute.
  - Migrations: `drizzle-kit migrate` runs outside the sanitizer and prints full Postgres errors
    (including `detail` row values). Decide how production migrations run and where their output goes.

## Lessons / conventions learned
- Netlify env vars set as "secret" through the connector with context "all" were silently dropped;
  set secrets per context in the Netlify UI, or non-secret via the connector.
- In raw SQL subqueries, unqualified column names bind to the inner table (team-size bug caught by
  an integration test); prefer separate grouped queries.
- Tenant data only through `withTenant()` (src/db/tenant.ts); FK references from user input must be
  checked against the tenant in code (FKs bypass RLS).
- Next.js renders a hidden `role="alert"` route announcer; scope e2e alert queries to `main`.
- Once production exists, record tables (imports, vouchers, audit) change by adding columns only;
  C0's column drops were a one-time pre-production change on synthetic data.
- Never edit, rename, or renumber a migration once pushed: Netlify deploy previews apply each
  branch's migrations to a branch database, track them by number, and refuse any change ("modified
  after being applied"). Add a new migration instead. The same error appears when two
  branches pick the same number: branch databases start from the main preview database, so a
  base migration 0025 blocks a PR's own 0025. Before pushing a migration, merge the base branch
  and take the next free number (custom field values hit this on 2026-09-26: #49, then #52).
- Killing dev servers: use `pkill -f "[n]ext-server"` so the pattern doesn't match its own shell.
- Root layout calls `connection()` so APP_ENV is read at request time (never baked into a build).
- Data backfills in migrations must run tenant by tenant (`set_config('app.tenant_id', …, true)`):
  tenant tables FORCE RLS, so a non-superuser migration owner (Netlify, Azure) sees no rows
  otherwise. Local and CI databases use a superuser and hide this.
- Server-side validation must reject impossible dates (`z.iso.date()`).
- Every Drizzle query error (system and tenant) is sanitized where Drizzle creates it (ADR 0006,
  `src/db/errors.ts`): SQLSTATE + constraint for class 23, messages only for allow-listed codes and
  listed trigger formats. Match DB errors on `.code` / `.constraint` (`isUniqueViolation`), never on
  message text. A new trigger `RAISE` must be added to `TRIGGER_MESSAGE_FORMATS`.
- `onRequestError` (src/instrumentation.ts) logs route template, digest, error name and SQLSTATE
  only; Next.js still logs the error itself, so error messages must be PHI-free where thrown.
  `log.ts` checks the values of `route`/`routeType`/`digest`/`errorName`/`constraint` by pattern.
- Local test DB without Docker: `initdb`/`pg_ctl` from `/usr/lib/postgresql/16/bin` as the
  `postgres` user, with the data dir somewhere that user can reach.
- Playwright in this cloud env: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Azure has no Florida region; § 408.051(3) only requires continental U.S. storage.
- CI actions are pinned to full commit SHAs with a `# vX.Y.Z` comment (Dependabot bumps both);
  resolve annotated tags to the commit (`git ls-remote … 'refs/tags/vX.Y.Z^{}'`), not the tag object.
  Checkout runs with `persist-credentials: false`; gitleaks runs with PR comments off (token is `contents: read`).
- Local environment: Node 22 is installed; CI and Docker use Node 24 LTS. `engines` allows ≥ 22.
