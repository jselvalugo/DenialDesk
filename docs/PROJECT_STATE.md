# Project state — shared memory

Read this at the start of every session, after `CLAUDE.md`. Update it at the end of every session
that changes decisions, status, or open questions. Keep it short: facts and links, not narrative.

_Last updated: 2026-09-26_

## Where we are
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
- Live preview: https://denialdesk.netlify.app (Netlify Database, us-east-2). A platform operator
  console (`/operator`) for the owner, with its own sign-in at
  `/operator/login` and an operator account that belongs to no practice (`specs/operator-login.md`).
  The operator account exists only from hosting configuration (`PLATFORM_OPERATOR_PASSWORD_HASH`,
  made with `pnpm operator:credential`); no page can create or reset it (owner rebaseline 2026-09-26).
  An unusable value (e.g. the password pasted instead of its hash) switches the console off and is
  reported once in the function log as `operator.credential_unusable` (runbook has the fix).
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
- The one-click demo practice was removed entirely (owner request, 2026-09-26); migration 0021
  archived any live demo practice and ended demo sessions; 0022 disabled demo-only accounts and
  audited each retired demo practice (`system.demo_retired`). Practices are created from the console.
- Open item (owner decision): retention of the archived demo practices (synthetic). Proposed: keep
  them until the Terminate → offboarding flow exists, then terminate them through it.
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
| 2026-09-26 | ERP shell: global header, navy tab bar, module switcher (replaces the sidebar) | ADR 0004 amendment, `specs/erp-shell.md` |
| 2026-09-26 | No self-service sign-up; the operator creates practices after the BAA is signed, and records the BAA on the practice page | `specs/practice-agreements.md` |
| 2026-09-26 | BAA handling is manual by design: no sign-in blocking without a BAA, no template version, corrections via "recorded in error", nothing automatic at termination | `specs/practice-agreements.md` (Decisions) |
| 2026-09-26 | Shell differentiated from any vendor's product; no third-party design IP; competitor names out of product copy and public docs | ADR 0005 |

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
6. Patient records P2–P4 (`specs/patients.md`): secondary coverage and eligibility, accounting of
   disclosures export (R-5.1.1), sensitivity-tag enforcement. After P1 deploys, re-seed or create a practice so
   seeded patients carry addresses and coverage (existing rows get coverage from the migration).

## Open questions for humans
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

## Lessons / conventions learned
- Netlify env vars set as "secret" through the connector with context "all" were silently dropped;
  set secrets per context in the Netlify UI, or non-secret via the connector.
- In raw SQL subqueries, unqualified column names bind to the inner table (team-size bug caught by
  an integration test); prefer separate grouped queries.
- Tenant data only through `withTenant()` (src/db/tenant.ts); FK references from user input must be
  checked against the tenant in code (FKs bypass RLS).
- Drizzle wraps DB errors: the Postgres message is on `error.cause` (see test helper `expectDbError`).
- Next.js renders a hidden `role="alert"` route announcer; scope e2e alert queries to `main`.
- Once production exists, record tables (imports, vouchers, audit) change by adding columns only;
  C0's column drops were a one-time pre-production change on synthetic data.
- Never edit, rename, or renumber a migration once pushed: Netlify deploy previews apply each
  branch's migrations to a branch database, track them by number, and refuse any change ("modified
  after being applied"). Add a new migration instead.
- Killing dev servers: use `pkill -f "[n]ext-server"` so the pattern doesn't match its own shell.
- Root layout calls `connection()` so APP_ENV is read at request time (never baked into a build).
- Data backfills in migrations must run tenant by tenant (`set_config('app.tenant_id', …, true)`):
  tenant tables FORCE RLS, so a non-superuser migration owner (Netlify, Azure) sees no rows
  otherwise. Local and CI databases use a superuser and hide this.
- Server-side validation must reject impossible dates (`z.iso.date()`); `sanitizeDatabaseError`
  drops messages for SQLSTATE class 22 because they quote values.
- Local test DB without Docker: `initdb`/`pg_ctl` from `/usr/lib/postgresql/16/bin` as the
  `postgres` user, with the data dir somewhere that user can reach.
- Playwright in this cloud env: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Azure has no Florida region; § 408.051(3) only requires continental U.S. storage.
- CI actions are pinned to full commit SHAs with a `# vX.Y.Z` comment (Dependabot bumps both);
  resolve annotated tags to the commit (`git ls-remote … 'refs/tags/vX.Y.Z^{}'`), not the tag object.
  Checkout runs with `persist-credentials: false`; gitleaks runs with PR comments off (token is `contents: read`).
- Local environment: Node 22 is installed; CI and Docker use Node 24 LTS. `engines` allows ≥ 22.
