# src/platform/netlify

The only place Netlify-specific code lives: function wrappers, scheduled-function bindings (ADR 0003). Pre-production only.

Today: `database.ts` (Netlify Database connection), `migrations.ts` (the `netlify/database/migrations/` mirror), `jobs.ts` (this deploy's worker URL) and `job-handlers.ts` (request/response plumbing for the background job worker and the scheduler; ADR 0012). The function files themselves are thin re-exports in `netlify/functions/` because Netlify reads their `config` statically; the logic is in `src/integrations/jobs/`.
