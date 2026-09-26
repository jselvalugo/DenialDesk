<p align="center"><img src="docs/assets/denialdesk-logo.png" alt="DenialDesk" width="480"></p>

# DenialDesk

Claims and denial management for Florida physician practices. It ingests denied claims, prioritizes them, drafts appeals, tracks Florida prompt-pay and appeal deadlines, and tracks outcomes.

Status: Phase 0 complete, Phase 1 in progress. Current state: `docs/PROJECT_STATE.md`.

## Run locally

Requires Node 24 (22 works), pnpm, and PostgreSQL 16.

```bash
pnpm install
cp .env.example .env.local          # then set FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose up -d db
pnpm db:migrate
SEED_ADMIN_PASSWORD='a-long-passphrase' pnpm db:seed   # synthetic sample practice
pnpm dev                            # http://localhost:3000
```

Sign in as `demo.admin@denialdesk.test`; set up two-step verification with an authenticator app.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build && pnpm test:e2e`.

## Docs

Product: `docs/PRODUCT_BRIEF.md`, `docs/REQUIREMENTS.md`, `docs/ROADMAP.md`. Design: `docs/DESIGN.md`.
Decisions: `docs/decisions/`. Agents: `docs/AGENT_WORKFLOW.md`. Preview deploys: `docs/runbooks/netlify.md`.
