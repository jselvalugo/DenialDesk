# Spec: Project skeleton

Status: done (2026-09-26)
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
- [x] Next.js (App Router) + TypeScript strict app using pnpm and Node 24 LTS (`.nvmrc`, `engines`).
- [x] Folder layout from ADR 0001 exists (`src/app`, `src/domain`, `src/edi`, `src/db`, `src/jobs`,
      `src/platform/{netlify,azure}`, `rules/`, `test/fixtures/synthetic/`), each with a short README line.
- [x] Environment variables validated with Zod at startup; the app refuses to start with missing
      or invalid config. `.env.example` lists every variable with no real values.
- [x] `APP_ENV` is one of `development | preview | production`; non-production shows the
      "Synthetic data — not for real patient information" banner on every page (ADR 0003).
- [x] `GET /api/health` returns 200 (503 if the database is down) with `{ status, appEnv, db }` and never includes secrets or data.
- [x] Drizzle configured with drizzle-kit migrations; one initial empty migration applies cleanly.
- [x] `docker compose up db` starts PostgreSQL locally; `pnpm db:migrate` applies migrations.
- [x] Vitest: unit tests and an integration test that connects to PostgreSQL.
- [x] Playwright: one smoke test that loads the home page and sees the synthetic-data banner.
- [x] ESLint + Prettier configured; `pnpm lint` and `pnpm typecheck` pass.
- [x] Logger wrapper that accepts IDs and event names only (no free-form objects), with a test.
- [x] GitHub Actions on every PR: install (frozen lockfile), lint, typecheck, unit + integration
      (PostgreSQL service container), Playwright smoke, `pnpm audit --audit-level=high`, secrets scan.
- [x] `Dockerfile` builds a production image of the app (Next.js standalone output).
- [x] `CLAUDE.md` Stack section filled with the real commands.
- [x] PR lists every new dependency with version and license.

## Data / API changes
No tables. One endpoint: `GET /api/health` (Internal classification; no PHI). No audit events yet.

## Legal rules used
None.

## Out of scope
Netlify deploy configuration (next roadmap item), auth, tenancy tables, rules engine, synthetic
data generator, any UI beyond a placeholder home page.

## Decisions
- Secrets scanner: gitleaks (GitHub Action). Config in `.gitleaks.toml`: default rules plus one
  allowlist for UI message keys (`labelKey: "aging.bucket.31_60"` reads as an API key to the
  generic rule).
- Background-job queue library: decided in a later spec, not here.

## Verification notes (2026-09-26)
- Local run used a PostgreSQL 16 server started directly (the session's Docker daemon wasn't
  available), so `docker compose up db` itself is untested here; CI uses a service container.
- `pnpm audit`, gitleaks, and the Dockerfile build run only in CI.
- APP_ENV is read per request (root layout calls `connection()`), so one image can be promoted
  from preview to production without rebuilding.
