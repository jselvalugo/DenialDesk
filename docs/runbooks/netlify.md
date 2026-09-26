# Runbook: Netlify preview deployment

Pre-production only, **synthetic data only** (ADR 0003). Never connect a real practice, real
claims, or a real clearinghouse to this environment.

## One-time setup
1. **Create the site.** In Netlify: *Add new site → Import from Git →* `jselvalugo/denialdesk`.
   Netlify detects Next.js; `netlify.toml` sets the build command (`pnpm db:migrate && pnpm build`).
2. **Create the database.** Use Netlify DB (Neon) or a Neon project in a **U.S. East** region,
   the same region as the site's functions (co-location keeps pages fast — ADR 0001).
3. **Set environment variables** (*Site configuration → Environment variables*, scope: Builds
   and Functions):

   | Variable | Value |
   |---|---|
   | `APP_ENV` | `preview` |
   | `DATABASE_URL` | Postgres connection string from step 2 |
   | `FIELD_ENCRYPTION_KEY` | Output of `openssl rand -base64 32` (generate a new one; never reuse production keys) |

   If `APP_ENV` is missing, the app treats itself as non-production and still shows the
   synthetic-data banner — safe by default.
4. **Functions region.** *Site configuration → Functions → Region*: pick the U.S. East region
   closest to the database.
5. **Deploy**, then seed the demo practice once from your machine against the same database:
   ```bash
   DATABASE_URL=... FIELD_ENCRYPTION_KEY=... APP_ENV=preview \
   SEED_ADMIN_EMAIL=you@yourpractice.test SEED_ADMIN_PASSWORD='a-long-passphrase' pnpm db:seed
   ```
   Sign in with that email and password; you'll set up two-step verification with an
   authenticator app on first sign-in.

## Checks after each deploy
- `https://<site>/api/health` returns `{"status":"ok","appEnv":"preview","db":"up"}`.
- The amber "Synthetic data only" banner is visible on every page.

## Not on Netlify
Real PHI, production secrets, the live clearinghouse, SOC 2 scope, and customer BAAs all
belong to the Azure production environment (ADR 0002).
