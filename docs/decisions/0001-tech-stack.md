# ADR 0001: Tech stack

Status: proposed

## Context
Small team building heavily with AI agents. Needs: CRUD-heavy web app, relational
data, file import, PDF export, LLM calls, HIPAA-capable hosting.

## Proposal (to confirm)
- **TypeScript end to end** — one language for agents to hold in context; strong typing catches agent mistakes.
- **Next.js** (app + API routes) or a separate API if we expect heavy background jobs.
- **PostgreSQL** + an ORM with migrations (Prisma or Drizzle).
- **Vitest** + **Playwright** for tests.
- **Claude API** for classification help and appeal drafting.
- Hosting on a provider that signs a BAA (e.g. AWS / GCP / Azure); note that many frontend hosts don't.

## Decision
TODO — human approves or edits, then set Status: accepted and fill in the Stack section of `CLAUDE.md`.
