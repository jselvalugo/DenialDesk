# ADR 0001: Tech stack

Status: accepted (2026-09-26)

## Context
Small team building heavily with AI agents. Needs: CRUD-heavy web app, relational
data, X12 parsing/generation, background jobs (clearinghouse polling, deadline alerts),
PDF export, multi-tenant isolation. Built and previewed on Netlify with synthetic data (ADR 0003);
production on Azure (ADR 0002), so the app must run on both. Performance targets from
REQUIREMENTS §11: P95 page load < 2 s, claim scrub < 3 s, 10,000-claim batch < 30 min.

## Decision
- **TypeScript (strict) end to end** — one language for agents to hold in context; strong typing
  catches agent mistakes.
- **Runtime:** Node.js 24 LTS. **Package manager:** pnpm.
- **Web app:** Next.js (App Router, React Server Components) — pages render on the server
  close to the database, and ship little JavaScript to the browser.
- **Database:** PostgreSQL with row-level security for tenant isolation (R-7.2.4).
- **Data access:** Drizzle ORM + drizzle-kit migrations. Chosen over Prisma because it is a thin,
  SQL-first layer: no separate query engine, small cold starts on serverless, and easy
  per-transaction `set_config('app.tenant_id', …)` for row-level security.
- **Validation:** Zod at every boundary (HTTP input, CSV, parsed X12, env vars).
- **Background jobs:** plain TypeScript functions, queued in PostgreSQL. A thin runner per
  platform calls them: Netlify scheduled/background functions in pre-prod, a worker container
  on Azure. The queue library is chosen and vetted in the skeleton spec (R-15.7).
- **Tests:** Vitest (unit + integration against a real PostgreSQL), Playwright (end-to-end).
- **Lint/format:** ESLint (Next.js + typescript-eslint) and Prettier.
- **CI:** GitHub Actions on every PR: lint, typecheck, unit + integration, e2e smoke,
  dependency audit, secrets scan (R-7.4.2, R-7.3.5).
- **Hosting:** pre-production on Netlify, synthetic data only (ADR 0003). Production on
  Microsoft Azure, U.S. regions only (ADR 0002), using services from Microsoft's HIPAA
  in-scope list (e.g. Azure Database for PostgreSQL Flexible Server, Azure Container Apps).
  Platform code isolated in adapters; the app also builds as a container.
- **AI:** Claude API for Phase 3 features only, under a BAA with U.S. processing (R-15.2).

## Performance rules (so the app stays fast)
- **Co-locate** app compute and database in the same region (pre-prod: set Netlify functions
  and the database to the same U.S. East region; prod: East US 2 for both). Cross-region
  database round trips are the most common cause of a slow app.
- **Nothing slow in a request.** X12 submission, file imports, clearinghouse polling, PDF
  generation, and deadline recalculation run as background jobs; the UI shows status.
- **Query discipline:** indexes for every work-queue sort/filter (tenant, status, deadline,
  amount), pagination on every list, no N+1 queries (reviewer checks this).
- **Server-first UI:** Server Components by default; client components only where interaction
  needs them.
- **Measure:** a performance budget test for the work queue in CI once it exists, and
  P95 latency tracking in production (§11).

## Repository layout
```
src/app/            Next.js routes and UI
src/domain/         business logic (claims, denials, appeals) — no framework imports
src/edi/            X12 parsing/generation (edi-x12-specialist)
src/db/             Drizzle schema, migrations, tenant-scoped query helpers
src/jobs/           background job functions
src/platform/       adapters: netlify/, azure/ (only place platform code lives)
rules/              legal rules engine data + functions (florida-rules-engine)
test/fixtures/synthetic/   synthetic data only
```

## Consequences
- Agents get one language and one set of commands (listed in `CLAUDE.md` → Stack).
- Every new dependency beyond this list still needs the existence/maintenance/license check.
- Integration tests need a PostgreSQL instance: Docker Compose locally, a service container in CI.
