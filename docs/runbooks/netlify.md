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
  | `SEED_TOKEN` | Bearer token for the demo seed endpoint (secret); no operator power |
  | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Admin of the seeded synthetic practice (password secret); not the operator |
  | `DEMO_LOGIN_ENABLED` | `true` shows "Explore the demo practice" on sign-in (ignored in production) |
  | `PLATFORM_OPERATOR_EMAIL` | The operator account for the platform console; an address used only for the console, never a practice user |
  | `PLATFORM_OPERATOR_PASSWORD_HASH` | The operator's password hash from `pnpm operator:credential` (secret); the only way the operator account is created or reset |
  | `RATE_LIMIT_DEMO` / `RATE_LIMIT_SIGNIN` / `RATE_LIMIT_MFA` | Optional overrides for per-network limits (defaults 10/10 min, 30/15 min, 30/15 min) |

  If `APP_ENV` is missing the app still treats itself as non-production — safe by default.
- **Access:** Netlify password protection is on for the whole site, in front of the app's own
  sign-in with two-step verification.

## Deploying
- **From GitHub (recommended):** link the repo in *Project configuration → Build & deploy →
  Continuous deployment*, production branch = the repo's default branch. Every merge deploys;
  every PR gets a deploy preview with its own database branch.
- **Manual:** from the repo root, run the command the Netlify connector's `deploy-site` returns
  (`npx @netlify/mcp … --site-id …`), which uploads the working tree and builds on Netlify.

## Seeding the demo practice, and recovering the admin account
```bash
curl -X POST -H "Authorization: Bearer $SEED_TOKEN" https://denialdesk.netlify.app/api/preview/seed
# first call: {"status":"seeded"}
# later calls: {"status":"repaired"} — the SEED_ADMIN_EMAIL account's password is reset to
# SEED_ADMIN_PASSWORD, its lockout cleared and its sessions ended. Add -d '{"resetMfa": true}'
# (with -H "Content-Type: application/json") to clear two-step enrollment and set it up again.
```
Refused (409) if that email belongs to a user of any other practice. Every repair is audited
(`system.admin_repaired`). ⚠️ Anyone holding `SEED_TOKEN` can reset the admin's password and MFA
in pre-production: treat it like the admin password and rotate it after use.
With site password protection on, send the site password too (Netlify accepts it as HTTP basic
auth), or seed before turning protection on. The endpoint returns 404 in production, without the
token, or with a wrong token.

Then sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` and set up two-step verification.

## Demo practice and operator console
- "Explore the demo practice" signs visitors into a shared synthetic demo practice, created on
  first use. Reset it any time from `/operator` → *Reset demo with sample data* or *Reset demo empty* (setup only, no claims/denials/files); the old one is archived.
- Migrations run with the deploy; never deploy app code ahead of its migrations or run a
  column-dropping migration while an older build is still serving.
- After a release that changes the revenue cycle starter configuration or file layout (e.g. C0,
  2026-09-26), reset the demo so it carries the new configuration and sample files. Other
  pre-production practices keep their stored rules; an admin can review them on the Rules page.
- The platform console has its own sign-in at `/operator/login` (spec: `docs/specs/operator-login.md`).
  Only the `PLATFORM_OPERATOR_EMAIL` account can use it, with password + two-step verification. That
  account belongs to no practice and can't sign in at `/login`; practice users can't sign in to the console.
  Operator and practice/demo sessions are separate, so one browser can hold both.
- **Operator account (sole administrator):** it exists only from configuration. On your own machine run
  `pnpm operator:credential`, then set `PLATFORM_OPERATOR_EMAIL` (an address used only for the console,
  never a practice user and not `SEED_ADMIN_EMAIL`) and `PLATFORM_OPERATOR_PASSWORD_HASH` (secret) in
  Netlify, and redeploy. Sign in at `/operator/login`; two-step is set up on first sign-in.
- **Forgotten password or lost authenticator:** run `pnpm operator:credential` again and replace
  `PLATFORM_OPERATOR_PASSWORD_HASH`. The next request applies it: new password, two-step reset, every
  operator session ended (audited as `operator.credential_rotated`). There is no in-app recovery.
  Changes only move forward: an old deploy link or a rollback still carrying the previous hash can't
  apply it again (sign-in there is refused). Clear the terminal after copying the hash.
- `PLATFORM_OPERATOR_EMAIL` must never equal `SEED_ADMIN_EMAIL` (the seed refuses it). Mark
  `PLATFORM_OPERATOR_PASSWORD_HASH` secret, and keep two-step (ideally a security key) on the Netlify
  account: whoever can edit these values controls the console.

## Checks after each deploy
- `https://denialdesk.netlify.app/api/health` returns `{"status":"ok","appEnv":"preview","db":"up"}`.
- The amber "Synthetic data only" banner is visible on every page.

## Not on Netlify
Real PHI, production secrets, the live clearinghouse, SOC 2 scope, and customer BAAs all
belong to the Azure production environment (ADR 0002).
