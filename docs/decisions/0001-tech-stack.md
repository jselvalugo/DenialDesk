# ADR 0001: Tech stack

Status: proposed

## Context
Small team building heavily with AI agents. Needs: CRUD-heavy web app, relational
data, X12 parsing/generation, background jobs (clearinghouse polling, deadline alerts),
PDF export, multi-tenant isolation. Built and previewed on Netlify with synthetic data (ADR 0003);
production on Azure (ADR 0002), so the app must run on both.

## Proposal (to confirm)
- **TypeScript end to end** — one language for agents to hold in context; strong typing catches agent mistakes.
- **Next.js** for the web app plus a separate worker for background jobs (X12 exchange, deadline alerts).
- **PostgreSQL** + an ORM with migrations (Prisma or Drizzle).
- **Vitest** + **Playwright** for tests.
- **Claude API** for AI features in Phase 3, only under a BAA with U.S. processing (R-15.2).
- Hosting: pre-production on Netlify, synthetic data only (ADR 0003). Production on Microsoft
  Azure, U.S. regions only (ADR 0002), using services from Microsoft's HIPAA in-scope list
  (e.g. Azure Database for PostgreSQL Flexible Server, Azure Container Apps or App Service).
- Platform code isolated in adapters; the app also builds as a container for Azure.
- Row-level security in PostgreSQL for tenant isolation (R-7.2.4).

## Decision
TODO — human approves or edits, then set Status: accepted and fill in the Stack section of `CLAUDE.md`.
