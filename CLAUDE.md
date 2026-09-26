# DenialDesk — rules for agents

Every Claude session (and every subagent) reads this file first. Keep it short and true.

## What we are building

DenialDesk is a secure SaaS platform for Florida physician practices to submit, track,
and manage insurance claims and denials: classify denials (CARC/RARC), prioritize by
value and deadline, draft appeals, enforce Florida prompt-pay and appeal deadlines, and
track outcomes. Product brief: `docs/PRODUCT_BRIEF.md`. Requirements baseline: `docs/REQUIREMENTS.md`.

## Source of truth

- Requirements: `docs/REQUIREMENTS.md`. Every change maps to one or more requirement IDs (e.g., `R-3.1.3`).
- What to build: `docs/PRODUCT_BRIEF.md`, then one spec per feature in `docs/specs/`.
- Order of work: `docs/ROADMAP.md`.
- Architecture decisions: `docs/decisions/` (one short ADR per decision). Threat models: `docs/threat-models/`.
- Legal rules: `rules/` (versioned, effective-dated). **Never hard-code a statutory deadline, rate, or threshold anywhere else.**
- How agents collaborate: `docs/AGENT_WORKFLOW.md`.
- UI and visual design: `docs/DESIGN.md` (read before any UI work).
- Current status, decisions, and open questions: `docs/PROJECT_STATE.md` — read at session start, update at session end.

If a task is not backed by a spec, write or update the spec first.

## Non-negotiables

1. **No real PHI, ever.** Synthetic data only (Synthea, fixtures in `test/fixtures/synthetic/`) in code, fixtures, tests, logs, and issues. If you see anything that looks like real patient data, stop and tell the human.
2. **No production access.** Do not request, read, or use production credentials, consoles, or customer tenants.
3. **U.S.-only data residency** (Fla. Stat. § 408.051(3)). No infrastructure, service, SDK, or vendor may store or process PHI outside U.S. regions.
4. **No PHI in logs, URLs, analytics, error trackers, or test snapshots.** Log IDs only; use the redaction helpers.
5. **Tenant isolation.** Every query is tenant-scoped at the data layer. New tables need row-level security plus an isolation test.
6. **Encryption.** TLS 1.2+ in transit. AES-256 at rest. Field-level encryption for SSN, MBI, member IDs, and bank data.
7. **Audit everything.** Every PHI read or write emits an audit event (who, what, when, where, why).
8. **No code inflation.** Nothing may auto-change CPT/ICD/HCPCS codes without a recorded human approval (R-3.10.1, R-3.10.2).
9. **Don't invent payer rules or code meanings.** Cite the source in the spec or rule, or leave a TODO / ⚠️ VERIFY.
10. **Dependencies.** Don't add packages without checking they exist, are maintained, and are license-compatible. Note every new dependency in the PR.
11. **Never skip, disable, or delete a failing test** to get green.
12. **Merging.** The owner has authorized agents to merge their own PRs once CI is green and `reviewer`/`security-reviewer`/`compliance-checker` have no blocking findings open (2026-09-26). Never merge a red PR or bypass a check. Production (Azure) deploys still need a human.

## Commit & PR conventions

- One feature per branch and per PR. Small PRs (< ~400 changed lines) where possible.
- Commit subject: `<type>(<scope>): <summary> [R-x.x]`
- Add the trailer `AI-Assisted: true` to agent-authored commits.
- The PR description lists the requirement IDs, SOC 2 controls touched, data-classification impact, test evidence, and reviewer-agent results.

## Definition of Done

- [ ] Requirement IDs referenced; spec checkbox updated
- [ ] Unit + integration tests; boundary tests (day before / of / after) for any legal deadline
- [ ] Lint/typecheck clean
- [ ] `reviewer`: no blocking findings open
- [ ] `security-reviewer`: no Critical/High findings open
- [ ] `compliance-checker`: no blocking findings open; SOC 2 controls listed in the PR
- [ ] Docs/runbooks updated
- [ ] Merged per non-negotiable 12 (green CI, no blocking reviewer findings)

## Delegation guide

Agents live in `.claude/agents/`; details in `docs/AGENT_WORKFLOW.md`.

| Work                                    | Agent                |
| --------------------------------------- | -------------------- |
| Specs and acceptance criteria           | spec-writer          |
| Design, ADRs, threat models             | architect            |
| API, services, DB, UI, IaC, tests, docs | builder              |
| Legal deadlines, interest, thresholds   | florida-rules-engine |
| X12 / clearinghouse                     | edi-x12-specialist   |
| Correctness review                      | reviewer             |
| Security review                         | security-reviewer    |
| HIPAA / Florida law / SOC 2 review      | compliance-checker   |

## Stack

Decided in `docs/decisions/0001-tech-stack.md` (layout and performance rules there too).

- Language / framework: TypeScript (strict), Node.js 24 LTS, Next.js App Router, pnpm
- Database: PostgreSQL with row-level security; Drizzle ORM + drizzle-kit migrations
- Test command: `pnpm test` (unit), `pnpm test:integration` (needs `DATABASE_URL`), `pnpm test:e2e` (Playwright)
- Lint / typecheck command: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`
- Run locally: `docker compose up db`, `pnpm db:migrate`, `pnpm dev`
- Hosting: pre-production on Netlify, **synthetic data only** (`docs/decisions/0003-netlify-preproduction.md`);
  production on Microsoft Azure, U.S. regions only (`docs/decisions/0002-azure-hosting.md`). Keep platform code in adapters.
