# ADR 0012: Background execution — signed `{ runId }` jobs, a definer-only claim, a 15-minute scheduler

Status: Proposed (2026-09-29, PI2c builder; needs the owner's R-15.9 sign-off on migration 0044, OA-083).
Builds on ADR 0010 ("Jobs") and ADR 0003 ("background jobs must fit both Netlify and Azure").
Spec `docs/specs/patient-integrations.md` (PI2b Jobs, PI3); threat model `docs/threat-models/patient-integrations.md` (S5).

## Context
PI2b part 1 built the sync engine (`executeSyncRun`) and ran it inside the administrator's request. A large
practice can need up to the 12-minute run budget, the platform can kill a request, and PI3 needs a sync every
15 minutes (OA-056) with nobody signed in. Work has to run with no user session, start only when something
legitimate asked for it, and stay portable: Netlify (pre-production, synthetic data only) now, an Azure worker
later (ADR 0002, 0003).

## Decision
- **A job is a signed POST of `{ "runId": "<uuid>" }`, nothing else.** Two headers: a Unix timestamp and
  `v1=` + HMAC-SHA256 over `<timestamp>.<body>`, keyed by `INTEGRATION_JOB_SECRET` (at least 32 bytes). The
  receiver accepts a timestamp within 5 minutes either way, compares the MAC with `timingSafeEqual`, parses
  the body only afterwards, and refuses any payload that is not exactly `{ runId }` (`z.strictObject`). The
  tenant is never in the job: it comes from the database.
- **The claim is a definer-only check.** SECURITY DEFINER `integration_claim_run(run_id)` returns
  `(tenant_id, connection_id)` only for a `queued` run of an `active` connection. It is read-only: the atomic
  `queued -> running` move, and its audit event, stay in the engine's own claim (`claimRun` locks the run
  row and refuses anything not queued), so of two workers holding one job exactly one runs it, and a running
  or finished run is refused at the check already. A replay inside the 5-minute window therefore does nothing.
- **A separate `denialdesk_jobs` role** (NOLOGIN, no table privilege) is the only role with EXECUTE on the
  claim and on `integration_enqueue_due_runs()`. It is reached the way `denialdesk_app` is: `SET LOCAL ROLE`
  from the connection's own login role (`withJobsRole`, `src/db/tenant.ts`), which the migration makes a
  member (`GRANT denialdesk_jobs TO CURRENT_USER`, the same statement 0002 uses for `denialdesk_app`), so
  **no new credential or environment variable** is needed for the database. Everything that touches a
  practice's data still runs as `denialdesk_app` under `withTenantAsSystem`.
- **The functions walk the tenants.** Every integration table is FORCE ROW LEVEL SECURITY, so a definer
  function running as a non-bypass owner sees only the practice named by `app.tenant_id`, and a job knows
  only a run ID. Each function sets `app.tenant_id` (transaction-local) to one practice at a time, asks its
  question under that practice's own policy, and restores the previous value before returning. Row-level
  security stays the enforcement in every environment; no policy, no BYPASSRLS, no table grant. Cost: one
  indexed lookup per practice, fine until the Azure cutover. A test proves it with a probe owner that neither
  bypasses row-level security nor owns the tables (CI's database user is a superuser, which would hide a bug).
- **Scheduling (PI3).** `integration_enqueue_due_runs()` first abandons runs that went quiet for the 20-minute
  lease (so a lost job is retried by the next tick), then inserts one `scheduled` run per active connection
  with no queued or running run and none queued in the last 14 minutes, and returns run IDs only. The partial
  unique index (one queued or running run per connection) is the backstop against overlapping ticks. The
  scheduler posts one signed job per run ID and never runs anything itself (a scheduled function has about 30
  seconds; a sync up to 12 minutes).
- **Sync now** queues the run, then posts the same signed job, and answers "queued" at once
  (`requestSync`). The job carries only the run ID, so the press is audited at queue time as
  `integration.sync_queued` with the administrator's IP, user agent and session, which the worker's
  `integration.sync_started` can no longer say. If the worker can't be reached the run is abandoned at once and
  the press is refused. **Inline vs job:** with `INTEGRATION_JOB_SECRET` unset (tests, local development, a
  Netlify site that has not been configured yet) Sync now runs in the request exactly as before; set and
  valid, with a worker URL, it queues a job; set but too short, it refuses. The worker and the scheduler always
  refuse when the secret is missing or short.
- **Three consecutive failed runs -> `error`** (PI3): the engine, after finishing a run as `failed`, counts the
  connection's finished runs since it last changed state; if the last three all failed (an `abandoned` run
  neither counts nor rescues, a success ends the streak) the connection moves to `error` with the allow-listed
  reason `repeated_failures`, audited `integration.connection_errored` as the service principal. A failure
  that already errors the connection (a refused credential, a changed token endpoint) keeps its own reason.
  SIEM alerts stay deferred to the Azure cutover (R-7.5.3).
