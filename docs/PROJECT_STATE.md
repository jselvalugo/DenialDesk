# Project state — shared memory

Read this at the start of every session, after `CLAUDE.md`. Update it at the end of every session
that changes decisions, status, or open questions. Keep it short: facts and links, not narrative.

_Last updated: 2026-09-26_

## Where we are
- Phase 0 (Foundation). Planning docs done; project skeleton + design foundation in progress.
- Working branch: `claude/adoring-hypatia-5co7fz` (no PR opened yet).

## Decisions made (details in `docs/decisions/`)
| Date | Decision | Record |
|---|---|---|
| 2026-09-26 | MVP = Florida claims + denial platform (REQUIREMENTS §12 Phase 1) | `PRODUCT_BRIEF.md`, `ROADMAP.md` |
| 2026-09-26 | 8-agent roster instead of 11 | `AGENT_WORKFLOW.md` |
| 2026-09-26 | Stack: TypeScript, Next.js, PostgreSQL + Drizzle, Vitest, Playwright | ADR 0001 |
| 2026-09-26 | Production on Azure, U.S. only; primary likely East US 2 (confirm at cutover) | ADR 0002 |
| 2026-09-26 | Pre-production on Netlify, synthetic data only | ADR 0003 |
| 2026-09-26 | Enterprise design system; Tailwind v4 + own components + Radix; IBM Plex | ADR 0004, `DESIGN.md` |
| 2026-09-26 | Secrets scanning: gitleaks in CI | `specs/project-skeleton.md` |

The product owner delegated technical decisions to the implementing agent ("make the best
technical decisions"). Decisions still get an ADR so a human can review them.

## Next up
1. Finish project skeleton + design foundation (`docs/specs/project-skeleton.md`,
   `docs/specs/design-system-foundation.md`).
2. Netlify deploy previews with pre-prod guards (ADR 0003).
3. Synthetic data generator; tenancy + RLS; auth; audit log; rules-engine skeleton.

## Open questions for humans
- Budget, timeline, team, success targets (`PRODUCT_BRIEF.md` TODOs).
- Regulatory role memo, counsel, clearinghouse choice (ROADMAP Phase 0, human items).
- Confirm Azure regions at cutover.
- A vector (SVG) version of the logo from a designer; the app currently uses the PNG.

## Lessons / conventions learned
- Azure has no Florida region; § 408.051(3) only requires continental U.S. storage.
- Local environment: Node 22 is installed; CI and Docker use Node 24 LTS. `engines` allows ≥ 22.
