# DenialDesk — rules for agents

Every Claude session (and every subagent) reads this file first. Keep it short and true.

## What we are building
DenialDesk helps healthcare revenue-cycle teams work denied insurance claims:
ingest denials, classify the reason (CARC/RARC codes), prioritize by value and
deadline, draft appeals, and track outcomes. Full brief: `docs/PRODUCT_BRIEF.md`.

## Source of truth
- What to build: `docs/PRODUCT_BRIEF.md`, then one spec per feature in `docs/specs/`.
- Order of work: `docs/ROADMAP.md`.
- Why things are the way they are: `docs/decisions/` (one short ADR per decision).
- How agents collaborate: `docs/AGENT_WORKFLOW.md`.

If a task is not backed by a spec, write or update the spec first.

## Hard rules
- **No real PHI, ever.** Only synthetic patients/claims in code, fixtures, tests, logs, and issues.
- Never log claim or patient fields; log IDs only.
- One feature per branch and per PR. Small PRs (< ~400 changed lines) where possible.
- Every PR: tests for new behavior, lint/typecheck clean, spec checkbox updated.
- Never skip, disable, or delete a failing test to get green.
- Don't invent payer rules or code meanings — cite the source in the spec or leave a TODO.

## Stack
TBD — see `docs/decisions/0001-tech-stack.md`. Once decided, list here:
- Language / framework:
- Database:
- Test command:
- Lint / typecheck command:
- Run locally:
