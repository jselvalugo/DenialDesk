# Roadmap

Each item becomes a spec in `docs/specs/` and then one or more GitHub issues.
Work top to bottom; don't start a phase until the previous one is merged.

## Phase 0 — Foundation
- [ ] Finish `PRODUCT_BRIEF.md` (human)
- [ ] ADR 0001: tech stack (architect agent proposes, human approves)
- [ ] Project skeleton: app, DB, test runner, lint, CI on every PR
- [ ] Synthetic data generator (patients, claims, denials with realistic CARC codes)
- [ ] Auth + audit log skeleton

## Phase 1 — Denial inbox (MVP core)
- [ ] Denial data model + CSV import
- [ ] CARC/RARC classification into categories
- [ ] Prioritized work queue UI
- [ ] Denial detail page: notes, assignment, status

## Phase 2 — Appeals
- [ ] Appeal letter templates per category
- [ ] AI-drafted appeal from claim + denial context (human edits before export)
- [ ] PDF export, deadline reminders

## Phase 3 — Insight
- [ ] Outcome tracking
- [ ] Dashboard: volume, recovery rate, top denial reasons by payer
- [ ] 835 ERA ingestion
