# Runbook: Netlify preview deployment

Pre-production only, **synthetic data only** (ADR 0003). Never connect a real practice, real
claims, or a real clearinghouse to this environment.

Project: `denialdesk` on the `jselvalugo` team — https://app.netlify.com/projects/denialdesk
Site: https://denialdesk.netlify.app

## How it's wired
- **Database:** Netlify Database (Postgres), provisioned automatically. The app reads its
  connection string through `src/platform/netlify/database.ts` when `DATABASE_URL` is unset.
- **Migrations:** Netlify applies `netlify/database/migrations/` (generated from `drizzle/` by
  `pnpm netlify:migrations`) before each deploy is published. Deploy previews get their own
  isolated database branch, so PR branches never touch the main preview database.
- **Environment variables** (all contexts):

  | Variable | Purpose |
  |---|---|
  | `APP_ENV` | `preview` — shows the synthetic-data banner, enables the seed endpoint |
  | `FIELD_ENCRYPTION_KEY` | AES-256 key for member IDs and MFA secrets (secret; pre-prod only) |
  | `SEED_TOKEN` | Bearer token for the one-time seed endpoint (secret) |
  | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Demo admin account created by the seed (password secret) |
  | `DEMO_LOGIN_ENABLED` | `true` shows "Explore the demo practice" on sign-in (ignored in production) |
  | `PLATFORM_OPERATOR_EMAIL` | The one account allowed into the platform console at `/operator` |

  If `APP_ENV` is missing the app still treats itself as non-production — safe by default.
- **Access:** Netlify password protection is on for the whole site, in front of the app's own
  sign-in with two-step verification.

## Deploying
- **From GitHub (recommended):** link the repo in *Project configuration → Build & deploy →
  Continuous deployment*, production branch = the repo's default branch. Every merge deploys;
  every PR gets a deploy preview with its own database branch.
- **Manual:** from the repo root, run the command the Netlify connector's `deploy-site` returns
  (`npx @netlify/mcp … --site-id …`), which uploads the working tree and builds on Netlify.

## Seeding the demo practice (once per database)
```bash
curl -X POST -H "Authorization: Bearer $SEED_TOKEN" https://denialdesk.netlify.app/api/preview/seed
# {"status":"seeded"}  — or {"status":"exists"} if already done
```
With site password protection on, send the site password too (Netlify accepts it as HTTP basic
auth), or seed before turning protection on. The endpoint returns 404 in production, without the
token, or with a wrong token.

Then sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` and set up two-step verification.

## Demo practice and operator console
- "Explore the demo practice" signs visitors into a shared synthetic demo practice, created on
  first use. Reset it any time from `/operator` → *Reset demo practice* (the old one is archived).
- `/operator` is visible only to `PLATFORM_OPERATOR_EMAIL` after password + two-step sign-in.
  Everyone else gets a 404.

## Checks after each deploy
- `https://denialdesk.netlify.app/api/health` returns `{"status":"ok","appEnv":"preview","db":"up"}`.
- The amber "Synthetic data only" banner is visible on every page.

## Not on Netlify
Real PHI, production secrets, the live clearinghouse, SOC 2 scope, and customer BAAs all
belong to the Azure production environment (ADR 0002).
