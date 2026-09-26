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
- Operator console can reset the demo with sample data or empty (setup only) to test features
  from a clean slate.
- Live preview: https://denialdesk.netlify.app (Netlify Database, us-east-2). One-click demo
  login and a platform operator console (`/operator`) for the owner.
- Working branch: `claude/adoring-hypatia-5co7fz`; production branch on Netlify: `claude/quirky-feynman-ufql5a` (default).

## Decisions made (details in `docs/decisions/`)
| Date | Decision | Record |
|---|---|---|
| 2026-09-26 | MVP = Florida claims + denial platform (REQUIREMENTS §12 Phase 1) | `PRODUCT_BRIEF.md`, `ROADMAP.md` |
| 2026-09-26 | 8-agent roster instead of 11 | `AGENT_WORKFLOW.md` |
| 2026-09-26 | Stack: TypeScript, Next.js, PostgreSQL + Drizzle, Vitest, Playwright | ADR 0001 |
| 2026-09-26 | Production on Azure, U.S. only; primary likely East US 2 (confirm at cutover) | ADR 0002 |
| 2026-09-26 | Pre-production on Netlify, synthetic data only | ADR 0003 |
| 2026-09-26 | Enterprise design system; Tailwind v4 + own components + Radix | ADR 0004, `DESIGN.md` |
| 2026-09-26 | RevCycle IQ look and feel (navy/teal, Playfair/Inter/Space Mono, lucide icons); logo unchanged | ADR 0004 amendment, `specs/revcycle-look-and-feel.md` |
| 2026-09-26 | Port RevCycle IQ accounting (rules engine, JVs, FIFO A/R, deposits, statements) as a tenant-scoped module, phases B1–B5 | `specs/revenue-cycle-accounting.md` |
| 2026-09-26 | Secrets scanning: gitleaks in CI | `specs/project-skeleton.md` |
| 2026-09-26 | Agents merge their own PRs once CI is green and reviewers have no blocking findings | `CLAUDE.md` #12 |
| 2026-09-26 | Rate limits on demo login, sign-in, MFA, and seed endpoint | `specs/rate-limiting.md` |

The product owner delegated technical decisions to the implementing agent ("make the best
technical decisions"). Decisions still get an ADR so a human can review them.

## Next up
0. Revenue cycle module (`specs/revenue-cycle-accounting.md`): B1 rules and ledger and B2 monthly file
   import done; next B3 journal vouchers (MIP export), B4 deposits and A/R aging, B5 statements
   and dashboard.
1. Deploy the Netlify preview (human: create site, database, env vars — runbook).
2. 835 ERA ingestion → real denial capture (edi-x12-specialist).
3. Payer setup screen (appeal windows from contracts) and practice/provider setup.
4. Claims C2–C4 (`specs/claims.md`): CSV charge import → draft claims; 837P via clearinghouse
   stub with the timely-filing block; 999/277CA capture.
5. Appeal letter templates (human review before export).

## Open questions for humans
- Budget, timeline, team, success targets (`PRODUCT_BRIEF.md` TODOs).
- Regulatory role memo, counsel, clearinghouse choice (ROADMAP Phase 0, human items).
- Confirm Azure regions at cutover.
- A vector (SVG) version of the logo from a designer; the app currently uses the PNG.
- The repo has no `main` branch; the default branch is `claude/quirky-feynman-ufql5a`. Rename it
  to `main` and protect it (R-7.4.4) before more PRs land.

- Revenue cycle imports (before real data, `docs/threat-models/revenue-cycle-imports.md`):
  sensitivity tags for lines (Part 2/HIV/behavioral CPTs); encrypt account numbers or confirm
  PM exports never put member IDs there; accept the synthetic-only guard as attestation-level.
- Claims: which Florida timely-filing exceptions (§ 627.6131(2)) the C3 submission block must
  honor; Medicare Advantage filing windows assumed to come from payer contracts (`specs/claims.md`).
- Revenue cycle: confirm the Capitation rule is meant to be shadowed by the Medicare/Medicaid wrap
  rule, and the GL account / payer-class names (seeded names are descriptive placeholders).

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
- Pin GitHub Actions to commit SHAs (Dependabot now keeps them current).

## Lessons / conventions learned
- Netlify env vars set as "secret" through the connector with context "all" were silently dropped;
  set secrets per context in the Netlify UI, or non-secret via the connector.
- In raw SQL subqueries, unqualified column names bind to the inner table (team-size bug caught by
  an integration test); prefer separate grouped queries.
- Tenant data only through `withTenant()` (src/db/tenant.ts); FK references from user input must be
  checked against the tenant in code (FKs bypass RLS).
- Drizzle wraps DB errors: the Postgres message is on `error.cause` (see test helper `expectDbError`).
- Next.js renders a hidden `role="alert"` route announcer; scope e2e alert queries to `main`.
- Killing dev servers: use `pkill -f "[n]ext-server"` so the pattern doesn't match its own shell.
- Root layout calls `connection()` so APP_ENV is read at request time (never baked into a build).
- Local test DB without Docker: `initdb`/`pg_ctl` from `/usr/lib/postgresql/16/bin` as the
  `postgres` user, with the data dir somewhere that user can reach.
- Playwright in this cloud env: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Azure has no Florida region; § 408.051(3) only requires continental U.S. storage.
- Local environment: Node 22 is installed; CI and Docker use Node 24 LTS. `engines` allows ≥ 22.
