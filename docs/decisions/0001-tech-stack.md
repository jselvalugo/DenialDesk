# ADR 0001: Tech stack

Status: proposed

## Context
Small team building heavily with AI agents. Needs: CRUD-heavy web app, relational
data, X12 parsing/generation, background jobs (clearinghouse polling, deadline alerts),
PDF export, HIPAA-capable hosting on Azure, multi-tenant isolation.

## Proposal (to confirm)
- **TypeScript end to end** — one language for agents to hold in context; strong typing catches agent mistakes.
- **Next.js** for the web app plus a separate worker for background jobs (X12 exchange, deadline alerts).
- **PostgreSQL** + an ORM with migrations (Prisma or Drizzle).
- **Vitest** + **Playwright** for tests.
- **Claude API** for AI features in Phase 3, only under a BAA with U.S. processing (R-15.2).
- Hosting: Microsoft Azure, U.S. regions only (see ADR 0002). Pick compute, database, and queue
  services from Microsoft's HIPAA in-scope list (e.g. Azure Database for PostgreSQL Flexible
  Server, Azure Container Apps or App Service). Frontend hosts without a BAA are out.
- Row-level security in PostgreSQL for tenant isolation (R-7.2.4).

## Decision
TODO — human approves or edits, then set Status: accepted and fill in the Stack section of `CLAUDE.md`.
