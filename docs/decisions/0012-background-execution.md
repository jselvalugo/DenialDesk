# ADR 0012: Background execution — signed `{ runId }` jobs, a definer-only claim, a 15-minute scheduler

Status: Proposed (2026-09-29, PI2c builder; revised after the PR #100 reviews). Needs the owner's R-15.9
sign-off on migrations 0044 and 0045 together (OA-085). Builds on ADR 0010 ("Jobs") and ADR 0003 ("background jobs
must fit both Netlify and Azure"). Spec `docs/specs/patient-integrations.md` (PI2b Jobs, PI3); threat model
`docs/threat-models/patient-integrations.md` (S5, S7, S8, D5).

## Context
PI2b part 1 built the sync engine (`executeSyncRun`) and ran it inside the administrator's request. A large
practice can need up to the 12-minute run budget, the platform can kill a request, and PI3 needs a sync about every
15 minutes (OA-056) with nobody signed in. Work has to run with no user session, start only when something
legitimate asked for it, and stay portable: Netlify (pre-production, synthetic data only) now, an Azure worker
later (ADR 0002, 0003).

## Decision
- **A job is a signed POST of `{ "runId": "<uuid>" }`, nothing else.** Two headers: a Unix timestamp and
  `v1=` + HMAC-SHA256 over `<timestamp>.<body>`, keyed by `INTEGRATION_JOB_SECRET` (at least 32 bytes). The
  receiver accepts a timestamp within 5 minutes either way, compares the MAC with `timingSafeEqual`, parses
  the body only afterwards, and refuses any payload that is not exactly `{ runId }` (`z.strictObject`). The
  tenant is never in the job: it comes from the database. The body is read from the request stream with a
  1,024-byte cap enforced while reading (in the platform-neutral worker, so Azure gets it too), whatever
  `Content-Length` says or omits.
- **The claim is a definer-only check.** SECURITY DEFINER `integration_claim_run(run_id)` returns
  `(tenant_id, connection_id)` only for a `queued` run of an `active` connection. It is read-only: the atomic
  `queued -> running` move, and its `integration.sync_started` audit event, stay in the engine's own claim
  (`claimRun` locks the run row and refuses anything not queued), so of two workers holding one job exactly one
  runs it, and a running or finished run is refused at the check already. A replay inside the 5-minute window
  therefore does nothing.
- **A separate `denialdesk_jobs` role** (NOLOGIN, no table privilege) is the only role with EXECUTE on the
  claim and on `integration_enqueue_due_runs(boolean)`. It is reached the way `denialdesk_app` is: `SET LOCAL ROLE`
  from the connection's own login role (`withJobsRole`, `src/db/tenant.ts`), which the migration makes a
  member (`GRANT denialdesk_jobs TO CURRENT_USER`, the same statement 0002 uses for `denialdesk_app`), so
  **no new credential or environment variable** is needed for the database. Everything that touches a
  practice's data still runs as `denialdesk_app` under `withTenantAsSystem`.
- **The functions walk the tenants.** Every integration table is FORCE ROW LEVEL SECURITY, so a definer
  function running as a non-bypass owner sees only the practice named by `app.tenant_id`, and a job knows
  only a run ID. Each function sets `app.tenant_id` (transaction-local) to one practice at a time, asks its
  question under that practice's own policy, and restores the previous value before returning. Row-level
  security stays the enforcement in every environment; no policy, no BYPASSRLS, no table grant. Cost: one
  indexed lookup per practice, fine until the Azure cutover. Tests prove it with a probe owner that neither
  bypasses row-level security nor owns the tables (CI's database user is a superuser, which would hide a bug),
  and it was run once against a real non-superuser owner.
- **Scheduling (PI3), `integration_enqueue_due_runs(p_sandbox_only boolean)`** (0045, replacing 0044's
  zero-argument version) returns `(tenant_id, run_id, outcome)` rows, `outcome` being `queued` (a new scheduled
  run) or `abandoned` (a run quiet past the 20-minute lease, which the database gave up on), so the caller can audit
  what the database did. Due means an active connection with no queued or running run and no run queued in the
  last 14 minutes; a run abandoned before it ever started (a lost job, a deadline) does not count as recent, so the
  next tick queues the connection again at once. The two checks are separate `NOT EXISTS` on the two indexes and
  the stale-run update is split by status, so none is an OR over a scan. The due connections are locked
  `FOR SHARE ... SKIP LOCKED`: a concurrent Pause (which holds the row for update) is skipped until the next tick,
  and once the function holds a connection a Pause waits and then abandons the run that was queued, so a paused
  connection cannot keep a queued run. The partial unique index (one queued or running run per connection) is the
  backstop against overlapping ticks.
- **`p_sandbox_only`.** When true only built-in sandbox connections are due. The app passes
  `SCHEDULED_SANDBOX_ONLY` (`src/domain/integrations/sync.ts`, one constant beside `assertRunEnvironment`), `true`
  until PI4 can apply a real connection's population scope. The engine still refuses every real run
  (`environment_refused` where only synthetic data is allowed, `population_scope_unenforced` otherwise), but
  queueing one each tick would only walk the connection into `error` with a misleading `repeated_failures`. PI4
  flips the constant in the same change that removes the refusal; no migration is needed.
- **The scheduler** (`src/integrations/jobs/scheduler.ts`) posts one signed job per queued run and never runs a
  sync itself (a scheduled function has about 30 seconds; a sync up to 12). It audits, as the integration service
  principal under `withTenantAsSystem`, each abandoned run as `integration.sync_abandoned` (reasons
  `lease_expired`, `job_not_sent`, `deadline`). A run whose job could not be posted is abandoned with
  `UPDATE ... WHERE status = 'queued' RETURNING` (nothing is written if a worker had already claimed it) so its
  connection is not blocked. Run IDs are shuffled before sending, at most 8 are in flight, and after about 25 s
  the runs not yet sent are **abandoned and audited** (`deadline`) rather than left queued: a queued run nobody
  will send blocks its connection for the 20-minute lease, whereas an abandoned one that never started lets the
  next tick queue it again.
- **Sync now** (`requestSync`) queues the run and audits `integration.sync_queued` **in the same transaction as the
  run row**, with the administrator's IP, user agent and session (the job carries only the run ID, so the worker's
  `sync_started` cannot say who pressed the button); then it posts the same signed job and answers "queued". If the
  post fails the run is abandoned with RETURNING and audited `job_not_sent` (with the same IP and user agent) and the
  press is refused; if nothing was abandoned (the worker already claimed it, a post that timed out after the worker
  started) the press counts as queued. Modes (`SyncDeps.jobs`): jobs fully configured, send; a secret that is set
  but too short, **refuse before anything is queued** (no run row, no rate-limit use); anything else missing, run in
  the request only where `syntheticDataOnly()` (tests, local development, pre-production not yet set up) and
  **refuse where real data is allowed** (security review L4), logged once at boot.
- **Three consecutive failed runs -> `error`** (PI3, from the spec, not OA-056): the engine, after finishing a run
  as `failed`, counts the connection's finished runs since it last changed state; if the last three all failed
  (an `abandoned` run neither counts nor rescues, a success ends the streak) the connection moves to `error` with the
  allow-listed reason `repeated_failures`, audited `integration.connection_errored` with the last failure code, and
  the connection page shows a translated notice. A failure that already errors the connection keeps its own reason.
  SIEM alerts stay deferred to the Azure cutover (R-7.5.3).
- **Platform code stays in adapters.** The core is `src/integrations/jobs/` (signature, worker, sender,
  scheduler; no Netlify, no Next.js) plus `src/domain/integrations/job-runs.ts`. The Netlify adapter is
  `src/platform/netlify/` (`job-handlers.ts`, `jobs.ts`) and two thin files, `netlify/functions/
  integration-sync-background.ts` (a Background Function, up to 15 minutes, answers 202 at once) and
  `netlify/functions/integration-sync-scheduler.ts` (a Scheduled Function, `*/15 * * * *`, kept as a literal
  because Netlify reads `config` statically). Azure calls the same `handleSyncJob` and `runScheduledSync` from a
  worker container and a timer.
- **The service principal is re-verified.** 0044 checks that the `users` row seeded by 0043 exists, is disabled, has
  the non-hash password marker and no membership (security review L3); 0045 adds no second-factor secret and the
  reserved `.invalid` address (O8). A failure stops the migration before any privilege is changed.

## Options considered
1. **Run everything in the request (status quo).** Rejected: request limits, no scheduled sync.
2. **Claim as `queued -> running` inside the SECURITY DEFINER function.** Rejected: the engine already claims
   atomically and audits `sync_started` as the service principal; a second state change in a definer function would
   duplicate it. (Runs the scheduler abandons are different: the function reports them and the caller audits each in
   TypeScript as the service principal, so no state change escapes an audit event.)
3. **A policy or BYPASSRLS for the definer's owner instead of walking tenants.** Rejected: a new policy is a wider
   privilege change than a loop, BYPASSRLS needs a superuser to grant and isn't available on every managed
   database, and either would be invisible in CI (superuser). Revisit at the Azure cutover if the per-practice
   walk is ever slow.
4. **Netlify async workloads, a queue service, or a job library.** Rejected: a new dependency and vendor surface
   for one POST; the platform-neutral core makes a queue a later swap of the sender.
5. **A per-job nonce store against replay.** Rejected for now: the 5-minute window plus the single-use claim
   already make a replay a no-op; a nonce table would be a new table with its own RLS and purge. Binding the MAC
   to an audience (a per-deploy string) is possible without a table and is a later option (threat model S7).

## Privilege statements (R-15.9), migrations 0044 and 0045 together
Verbatim, in the order they run (function bodies are in the migration files; nothing else in either migration
changes a privilege, and no table, column, policy or trigger is added or changed):

```sql
-- 0044
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'denialdesk_jobs') THEN CREATE ROLE denialdesk_jobs NOLOGIN; END IF; END $$;
GRANT denialdesk_jobs TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO denialdesk_jobs;
CREATE FUNCTION integration_claim_run(p_run_id uuid) RETURNS TABLE (tenant_id uuid, connection_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$ ... $$;
REVOKE ALL ON FUNCTION integration_claim_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_claim_run(uuid) TO denialdesk_jobs;
CREATE FUNCTION integration_enqueue_due_runs() RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$ ... $$;
REVOKE ALL ON FUNCTION integration_enqueue_due_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_enqueue_due_runs() TO denialdesk_jobs;
-- 0045
DROP FUNCTION integration_enqueue_due_runs();
CREATE FUNCTION integration_enqueue_due_runs(p_sandbox_only boolean) RETURNS TABLE (tenant_id uuid, run_id uuid, outcome text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$ ... $$;
REVOKE ALL ON FUNCTION integration_enqueue_due_runs(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_enqueue_due_runs(boolean) TO denialdesk_jobs;
```

After 0045 the state is: role `denialdesk_jobs` (NOLOGIN, owns nothing, no table privilege, USAGE on `public`), EXECUTE on
`integration_claim_run(uuid)` and `integration_enqueue_due_runs(boolean)` for that role only, neither for PUBLIC nor for
`denialdesk_app`; the zero-argument scheduler function no longer exists. 0044 has already been applied on PR #100's Netlify
preview database branch (see OA-085); 0045 replaces its scheduler function, so 0044 is not edited.

## Consequences
- New privilege surface (R-15.9): one role, two SECURITY DEFINER functions. **The role separation guards against
  application mistakes, not against arbitrary SQL run as the app's login role**: any code on that login can
  `SET ROLE denialdesk_jobs`, `RESET ROLE`, or use the owner's privileges directly, the same trust boundary as
  `denialdesk_app` (threat model T2, S8).
- **At the Azure cutover the function owner is pinned explicitly.** A SECURITY DEFINER function runs with its owner's
  privileges, and here the owner is whichever login ran the migration. In production the migration runs as a named,
  dedicated, non-superuser owner role (`ALTER FUNCTION ... OWNER TO`, reviewed as R-15.9), not as an administrator,
  so a function owner never carries more than the tables it must touch.
- `INTEGRATION_JOB_SECRET` is a new secret (functions-only on Netlify, Key Vault in production), **one per Netlify
  deploy context**: production, and separately deploy previews and branch deploys, because previews run pull-request
  code and must not hold the production secret (threat model S7). Anyone holding it can forge a job, but a job can only
  ask for an existing queued run of an active connection to be executed once.
- Netlify Scheduled Functions run only on the published deploy, not on deploy previews; Sync now works everywhere.
- The site password protection may cover function URLs, `DEPLOY_URL`/`URL` may not exist at function or server
  runtime, and the Netlify plan may not include Background Functions: three things to verify on a preview (runbook,
  OA-086).
- Netlify's function region and Netlify Database's region must be U.S. before the scheduler processes anything
  unattended there (ADR 0003 ⚠️ VERIFY, OA-087).
- The Netlify function bundle includes `next` (through the shared request-context import); a lazy import would
  trim it and is not needed for correctness.