- **Platform code stays in adapters.** The core is `src/integrations/jobs/` (signature, worker, sender,
  scheduler; no Netlify, no Next.js) plus `src/domain/integrations/job-runs.ts`. The Netlify adapter is
  `src/platform/netlify/` (`job-handlers.ts`, `jobs.ts`) and two thin files, `netlify/functions/
  integration-sync-background.ts` (a Background Function, up to 15 minutes, answers 202 at once) and
  `netlify/functions/integration-sync-scheduler.ts` (a Scheduled Function, `*/15 * * * *`, kept as a literal
  because Netlify reads `config` statically). Azure calls the same `handleSyncJob` and `runScheduledSync` from a
  worker container and a timer.
- **Real connections stay fail-closed.** The claim accepts any active connection; the engine refuses a real one
  (`environment_refused` where only synthetic data is allowed, `population_scope_unenforced` otherwise, PI4)
  before any transport is asked for. The scheduler therefore queues runs for real active connections too; each
  fails at once, and the third failure moves it to `error` (self-limiting). Only sandbox connections can run in
  pre-production.

## Options considered
1. **Run everything in the request (status quo).** Rejected: request limits, no scheduled sync.
2. **Claim as `queued -> running` inside the SECURITY DEFINER function.** Rejected: the engine already claims and
   audits atomically as the service principal; a second state change in a definer function would duplicate it and
   bypass the audit event.
3. **A policy or BYPASSRLS for the definer's owner instead of walking tenants.** Rejected: a new policy is a wider
   privilege change than a loop, BYPASSRLS needs a superuser to grant and isn't available on every managed
   database, and either would be invisible in CI (superuser). Revisit at the Azure cutover if the per-practice
   walk is ever slow.
4. **Netlify async workloads, a queue service, or a job library.** Rejected: a new dependency and vendor surface
   for one POST; the platform-neutral core makes a queue a later swap of the sender.
5. **A per-job nonce store against replay.** Rejected for now: the 5-minute window plus the single-use claim
   already make a replay a no-op; a nonce table would be a new table with its own RLS and purge.

## Consequences
- New privilege surface (R-15.9): one role, two SECURITY DEFINER functions, six GRANT/REVOKE statements. A caller
  that can `SET ROLE denialdesk_jobs` (any code on the connection's login role) can run both functions, the same
  trust boundary as `denialdesk_app` (threat model T2): the role separation protects against application mistakes,
  not against arbitrary SQL on the login role.
- `INTEGRATION_JOB_SECRET` is a new secret (functions-only on Netlify, Key Vault in production). Anyone holding it
  can forge a job, but a job can only ask for an existing queued run of an active connection to be executed once.
- Netlify Scheduled Functions run only on the published deploy, not on deploy previews; Sync now works everywhere.
- The site password protection may cover function URLs (OA-084); the fix would be an exemption or a header.
- The Netlify function bundle includes `next` (through the shared request-context import); a lazy import would
  trim it and is not needed for correctness.
- One audit event per patient on initial load remains the cost of the engine, unchanged.
