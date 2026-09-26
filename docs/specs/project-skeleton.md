# Spec: Project skeleton

Status: approved (by delegated technical authority, 2026-09-26)
Roadmap item: `docs/ROADMAP.md` → Phase 0 → "Project skeleton: app, DB, test runner, lint, CI on every PR"
Requirement IDs: R-7.4.2, R-7.4.4, R-7.3.5, R-7.1.3, R-15.7

## Goal
A developer or agent can clone the repo, run one command to start the app against a local
database, and every PR is checked automatically. No product features yet.

## User stories
- As an agent or developer, I can run `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`
  and get the same results locally as in CI.
- As a reviewer, I can trust that a green PR has passed lint, types, tests, dependency audit,
  and a secrets scan.

## Acceptance criteria
- [ ] Next.js (App Router) + TypeScript strict app using pnpm and Node 24 LTS (`.nvmrc`, `engines`).
- [ ] Folder layout from ADR 0001 exists (`src/app`, `src/domain`, `src/edi`, `src/db`, `src/jobs`,
      `src/platform/{netlify,azure}`, `rules/`, `test/fixtures/synthetic/`), each with a short README line.
- [ ] Environment variables validated with Zod at startup; the app refuses to start with missing
      or invalid config. `.env.example` lists every variable with no real values.
- [ ] `APP_ENV` is one of `development | preview | production`; non-production shows the
      "Synthetic data — not for real patient information" banner on every page (ADR 0003).
- [ ] `GET /api/health` returns 200 with `{ status, appEnv, db }` and never includes secrets or data.
- [ ] Drizzle configured with drizzle-kit migrations; one initial empty migration applies cleanly.
- [ ] `docker compose up db` starts PostgreSQL locally; `pnpm db:migrate` applies migrations.
- [ ] Vitest: one unit test and one integration test that connects to PostgreSQL.
- [ ] Playwright: one smoke test that loads the home page and sees the synthetic-data banner.
- [ ] ESLint + Prettier configured; `pnpm lint` and `pnpm typecheck` pass.
- [ ] Logger wrapper that accepts IDs and event names only (no free-form objects), with a test.
- [ ] GitHub Actions on every PR: install (frozen lockfile), lint, typecheck, unit + integration
      (PostgreSQL service container), Playwright smoke, `pnpm audit --audit-level=high`, secrets scan.
- [ ] `Dockerfile` builds a production image of the app (Next.js standalone output).
- [ ] `CLAUDE.md` Stack section filled with the real commands.
- [ ] PR lists every new dependency with version and license.

## Data / API changes
No tables. One endpoint: `GET /api/health` (Internal classification; no PHI). No audit events yet.

## Legal rules used
None.

## Out of scope
Netlify deploy configuration (next roadmap item), auth, tenancy tables, rules engine, synthetic
data generator, any UI beyond a placeholder home page.

## Decisions
- Secrets scanner: gitleaks (GitHub Action).
- Background-job queue library: decided in a later spec, not here.
