# Project state — shared memory

Read this at the start of every session, after `CLAUDE.md`. Update it at the end of every session
that changes decisions, status, or open questions. Keep it short: facts and links, not narrative.

_Last updated: 2026-09-29_

## Where we are
- Home page revamp (`specs/welcome-page.md`, owner request 2026-09-27): header band with a live strip
  of practice denial totals (`queueSummary`, aggregates only, no audit; owner to confirm, OA-058), the two step flows as a
  connected pipeline (`src/components/home/FlowSteps.tsx`), and "Your modules" as a card grid with
  page links. Within DESIGN.md §3 (no gradients, hairline panels, hover-only motion ≤ 150ms).
- **Patient integrations — Patient Register synced from the EHR/PM** (`specs/patient-integrations.md`,
  ADR 0010 Proposed, `threat-models/patient-integrations.md`; owner request 2026-09-27: "sync data,
  not hold any of the data … a drop-down in the nav bar beside the table … connect to this table
  only … follow medical integration practices"). Owner chose a **synced read-only copy**: the
  practice's EHR/PM is the system of record; DenialDesk keeps an encrypted, read-only copy of the
  billing minimum (MRN, name, birth date, sex, address, primary coverage), refreshed by sync. First
  and only connector: **HL7 FHIR R4 / US Core 6.1.0** over **SMART Backend Services**
  (`private_key_jwt`, system scopes; signing key in the platform key store, never the DB). A
  data-source drop-down sits beside the Patients tab (a `dataSource` slot on the nav item so other
  tables can opt in later; other tables are the owner's to evaluate). Synced demographics are
  refused for manual edit (domain + DB trigger); sensitivity tags and custom fields stay
  practice-owned. Linking to an existing manual patient needs MRN **and** birth date equal.
  Pre-production uses an in-process synthetic FHIR sandbox only. Revised 2026-09-28 after security
  and compliance review of the design (1 Critical, 5 High, 4 blocking): a real connection goes live
  only after **platform-operator approval** (`pending_approval`), a global registry stops two
  practices using the same EHR registration, per-connection signing keys by default (OA-057);
  signed `{runId}`-only jobs running under `withTenantAsSystem` with a fixed integration service
  principal as audit actor; deny-by-default SSRF guard; real endpoints refused on Netlify whatever
  `APP_ENV` says; endpoints immutable once data is synced; SSN/MBI identifier systems refused as MRN;
  practice-scoped population only in production; EHR sensitivity labels mark a patient restricted.
  Phases: PI0 docs (done), **PI1a data layer (done, `drizzle/0039_patient_integrations_data_layer.sql`:
  patients provenance + read-only trigger, `integration_connections` lifecycle/editability trigger,
  the endpoint registry with SECURITY DEFINER claim/release, sync runs/issues, payer mappings;
  `canManageIntegrations`; domain refusals in `src/domain/patients/queries.ts`; revised 2026-09-28
  after correctness/security/compliance review — sandbox self-activation and approval-presence CHECK
  constraints, endpoint-field-set locked to `draft` only, self-approval-freshness enforcement,
  registry claim requires a discovered token endpoint + `FOR UPDATE`, `search_path` hardened to
  `pg_catalog, public, pg_temp` with `pg_temp` last and `REVOKE ALL FROM PUBLIC` before granting the
  two registry functions, a partial unique index caps one queued/running run per connection and one
  non-draft/revoked connection per tenant, `purge_demo_practices()` extended for the five new tables,
  `updatePatientSensitivityTags` now takes `actor.canTag`, and `src/lib/log.ts` drops non-UUID
  `*Id`-shaped fields and denylists raw identifier keys — see `docs/specs/patient-integrations.md`
  PI1a for the full list; R-15.9 human sign-off on the privilege (REVOKE/GRANT/column-grant)
  statements is still needed before this migration runs anywhere but a local/test database)**, PI1b
  Settings › Integrations + drop-down (split 2026-09-28: **PI1b-1 domain done** —
  `src/domain/integrations/connections.ts` create/edit/revoke with a strict allow-list, URL and
  MRN-identifier-system rules in `src/integrations/fhir/`, environment rule at save; **PI1b-2 Settings pages done** (list for every role, admin-only new/detail
  pages, inline-confirmed revoke with offboarding steps, `docs/runbooks/integration-offboarding.md`),
  **PI1b-3 drop-down done** (`DataSourceMenu` beside the Patients tab: Source: Manual / <name> ·
  state, every role; admin link to connect or manage; sync actions join in PI2a/PI2b);
  Submit/attestation/MFA step-up/pause-resume moved to PI2a, where Test
  connection first makes Submit possible; PI1c operator approval now follows PI2a, since it needs
  submitted connections), PI2a transport/discovery/keys/test connection + Submit, PI1c operator approval,
  PI2b sync engine + sandbox + jobs + history + payer mapping (includes `withTenantAsSystem`,
  `denialdesk_jobs`, the integration service principal — deferred from PI1a per the spec's own phase
  split), PI3 scheduled sync + source-state hardening, PI4 Bulk Data before the first real practice.
  **PI2a part 1 done** (`src/integrations/fhir/transport.ts`, `address-guard.ts`, `limits.ts`):
  `HttpsTransport` (explicit TLS ≥ 1.2, no env proxies, no redirects, content-type allow-list,
  10 MB/30 s caps), the deny-by-default SSRF address guard (IANA special-purpose ranges + embedded
  IPv4 decode, checked on every resolved address at connect), and the run/bundle/paging limit helpers (wired into the sync loop in PI2b).
  **PI2a part 2 done for pre-production** (PR #87, branch `pi2a-discovery`, no migration, no grant;
  coordinator decisions 2026-09-28): transport N3 resolved (a non-2xx resolves with its status and the body is
  discarded unread), discovery, the SMART token request (`auth.ts`, `src/lib/crypto/jwt-sign.ts`,
  redacting `AccessToken`), keys from one shared pre-production secret (`EnvSharedKeyStore`,
  `INTEGRATION_SIGNING_KEY`, OA-064; a **pre-production exception, production control deferred** relative to R-7.3.4/R-7.3.5; production refuses it at use and at boot; register it only with synthetic-data vendor sandboxes, never a live practice EHR; Key Vault stub fails closed), the public
  `/.well-known/jwks.json` route (allow-list, `jwks` bucket), and Test connection (domain service,
  admin action, button on the connection page; result from the audit log via `hasRecentPassingTest`,
  Submit's gate: the newest test for the connection must be a pass within 24 h, bound to the current base URL, client ID, token endpoint, token endpoint key, issuer, and signing `kid`; coordinator decision pending owner confirmation, OA-065). **Open for the Azure cutover (R-15.9
  sign-off):** per-connection Key Vault keys, the grant on `key_mode`/`key_ref`, SECURITY DEFINER
  `integration_jwks_lookup`, `/.well-known/jwks/<uuid>.json`, key rotation and compromise runbooks.
  **PI2a Submit slice done** (PR #88, branch `claude/vigilant-tesla-ps41e9-pi2a-submit`, no migration,
  no GRANT; review fixes in the same PR: Resume from `error` needs a pass newer than the error, the
  signing `kid` comes from public material before any transaction, a per-practice Submit rate limit,
  one live connection per practice refused in words, the displayed language checked against the
  request's, and a SHA-256 of the attestation text in the audit event; the **Spanish and Portuguese
  attestation is agent-written and unreviewed, native-speaker and counsel review is OA-041**): Submit
  (`submitConnection`: admin, row lock, step-up, the passing-test gate with the live signing `kid`,
  the U.S.-residency attestation for a real connection, one UPDATE with fresh `submitted_*` and
  `us_residency_attested_*` stamps, then the registry claim; a conflict rolls back, refuses with "This
  endpoint and client ID are already connected", and audits `integration.registry_conflict`), the
  Submit panel and "Awaiting DenialDesk approval" on the connection page (en/es/pt), and Resume from
  `error` requiring a passing Test connection (paused still doesn't). The passing test is required for
  the sandbox too (only the attestation is real-only), so sandbox Submit is domain-tested with a seeded
  pass and unreachable from the page until PI2b (and a sandbox in `error` can't be resumed until PI2b
  gives it a test path). **Open owner decisions from this slice:** OA-045 (N3 stamp time floor, N6
  attestation wording scope), OA-065 (c). **PI1c operator approval done except the activation notice and the conflict alert (open items)** (branch `claude/vigilant-tesla-ps41e9-pi1c-approval`, PR #89; no migration and no GRANT: writes go through `withTenantAsPlatform`, the connection owner's path; `src/domain/integrations/approval.ts`; queue `/operator/integrations`, review page under the practice; Approve records the method code, date, contact role, optional 9-digit MRNs and the required client-ID-ownership confirmation, and is refused for a scope other than `group_export`, in a synthetic-only environment, before the submission date, without a BAA in force, and for a non-operator account (`isOperatorAccount`); Reject takes a fixed reason code and releases the registry claim; audited `operator.integration_approved|rejected` with `session_id`, and views audited `operator.integration_viewed`). **Open from PI1c** (unticked spec items, owner rows OA-066 to OA-073): the activation notice to practice administrators (no in-app notice mechanism exists), the operator alert on `integration.registry_conflict` (R-15.9 owner sign-off), operator step-up before Approve, operator-side revoke, capturing a verified filter as a structured value. **PI2b UI slice done** (branch `claude/vigilant-tesla-ps41e9-pi2b-ui`, no migration, no GRANT): payer mapping `/settings/integrations/[id]/payers` (administrators; saving needs a step-up; each changed mapping audited `integration.payer_mapping_changed` with IDs and counts only, viewing audited `integration.payer_mappings_viewed`) and sync history `/settings/integrations/[id]/runs` (counts and codes; issue rows link to DenialDesk patient IDs; no PHI), plus the PR #89 follow-ups N1 to N7. **Open, for the sync-engine slice:** applying a saved mapping to the patients that carry the key (a synced patient's payer and coverage are read-only outside a running run, so the sync must re-derive coverage for a patient whose mapping is newer than its `synced_at`, even at an unchanged `versionId`); spec PI2b. **Next: PI2b part 2** (jobs); the engine and sandbox are below. (PI1b-1 is #82 and PI1b-2 is #84; #81 was closed as superseded.) PR #83 review fixes: IP-literal hosts now pass the address guard, truncated compressed responses reject, IPv6 limited to `2000::/3` minus special-purpose ranges, test key generated at test time, spec ticks split (run-level limits stay open for PI2b), test-only transport options need a positive test signal (`VITEST`/`NODE_ENV=test`).
  **PI2a lifecycle + step-up slice done** (PR #86, ported from closed #81 onto the
  #82/#84/#85 domain layer; Submit, the residency attestation, and the Submit registry claim wait on
  Test connection, PI2a-2): step-up MFA (R-7.2.2) — migration 0041 `sessions.mfa_verified_at`,
  `hasRecentMfa` (5 min, `src/auth/step-up.ts`), `/step-up` via `stepUpTarget`, token rotation,
  `auth.step_up_verified|failed`, and the shared `requireStepUp` gate Submit will call; admin-only,
  audited, tenant-scoped, environment-checked Pause, Resume (step-up), and Withdraw (releases the
  registry claim) wired into the connection page; Revoke takes a reason code (audit "why"); the
  `endpoint_key`/`token_endpoint_key` CHECKs (0041). Compliance follow-up: Withdraw clears the residency attestation, and migration 0042 makes Submit (`draft → pending_approval`) require fresh attestation and submission stamps. No GRANT or privilege change (`sessions` is
  owner-only; the CHECKs add no privilege). Owner decisions and the TOTP-vs-WebAuthn gap: `OA-063`.
  Owner questions OA-045 onward; data source DS-12 in `docs/data-sources.xlsx`.
  **PI2b part 1 done: sync engine and synthetic sandbox** (branch `claude/vigilant-tesla-ps41e9-pi2b-engine`,
  after #91 merged the payer-mapping page, sync history and `sync-codes.ts`; migration
  `0043_patient_integrations_sync_engine.sql`, its identity seed **approved by the owner 2026-09-29 (R-15.9, OA-076, resolved)**;
  no GRANT, REVOKE, role, SECURITY DEFINER or RLS change). What it is: `withTenantAsSystem` (the
  `denialdesk_app` role, the fixed integration service principal as actor, transaction-local run settings);
  the in-process `SandboxTransport` (125 deterministic synthetic patients, verifies the SMART assertion;
  Test connection, Submit and Sync now work for the sandbox); the sync run (`src/domain/integrations/sync.ts`,
  `sync-upsert.ts`, `sync-runs.ts`, `src/integrations/fhir/search.ts`, `map-patient.ts`, `map-coverage.ts`):
  issuer check first, paged `_lastUpdated` search with same-origin `next`, paging-loop guard, run budget and
  bundle cap, Coverage by POST, retries with backoff, 401/403/`invalid_client` and a changed token endpoint
  set `error`, SSN/MBI-shaped MRNs refused, upsert/link/conflict with no regression, member IDs
  field-encrypted, page-by-page commits with a re-check that the connection is still active, watermark on
  success only, every patient write audited as the service principal (reason `ehr_sync`), and a
  **re-derive pass that applies a saved payer mapping to patients whose payer mapping is newer than their
  `synced_at`** even at an unchanged `versionId`. Codes are a fixed allow-list (`sync-codes.ts`, documented
  in the spec; a minor is the neutral `review_required`). "Sync now" is an admin action that runs in the
  request (jobs are PI2c, below). **Fails closed on real connections (PR #98 review):** any connection that is not
  the synthetic sandbox is refused, in the run and in Sync now, with the code `population_scope_unenforced`, until PI4
  can apply `population_scope` (see "PI4 blocker" under Deferred review findings). **Not built:** Coverage-only
  search and `_elements`, PI4 (background jobs, the scheduler and the three-failure rule are PI2c, below). Owner:
  OA-077 to OA-082 (OA-076 is resolved).
  **PI2c done: signed background jobs and the 15-minute scheduled sync** (PR #100, branch `claude/vigilant-tesla-ps41e9-pi2c-jobs`,
  from `claude/quirky-feynman-ufql5a`; migrations `drizzle/0044_patient_integrations_jobs.sql` and, after the review round,
  `0045_patient_integrations_jobs_review.sql` (0044 had already run on the PR's Netlify preview database branch, so it
  is not edited); ADR 0012 Proposed; **R-15.9 owner sign-off required for 0044 and 0045 together before they run anywhere
  but a local or test database, OA-085**). Spec items ticked: PI2b "Jobs", PI3 "Scheduled every 15 minutes", PI3 "Three
  consecutive failed runs -> error" (SIEM alerts stay deferred to the Azure cutover). What it is: a job is a signed POST
  of `{ runId }` (HMAC-SHA256 over timestamp + body, 5-minute window, constant-time compare, body read with a 1,024-byte
  cap while streaming, `INTEGRATION_JOB_SECRET` of at least 32 bytes, refused when missing or short) handled by a
  platform-neutral worker (`src/integrations/jobs/`) that claims the run through `integration_claim_run(run_id)`
  (read-only: a `queued` run of an `active` connection, returns tenant and connection) and runs the existing
  `executeSyncRun` under `withTenantAsSystem`; `integration_enqueue_due_runs(p_sandbox_only)` queues a `scheduled` run per
  due active connection (sandbox connections only until PI4, `SCHEDULED_SANDBOX_ONLY`) and returns `(tenant_id, run_id,
  outcome)` so the scheduler can audit runs the database abandoned (`integration.sync_abandoned`, `lease_expired`),
  abandon and audit a run whose job can't be posted (`job_not_sent`) or that it ran out of time for (`deadline`);
  Sync now (`requestSync`) audits `integration.sync_queued` in the run's own transaction and posts the same signed job
  when `INTEGRATION_JOB_SECRET` and a worker URL are set, refuses before queueing when the secret is too short, and
  otherwise runs in the request only where `syntheticDataOnly()` (where real data is allowed it refuses, logged once at
  boot); Netlify adapter = `src/platform/netlify/` plus `netlify/functions/integration-sync-background.ts` (Background
  Function) and `integration-sync-scheduler.ts` (Scheduled Function, `*/15 * * * *`, published deploy only); three finished
  runs in a row failed move the connection to `error` with the allow-listed reason `repeated_failures` (audited with the
  last failure code; the connection page shows a translated notice). L3 and O8: 0044 and 0045 begin by verifying the
  service-principal row seeded by 0043 (exists, disabled, password_hash '!', no membership; 0045 also no second-factor
  secret and the reserved `.invalid` address) and raise otherwise; 0043 is not edited. The real-connection guard is kept.
  **Privilege statements in 0044 + 0045 (R-15.9), final list, verbatim** (function bodies are in the migration files):
  - 0044: `CREATE ROLE denialdesk_jobs NOLOGIN;` (inside `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'denialdesk_jobs') THEN ... END IF; END $$;`)
  - 0044: `GRANT denialdesk_jobs TO CURRENT_USER;`
  - 0044: `GRANT USAGE ON SCHEMA public TO denialdesk_jobs;`
  - 0044: `CREATE FUNCTION integration_claim_run(p_run_id uuid) RETURNS TABLE (tenant_id uuid, connection_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$ ... $$;`
  - 0044: `REVOKE ALL ON FUNCTION integration_claim_run(uuid) FROM PUBLIC;`
  - 0044: `GRANT EXECUTE ON FUNCTION integration_claim_run(uuid) TO denialdesk_jobs;`
  - 0044: `CREATE FUNCTION integration_enqueue_due_runs() RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$ ... $$;` (replaced by 0045)
  - 0044: `REVOKE ALL ON FUNCTION integration_enqueue_due_runs() FROM PUBLIC;` (function dropped by 0045)
  - 0044: `GRANT EXECUTE ON FUNCTION integration_enqueue_due_runs() TO denialdesk_jobs;` (function dropped by 0045)
  - 0045: `DROP FUNCTION integration_enqueue_due_runs();`
  - 0045: `CREATE FUNCTION integration_enqueue_due_runs(p_sandbox_only boolean) RETURNS TABLE (tenant_id uuid, run_id uuid, outcome text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$ ... $$;`
  - 0045: `REVOKE ALL ON FUNCTION integration_enqueue_due_runs(boolean) FROM PUBLIC;`
  - 0045: `GRANT EXECUTE ON FUNCTION integration_enqueue_due_runs(boolean) TO denialdesk_jobs;`
  No table, column, policy or trigger changes; `denialdesk_app` gains nothing. Both functions walk the practices
  (`app.tenant_id` set per practice and restored) because every integration table is FORCE ROW LEVEL SECURITY; a probe
  owner test proves it for an owner that doesn't bypass it. **No new database credential:** `withJobsRole` uses
  `SET LOCAL ROLE denialdesk_jobs` from the same login, which `GRANT denialdesk_jobs TO CURRENT_USER` makes a member,
  as 0002 does for `denialdesk_app`. **Owner actions:** OA-085 (this sign-off, and confirm that preview database branches
  count as test databases for R-15.9; ⚠️ VERIFY that roles created on a Netlify Database preview branch don't reach the
  shared pre-production database), OA-086 (set `INTEGRATION_JOB_SECRET` per deploy context as a functions-only Netlify
  secret, confirm the plan supports Background Functions, and that site password protection doesn't block the worker's
  function URL; until it is set Sync now keeps running in the request and the worker and scheduler refuse), OA-087
  (confirm the Netlify functions and Netlify Database regions are U.S.; the scheduler now processes data unattended there).
  Not verifiable outside Netlify: the function bundle was checked with esbuild and smoke-run against a stub, not
  deployed; whether `DEPLOY_URL`/`URL` exist at runtime is on the runbook's verify list.
  **Local development databases:** a database created before 0043 that holds a sandbox connection with
  `issuer = 'sandbox-client'` (0040's pin) cannot take 0043, whose replacement sandbox CHECK does not validate that
  row. Reset it: `docker compose down -v` (drops the `db-data` volume), `docker compose up -d db`, `pnpm db:migrate`,
  `pnpm db:seed`. (Only a row written by hand or by an older test seed can carry that issuer; a passing Test connection never wrote it.)
- Record pattern P1 (`specs/record-pages.md`, owner request 2026-09-27 "modernize the Patient
  pages … create the staple to edit other tables"): reusable parts in `src/components/records/`
  (`RecordHeader`, `RecordLayout`, `FieldList`, `FormShell`) and `src/components/ui/`
  (`Breadcrumbs`, `SelectField`, `TextareaField`, `TableToolbar`, `SearchInput`), first applied to
  all four Patient screens (list with toolbar/count/age/location/coverage, chart with header meta
  strip and Record panel, sectioned register/edit forms). `ageOn()` pure helper with boundary tests;
  `PageEyebrow` takes a `page` override and no longer prints "Patients · Patients" on form pages.
  P3 done 2026-09-28 (Appeals, Remittances, Prompt pay, Settings › Custom fields, Operator ›
  Practices forms on `FormShell`). P2 done 2026-09-28 (Claims and Denials record pages onto
  `RecordHeader`/`RecordLayout`/`FieldList`; claim correction and denial assign/status controls
  moved to the header action and main-column panels respectively). **P1–P4 done** (P4, 2026-09-28:
  `DataTable` gained sortable column headers — `SortableHeader`, a plain link that sets
  `?sort=<key>&dir=asc|desc` with `aria-sort` on the `th` and a visually-hidden direction hint —
  allow-listed per list with a stable `id` tie-break, applied to Claims, Denials (whose queue also
  regained its "Notice date" column, sortable, restoring the pre-P4 "sort by notice" criterion), and
  Appeals, Patients, and Payers. Server-side sort, no new dependency; ADR 0004 addendum. `density`
  (a `Table` prop, a CSS custom property, no new React context) is available on `DataTable` but not
  yet turned on for any list — a later change, not part of P4. P4 review follow-ups done 2026-09-28
  (deterministic tie-break tests, patient-name sort test, names read only for the unsubmitted
  `patientName` sort, "Filing deadline" hint says "default order"). Open (owner): which column replaces
  Sex on the list.
- Internationalization (`specs/internationalization.md`, ADR 0009, R-11.1): the whole product (practice
  app, sign-in, operator console, Insight .xlsx export) reads in English, Spanish, or Portuguese. Own
  module in `src/i18n/` (no dependency): typed dictionaries per namespace in
  `src/i18n/messages/{en,es,pt}/`, `getT`/`getFormat` on the server, `useT`/`useFormat` in client
  components, ICU-subset messages (`{param}`, plurals, `<b>` tags). The user menu has a language group
  (English / Español / Português; current one marked); the operator header has the same picker. Choice
  lives in the `dd_locale` cookie and `users.locale` (migration 0035), applied at sign-in;
  `Accept-Language` before any choice. Dates and counts follow the language; money stays `$1,234.56`.
  Domain label maps hold message keys (`labelKey`), domain errors carry `key`/`params` beside an
  English `message`. Rule: no English literal in JSX or user-facing strings (`CLAUDE.md`,
  `src/i18n/README.md`). Open: OA-040 practice-wide default language, OA-041 native-speaker
  terminology review + counsel sign-off, OA-042 translate University content (UI is translated). Not translated by design: codes and their sourced summaries, statutes, payer
  names, user data, GL memos stored in ledger rows, the CSV header contract, audit/log identifiers.
  Reviewed 2026-09-27 by `reviewer`, `security-reviewer`, `compliance-checker`: no blocking findings
  open after fixes (own-row/MFA-gated preference write, capped claim lists in error messages, English
  CSV headers quoted in import errors, date-only "Created" columns, CSV/835 diagnostics translated or
  wrapped). Deferred: per-route dictionary splitting, `passwordProblem()` codes, more `=0` plurals.
- DenialDesk University U1 (`specs/denialdesk-university.md`, owner request 2026-09-27): in-app
  courses at `/university`, reached from the "University of DenialDesk" logo button in the global
  header and on the welcome page, and a "DenialDesk University" item in the user menu (not a module
  in the switcher). Five courses (getting started,
  reading a denial, Florida prompt pay, appeals and deadlines, protecting patient data) authored in
  `src/domain/university/catalog.ts` as typed blocks; every legal value is a `rules` block resolved
  from `rules/catalog.ts` at render time with its citation and "Pending counsel verification" badge
  (a unit test rejects statutory numbers typed in prose), CARC meanings come from
  `src/domain/carc.ts`. Per-user completions in `university_progress` (migration 0033; RLS; app role
  SELECT/INSERT only, append-only; member FK; migration 0034 adds the table to the demo purge)
  audited as `university.lesson_completed`. Access is sold per practice (owner decision 2026-09-27):
  courses are locked until the platform operator records the purchase on the practice page
  (`university_access`, migration 0037; `withTenantAsPlatform` for operator writes, owner privileges with the tenant policy as defense in depth only; migration 0038 hides operator-only columns from practice sessions). While locked,
  every visit to the catalog opens the access prompt (program length from the catalog, "Access
  starts at $299.00", `src/domain/university/offer.ts`); "Request access" is recorded on the
  practice row and shown to the operator. The Wiki is not gated. Pricing terms and a payment
  channel are still OA-044. Rules a lesson lists but the product does not compute
  yet (acknowledgment, secondary filing, Medicare levels 2–5) are tagged "Reference only". Next: U2
  knowledge checks, U3 practice training record/export (OA-035), U4 more courses.
- University — Wiki (`specs/university-wiki.md`, 2026-09-27): a second University page at
  `/university/wiki`, linked from the course catalog ("Open the Wiki") and linking back; same
  "DenialDesk University" header, not a switcher module (U1 decision kept). Twelve reference articles
  (getting started, denials and appeals, claims and payments, Florida and Medicare rules, data
  safety, glossary) authored as TypeScript modules in `src/domain/university/wiki/articles/` in a
  small Markdown subset rendered to React (no raw HTML). **No legal value is typed into an article:**
  `{{rule:<id>}}` tokens render the rule version in force today from `rules/` with its citation and
  an "unconfirmed" marker while `verify` is set; unit tests fail on a typed "N days/months/%", an
  unknown rule ID, a dead internal link, or an SSN/MBI/phone/e-mail-shaped string. Search is a POST
  action (no query in URLs). Every role can read it; nothing is audited (public product
  documentation, no PHI). Further University structure is the owner's (OA-036). The owner's
  "DenialDesk Wiki" wordmark (background removed, `public/brand/denialdesk-wiki.png`; license and
  generating tool ⚠️ VERIFY, OA-037) is the Wiki button in the global header and on the welcome
  page; the user-menu name is truncated so the header still fits 1024px.
- Appeals A1 (`specs/appeals.md`): `appeals` + `appeal_notes` tables (tenant RLS, isolation test,
  a DB trigger enforcing the status lifecycle draft → in_review → ready → submitted →
  awaiting_decision → decided, with withdrawn/dismissed reachable from submitted/awaiting_decision).
  `/appeals` work list (level/payer/status filters, deadline/amount sort, totals row); "Start
  appeal" on the denial detail page opens `/appeals/new?denialId=<id>` (own create page, deadline
  computed fresh from the rules engine, never guessed); `/appeals/[id]` records the submission
  (method, date, tracking ref) and the decision (outcome, date, recovered amount, close reason),
  syncing the linked denial's status. "Appeals" is now a live item in the Denials module switcher.
  A practice-configurable appeal follow-up-day default lives in a new small `practice_settings`
  key/value table (no admin UI yet to edit it in A1 — it always reads the built-in 30-day default
  until one is set directly in the table). Next: A2 letter templates, A3 escalation/Medicare
  5-level ladder, A4 overturn-rate analytics, A5 attachment storage. Open questions from the spec
  (late-filing blocking, appeal version history, withdrawn/dismissed → denial status mapping,
  amount-in-controversy source) are added to `docs/owner/OWNER_ACTION_ITEMS.xlsx`.
- Remittances and prompt pay R1/PP1 (`specs/remittances-and-prompt-pay.md`): 835 upload (parser in
  `src/edi/x12/`), `/remittances` table and record page with balance check, post (claim version +
  prompt-pay response per claim) and void with reason; `/prompt-pay` table and clock record page
  (milestones, interest worksheet, contests with "recorded in error"); claim page Payments panel.
  Migration 0026: append-only history enforced by triggers, RLS + isolation tests. Seed now posts
  synthetic remittances. External data sources to connect are tracked in `docs/data-sources.xlsx`.
  R2 (reversals, denial capture from posted adjustments, event-row guard; migration 0028) done;
  CARC mapping is ⚠️ VERIFY (OA-021). Next: R2b line-level + deposit reassociation, PP2 alerts, R3 feed.
  Open (counsel): interest accrual start; paper provider-response window.
- Welcome page (`specs/welcome-page.md`) now explains how the patient record feeds claims and
  denials (4 steps; charge import and 837P/835 marked Planned) and lists more safeguards (MFA,
  field encryption, BAA on file). Wording passed `compliance-checker`; owner sign-off on copy pending.
- Settings (`specs/settings-and-custom-fields.md`): the "Setup" module is now **Settings**, with
  section tabs (General, Custom fields, Payers; Users and roles, Security, Notifications,
  Integrations planned). The `/design` style-guide page was removed 2026-09-26 (owner request). Administrators define custom fields on patients,
  claims, denials, and payers (`custom_fields`, migration 0023, RLS + isolation test, audited).
  S2 values: PR 1 (crypto AAD, `custom_field_values` + `custom_field_value_versions` tables,
  migration 0027, domain `src/domain/custom-fields/values.ts`) done and merged. PR 2 (patients UI)
  done: `PatientForm` renders and stores active fields (`cf.<fieldId>` inputs, saved in the same
  transaction as the patient create/update, so the patient's `expectedUpdatedAt` check covers the
  values too); the patient detail page shows them read-only, masked ones behind an "Open" + reason
  dialog (`revealCustomField`, same roles as the member ID reveal); a new `show_in_list` column
  (migration 0036, checked `NOT (show_in_list AND sensitivity IS NOT NULL)`) lets an administrator
  add a non-sensitive field as a list column (capped at 5, `MAX_LIST_COLUMNS`), loaded by its own
  module `src/domain/custom-fields/list-values.ts` (never sensitive/hidden fields, one query per
  page) and rendered by `PatientTable`. Shared UI in `src/components/custom-fields/` for reuse by
  claims/denials/payers. PR 3 (claims and denials) done: `recordIsSensitive` and the list-values
  masking join now also follow claim -> patient and denial -> claim -> patient, so a claim or denial
  belonging to a sensitivity-tagged patient is masked and excluded from list columns the same as a
  patient itself (I7); `/claims/[id]` and `/denials/[id]` show a "Custom fields" panel
  (`CustomFieldValues`, masked reveal via `revealClaimCustomField`/`revealDenialCustomField`, same
  roles as the member ID reveal); `/claims/[id]/fields` and `/denials/[id]/fields` are their own
  edit pages (`FormShell` + `CustomFieldInputs` via the shared `CustomFieldsEditForm`), roles
  `canCorrectClaims`/`canWorkDenials`; saving there only ever writes `custom_field_values` (no
  `claims`/`denials` column change, no `claim_versions` row — confirmed by an integration test), so
  its stale-edit check is a new values-table concurrency token (`customFieldValuesToken` /
  `saveValuesForRecord`'s `expectedValuesToken`) instead of the record's own `updatedAt`; `/claims`
  and `/denials` gained list columns via the same `loadListValues` module. PR 4 (payers) done: since
  there is no payer screen yet outside Settings, a new, minimal, read-only payer record was added
  there instead — `/settings/payers` (table: name, EDI payer ID or "Not verified", regime label or
  "Regime not verified", source, plus up to 5 non-sensitive `show_in_list` payer fields via the same
  `loadListValues`), `/settings/payers/[id]` (`RecordHeader`/`RecordLayout`/`FieldList`, a "Custom
  fields" panel with masked reveal via `revealPayerCustomField`), and `/settings/payers/[id]/fields`
  (the same standalone edit-page pattern and values-table concurrency token as PR 3). Payers have no
  linked patient, so they carry no record-level sensitivity (`recordIsSensitive` returns `false` for
  `payer`, tested). New permission `canEditPayerFields` (admin, manager) gates the fields edit page
  and action — an owner-confirmable choice noted as an open question in the spec, since payers have
  no natural "biller" role the way claims and patients do. `pnpm test` (833/833),
  `test:integration` (376/376), `lint`, `typecheck`, `format:check` all green. Next: S3 (Users and
  roles tab); an e2e admin user fixture doesn't exist yet (`test/e2e/global-setup.ts` seeds
  specialist/compliance/manager only), so the spec's "admin adds a field" E2E case is still open for
  every PR.
- Phase 0 engineering done: skeleton, design system, tenancy + RLS, audit log, sign-in with MFA,
  rules engine, synthetic data, Netlify config (not yet deployed — see `docs/runbooks/netlify.md`).
- Phase 1 started: Overview, denial queue, and denial detail work end to end on seeded data.
- Claims module C1 (`specs/claims.md`): claims list with timely-filing warnings, claim detail,
  corrections of draft/rejected claims with a required reason, and append-only version history
  enforced by database triggers. Next: C3 837P + filing block, C4 999/277CA.
- **Claims C2 — charge capture via CSV import** (`specs/claims.md` C2, approved by delegated technical
  authority 2026-09-29; branch `claude/vigilant-tesla-ps41e9-c2-charge-import`, **no migration, no table,
  no GRANT**): `/claims/import` (admin, manager, specialist; button in the `/claims` header) takes one
  UTF-8 CSV (2 MB, 5,000 rows, one row per claim line, rows sharing a `Claim number` form one claim) and
  creates **draft claims all or nothing** through `createDraftClaims` (`src/domain/claims/versions.ts`):
  claim, lines, and version 1 (reason `charge_import`, shown localized in the history) so the C1 triggers
  and history apply. Patients are matched by MRN and read only (never created or changed, synced or manual);
  payers matched against the practice's catalog by name (unverified allowed, warned); CPT/HCPCS, modifier
  and ICD-10-CM codes are format-checked with the C1 patterns and stored exactly as given (never upper-cased
  or fixed). Duplicates are refused, not skipped: a claim number that exists, the same patient + payer + date
  + code with the same modifiers as any existing claim or another claim in the file, and a whole file already
  imported. Timely filing (C1 `filingStatus`) only warns; counts are shown after the import. Synthetic-only
  environments need the attestation, `SYN-` claim numbers, and `SYN` MRNs. Audit: `claim.created` per claim,
  `claim.import_completed` per import (batch ID, counts), `claim.import_rejected` (fixed reason, counts, attempt ID);
  a per-practice `import_charges` rate limit (10 per 10 minutes); repeated or non-contiguous lines are refused so a
  file pasted twice can't double a claim; no row value anywhere. Error report: first 20 rows on the page, CSV download (row, column, code, message) built
  in the browser. Parse and match logic is in `charge-file.ts` (pure) and `charge-import.ts`. **Status:** CI ran the first
  integration file green; the fix-round tests (`claim-import-actions.test.ts`, the synced-patient and
  repeated-line cases, shared fixtures now in `test/integration/helpers.ts`) await a CI run. Owner: OA-083 (a `claim_imports` table
  needs a GRANT, R-15.9), OA-084 (biller roles, duplicate override, encounter split, PM export source).
- UI shell is ERP-style: global header with a "Go to" field (Ctrl/⌘ K), navy tab bar whose first
  control is the current module's name, and a grouped module switcher (`specs/erp-shell.md`).
  Deliberately not a copy of any vendor's shell: no grid icon, no "app launcher", tinted module
  tiles, "modules/pages" vocabulary (ADR 0005).
- Patient records P1 (`specs/patients.md`): `/patients` list, POST search (no names in URLs),
  register/edit with primary coverage (encrypted member ID), admin-only sensitivity tags, and a
  patient chart linking claims and denials; claim and denial pages link back. "Patients" is in the
  module switcher as its own module. Next: P2 secondary coverage/eligibility, P3 accounting of disclosures.
- Practice sign-in page shows the owner's DenialDesk reception image in a matted frame beside the
  card (`specs/sign-in-and-sessions.md`); the operator sign-in has no image.
- Whole-product review (2026-09-26, `docs/reviews/2026-09-26-billing-structure-review.md`): the
  billing lifecycle is implemented only from "denial exists" onward plus claim corrections and the
  PM-file accounting module; claim status, paid amounts and denials are seed-only. Seven confirmed
  calculation/display bugs (comma charges, `-$0.00`, "filed on time" with no deadline, prompt-pay
  "Met" on any notice), missing catalog rules, and a page-by-page record-model gap list with a
  prioritized order of work (P0–P4). Next session should start with its P0 list.
- Insight standard reports (`specs/insight-standard-reports.md`): `/insight` lists 6 available
  reports (denials by category/CARC, denials by payer, denial rate, open denials by appeal-deadline
  bucket, claims by status/A/R summary, appeal outcomes) plus 2 planned (prompt-pay scorecard,
  underpayment variance). Every role can view; export (owner decision 2026-09-26) is limited to
  admin/manager/compliance. Reports are aggregate-only (no patient/claim drill-down), tenant-scoped
  through `withTenant`, and every view/export is audited (`insight.report_viewed`,
  `insight.report_exported`). The primary export is a formatted **.xlsx workbook** (not CSV — owner
  decision 2026-09-26: "business people need to export the data"), built server-side with the new
  `exceljs` dependency (MIT, `src/domain/insight/workbook.ts`): an About cover sheet plus data
  sheet(s) with a bold frozen header, autofilter, real numeric/date/percent cells, a totals row, and
  formula-injection sanitization; an "All reports" workbook is also offered. New indexes:
  `denials(tenant_id, notice_date)`, `claims(tenant_id, submitted_at)`,
  `claims(tenant_id, service_date)` (migration 0029). Navigation's Insight "Reports" item now
  points at `/insight` and is `available: true`. Small-cell suppression (owner decision
  2026-09-26, R-8.7): a report row whose underlying claims include a sensitivity-tagged patient
  (R-3.5.1) and whose count is under `SMALL_CELL_SUPPRESSION_THRESHOLD` (default 11, config in
  `src/domain/insight/suppression-config.ts`, ⚠️ VERIFY with counsel — modeled on CMS's public-
  use-file cell-size suppression policy, not a Florida statute) shows "Suppressed (<11)" instead
  of its count/dollars/rate, on-screen and in the export; complementary suppression (decided once
  per whole sheet, never per sub-group, and never picking a zero-count row) also hides the
  next-smallest sibling row when only one row would otherwise be suppressed. A reviewer fix
  (2026-09-26) closed a back-calculation gap: whenever any row in a sheet is suppressed, that
  sheet's own totals row is suppressed too (previously it showed the true grand total, letting
  `Total − visible rows` reconstruct a hidden value). Suppression is a typed `SuppressedCell`
  marker (`src/domain/insight/suppression.ts`), never a string comparison, and the decision is
  made once on the actual sheet rows in `src/domain/insight/report-sheets.ts` (not in
  `calculations.ts`, which only computes each group's `sensitive` flag), so the on-screen table
  and the .xlsx always agree. Accepted residual risks, documented on the About sheet: cross-report
  / overlapping-date-range differencing isn't guarded against, and report #3 (denial rate)'s
  tenant-wide denied-claims count is never suppressed (it's one scalar, not a row breakdown).
  Exporting to a production (Azure) tenant is gated on `OA-033` (the still-open written
  handling/retention policy question). Next: custom/user-built reports, patient-level drill-down
  once broader sensitivity-tag enforcement lands (R-3.5.1), and the two planned reports once their
  blockers clear.
- Fixed the same date: `isSameOrigin()` (`src/lib/same-origin.ts`), used by the Insight export
  routes' CSRF check, rejected every real "Download Excel" click with a 403 — this app's own
  `Referrer-Policy: no-referrer` makes browsers send a literal `Origin: null` for a same-origin
  full-page form POST, which `new URL("null")` can't parse. Now checks `Sec-Fetch-Site` first
  (unaffected by referrer policy; reliable in all modern browsers), falling back to the
  Origin/Host comparison only when that header is absent.
- Payer catalog P1 (`specs/payer-catalog.md`): `payers.edi_payer_id`/`regime` are now nullable plus
  a `payers.source` column; a payer missing either is "unverified". Starter Florida insurer catalog
  by name only (`src/domain/payers/florida-catalog.ts`, no payer IDs/regimes) loaded per-tenant,
  idempotently, by `ensureCatalogPayers` (`src/domain/payers/catalog.ts`), called from the seed and
  from `seedRevenueCycleDefaults`/practice setup. Primary Insurance's Payer field is a searchable
  input+datalist (`PatientForm.tsx`) labelling unverified payers. `regimeLabel()`
  (`domain/denial-status.ts`) and `filingStatus()` (`domain/claims/status.ts`, new
  `"payer_unverified"` state) handle a null regime everywhere it's shown; unverified payers get no
  computed deadline. `assertPayerVerified` (`domain/payers/verification.ts`) guards future 837P
  submission. Next: P2 clearinghouse payer IDs + admin regime verification + payer admin screen.
- Live preview: https://denialdesk.netlify.app (Netlify Database, us-east-2). A platform operator
  console (`/operator`) for the owner, with its own sign-in at
  `/operator/login` and an operator account that belongs to no practice (`specs/operator-login.md`).
  The operator account exists only from hosting configuration (`PLATFORM_OPERATOR_PASSWORD_HASH`,
  made with `pnpm operator:credential`); no page can create or reset it (owner rebaseline 2026-09-26).
  An unusable value (e.g. the password pasted instead of its hash) switches the console off and is
  reported once in the function log as `operator.credential_unusable` (runbook has the fix). Since
  2026-09-26 every refused operator sign-in also logs a fixed-word reason
  (`operator.sign_in_refused`) and `GET /api/preview/operator-status` (`SEED_TOKEN`, pre-production
  only) reports the configuration and account state in one request; the runbook's
  "Operator sign-in shows the generic error" section maps each word to its fix.
- Next (owner rebaseline): tenancy lifecycle in the console: Pause for non-payment (read-only +
  export), Suspend for security, Terminate → offboarding (export, legal hold, certified destruction),
  BAA-on-file gate in production (later the same day the owner chose
  to keep that manual for now: the console flags a missing BAA and the owner decides;
  `specs/practice-agreements.md`).
- Operator console: each customer practice has a page (`/operator/practices/<id>`) where the
  operator records the signed Business Associate Agreement (PDF, dates, signers) and downloads
  it; renewals supersede, older ones can be back-filled as historical, mistakes are marked
  "recorded in error" with a reason; nothing is deleted; the practices list shows BAA status
  (`specs/practice-agreements.md`). Practices are still created by the operator only (owner
  decision 2026-09-26: no self-service sign-up; a BAA must be signed before a practice exists).
  Creating a practice now has its own page, `/operator/practices/new` ("New practice" button on
  the list). Owner rule: every create flow on the platform gets its own page (`DESIGN.md` §8).
- The one-click demo practice was removed entirely (owner request, 2026-09-26); migration 0021
  archived any live demo practice and ended demo sessions; 0022 disabled demo-only accounts and
  audited each retired demo practice (`system.demo_retired`). Practices are created from the console.
- Archived demo practices purged (owner decision, 2026-09-26; ADR 0008): migration 0032 deletes
  every demo practice, its synthetic data, and its demo-only users, so none appear in the console.
  Audit events are kept (no longer foreign-keyed to tenants/users) and each purge is audited
  (`system.demo_purged`, `system.demo_user_purged`).
- Open item: the operator uses TOTP; R-7.2.2 requires phishing-resistant MFA (WebAuthn) for admins
  before production.
- Open item (human decision): single-administrator risk acceptance with compensating controls
  (independent log review, sealed break-glass holder) and R-7.2.6 alerting, before production.
- Production branch on Netlify: `claude/quirky-feynman-ufql5a` (default). Each session works on its
  own branch and merges through a PR.

## Decisions made (details in `docs/decisions/`)
| Date | Decision | Record |
|---|---|---|
| 2026-09-26 | MVP = Florida claims + denial platform (REQUIREMENTS §12 Phase 1) | `PRODUCT_BRIEF.md`, `ROADMAP.md` |
| 2026-09-26 | 8-agent roster instead of 11 | `AGENT_WORKFLOW.md` |
| 2026-09-26 | App opens on the welcome page at `/` (sign-in and logo land there); Denials overview moved to `/overview` | `specs/welcome-page.md` |
| 2026-09-26 | Stack: TypeScript, Next.js, PostgreSQL + Drizzle, Vitest, Playwright | ADR 0001 |
| 2026-09-26 | Production on Azure, U.S. only; primary likely East US 2 (confirm at cutover) | ADR 0002 |
| 2026-09-26 | Pre-production on Netlify, synthetic data only | ADR 0003 |
| 2026-09-26 | Enterprise design system; Tailwind v4 + own components + Radix | ADR 0004, `DESIGN.md` |
| 2026-09-26 | DenialDesk visual identity (navy/teal, Playfair/Inter/Space Mono, lucide icons); logo unchanged | ADR 0004 amendment, `specs/visual-identity.md` |
| 2026-09-26 | Revenue cycle accounting module (rules engine, journal vouchers, A/R aging, deposits, statements), tenant-scoped, phases B1–B5 | `specs/revenue-cycle-accounting.md` |
| 2026-09-26 | DenialDesk is standalone (owner instruction): the owner's earlier prototype was reference only; the revenue cycle module uses DenialDesk's own file layout, rules, accounts, vouchers, aging, and reconciliation (C0) | `specs/revenue-cycle-accounting.md` |
| 2026-09-26 | Secrets scanning: gitleaks in CI | `specs/project-skeleton.md` |
| 2026-09-26 | Agents merge their own PRs once CI is green and reviewers have no blocking findings | `CLAUDE.md` #12 |
| 2026-09-26 | Rate limits on demo login, sign-in, MFA, and seed endpoint | `specs/rate-limiting.md` |
| 2026-09-26 | Insight standard reports: all roles view, export limited to admin/manager/compliance, aggregate-only (no drill-down), primary export is a formatted .xlsx workbook (not CSV); `exceljs` added | `specs/insight-standard-reports.md` |
| 2026-09-26 | Insight small-cell suppression (R-8.7): rows tied to a sensitivity-tagged patient with a count under 11 (config, ⚠️ VERIFY) show "Suppressed (<11)" instead of values on-screen and in exports, with complementary suppression to prevent back-calculation | `specs/insight-standard-reports.md` |
| 2026-09-27 | Three UI languages (en/es/pt) with an own message module, cookie + `users.locale`, money not localized | ADR 0009, `specs/internationalization.md` |
| 2026-09-26 | ERP shell: global header, navy tab bar, module switcher (replaces the sidebar) | ADR 0004 amendment, `specs/erp-shell.md` |
| 2026-09-27 | DenialDesk University lives outside the module switcher (header link + user-menu item); content is code-reviewed catalog data, never retyped statutory values; completions are append-only training records | `specs/denialdesk-university.md` |
| 2026-09-26 | Operator two-step is off on the Netlify console for now (`PLATFORM_OPERATOR_MFA=off`; ignored in production); unset the variable to turn it back on | `specs/operator-login.md` |
| 2026-09-26 | No self-service sign-up; the operator creates practices after the BAA is signed, and records the BAA on the practice page | `specs/practice-agreements.md` |
| 2026-09-26 | BAA handling is manual by design: no sign-in blocking without a BAA, no template version, corrections via "recorded in error", nothing automatic at termination | `specs/practice-agreements.md` (Decisions) |
| 2026-09-26 | Shell differentiated from any vendor's product; no third-party design IP; competitor names out of product copy and public docs | ADR 0005 |
| 2026-09-26 | Every DB error sanitized where Drizzle creates it (system and tenant); kept messages opt-in (owner: fix both in PR #28) | ADR 0006 |
| 2026-09-26 | Custom field values on records (settings S2) are in the Phase 1 MVP; sensitivity checkboxes hidden from the patient form (owner, 2026-09-26; R-3.5.1 tagging gap accepted, compliance sign-off pending) | `specs/settings-and-custom-fields.md` |
| 2026-09-26 | Owner answers on the billing-structure review's open questions (§8) — **pending counsel confirmation; not yet implemented in rule logic**: (1) timely filing counts from the submission date, evidenced by the clearinghouse acknowledgement (not the payer's receipt date); (2) a deadline landing on a weekend or Florida/federal holiday rolls to the next business day; (4) Medicare Advantage is not under Florida prompt pay per the owner — MA payment timing follows the plan contract (⚠️ VERIFY: 42 CFR § 422.520 sets a 30-day clean-claim rule for non-contracted providers; counsel to confirm this doesn't reintroduce a statutory clock); (5) late-payment interest starts accruing the first calendar day after the prompt-pay deadline passes. Item (3), month-end clamping of the 6-/12-month timely-filing windows, is still open and being researched separately. | `docs/reviews/2026-09-26-billing-structure-review.md` §8 |
| 2026-09-27 | University Wiki: articles are code (PR-reviewed, no per-tenant or user-edited content), legal values only through rule tokens, search by POST; sits beside the U1 courses under the same header, not in the switcher; further structure waits for the owner (OA-036) | `specs/university-wiki.md` |
| 2026-09-27 | Roll-forward pending counsel (OA-034), option 1: the date conservative for the practice governs. Provider-side deadlines (timely filing, secondary payer, 35-day response, overpayment response, Medicare appeal levels, payer-contract appeal windows, patient refund) alert, sort, go "past deadline" and block on the UNROLLED date; payer-side prompt-pay milestones and interest start use the UNROLLED date (interest from the day after). The rolled date is computed and shown as "(pending counsel: date)" only. One switch: `ROLL_FORWARD_POLICY` in `rules/roll-forward.ts` (effective-dated, needs `confirmedBy`) plus rule attribute `side`. Applying rule-reading attributes to baseline versions was an engineering choice, pending owner/counsel acceptance (OA-034 item 7). | `specs/rules-engine-skeleton.md`, `rules/roll-forward.ts` |
| 2026-09-27 | Patient Register is a synced, read-only copy of the practice EHR/PM (billing minimum only) over FHIR R4 / US Core + SMART Backend Services; data-source drop-down beside the Patients tab, Patients table only for now; manual entry kept only while no connection is active (OA-046) | ADR 0010, `specs/patient-integrations.md` |
| 2026-09-29 | Background execution: signed `{ runId }` jobs, a read-only definer claim for a new `denialdesk_jobs` role (no table privilege), a 15-minute definer-queued schedule, platform-neutral core with a thin Netlify adapter, Sync now queues a job where a secret is configured; **Proposed, R-15.9 sign-off pending (OA-085)** | ADR 0012, PI2c |
| 2026-09-28 | Record pattern P4: `DataTable` sorting is server-side via allow-listed `?sort=<key>&dir=asc\|desc` links, not TanStack Table (still deferred until a list needs client-side interactivity — column chooser, virtualized rows) | ADR 0004 addendum, `specs/record-pages.md` |
| 2026-09-28 | Binding HIPAA and secure-coding standards; strictest reading wins; new third-party packages default to no (owner request) | `HIPAA_COMPLIANCE.md`, `SECURE_CODING.md` (OA-088) |

The product owner delegated technical decisions to the implementing agent ("make the best
technical decisions"). Decisions still get an ADR so a human can review them.

## Next up
0. Revenue cycle module (`specs/revenue-cycle-accounting.md`): B1 rules and ledger, B2 monthly file
   import, C0 (own design: month-end activity file, routing-only rules), B3 journal vouchers, and
   B4 aging/deposits/reconciliation, and B5 statements and RCM dashboard (denial tie-ins by
   payer-class regime) done; the module's planned phases are complete. Follow-ups: coded reasons
   for deposit reversals, credit-balance refund tracking (roadmap), multi-account deposits.
1. Netlify pre-production is live (https://denialdesk.netlify.app); keep it re-seeded after data
   migrations (item 8).
2. 835 ERA ingestion → real denial capture (edi-x12-specialist).
3. Payer setup screen (appeal windows from contracts) and practice/provider setup.
4. Claims C3–C4 (`specs/claims.md`): 837P via clearinghouse stub with the timely-filing block;
   999/277CA capture. (C2 CSV charge import is built; run its integration tests in CI first.)
5. Appeal letter templates (human review before export).
6. Custom field values on records, settings S2 (MVP): PR 1 storage (#53), PR 2 patients (#68) and
   PR 3 claims/denials (#73) merged; PR 4 payers (a minimal read-only payer record under Settings ›
   Payers with its own "edit custom fields" page) done (#76), review polish follow-up done (payer
   role check runs before the row lock; tighter tests; `payerSourceLabel` unit test). Next: S3
   (Users and roles tab).
7. Claim page timely-filing copy (review D2, builder PR): "Sent; the filing window is met once the
   payer confirms receipt" in `src/app/(app)/claims/[id]/page.tsx` must change to the owner's answer —
   timely if **submitted** by the deadline, evidenced by the clearinghouse acknowledgement.
8. Re-seed pre-production data after PR #59 (P1 rules): `denials.appeal_deadline` rows written
   before it hold the old rolled (later) date and show no "pending counsel" marker.
9. DenialDesk University U2–U3 (`specs/denialdesk-university.md`): knowledge checks; per-user
   training record under Settings with .xlsx export once OA-035 is answered.
10. Patient records P2–P4 (`specs/patients.md`): secondary coverage and eligibility, accounting of
   disclosures export (R-5.1.1), sensitivity-tag enforcement. After P1 deploys, re-seed or create a practice so
   seeded patients carry addresses and coverage (existing rows get coverage from the migration).
   P2 coverage now comes from the EHR sync once a practice is connected (`specs/patient-integrations.md`).
11. Patient integrations PI1a → PI1b (done; PI2a follow-ups from its reviews: hide or explain
   "Register patient" and give the drop-down panel a sentence per state while a connection is outside
   draft/revoked; PI2b: refresh the drop-down's summary during a session) → PI2a → PI1c → PI2b → PI3 → PI4 (`specs/patient-integrations.md`, builder; edi-x12-specialist
   reviews the 837P fit of the mapping).
12. Close the known gaps in `docs/SECURE_CODING.md` and `docs/HIPAA_COMPLIANCE.md` (tracked, not
   waived; they gate the first real practice): AAD on member-ID and TOTP encryption, exact
   pins, digest-pinned images, 7-day release quarantine, strict Zod objects, upload malware scanning,
   missing threat models, CI license check, SAST/DAST/SBOM, signed commits; WebAuthn, JIT and
   break-glass access, WORM audit + SIEM, mTLS, Key Vault, legal hold, disclosure-accounting export,
   and the written HIPAA policy set.
   Closed: SC-B10.1 (strict CSP, `base-uri 'none'`, no `'unsafe-eval'` even in development).

## Open questions for humans

- **Confirm three PI2a coordinator decisions (OA-065, 2026-09-28; due before the first real connection):** (a) Submit's gate is stricter than the spec's plain wording: the newest Test connection must be a pass within 24 h, bound to the tested configuration and signing `kid` (a later failure or transport refusal voids it); (b) pre-production signs every connection with one shared key (`INTEGRATION_SIGNING_KEY`), a residual risk recorded in threat model S3, mitigated by the operator verifying `client_id` ownership at approval (PI1c); (c) a refused Submit ("This endpoint and client ID are already connected") reveals that *some* practice holds that endpoint and client ID pair, with no identity disclosed, bounded by the Test connection and Submit rate limits: accept or reject.
- **PI1c operator approval, eight owner decisions (OA-066 to OA-073, 2026-09-28; all due before the first real connection unless noted):**
  (a) **OA-066** the approval verification-method and contact-role lists (`phone_callback`, `video_call`,
  `written_confirmation`, `vendor_portal`; `ehr_administrator`, `practice_administrator`, `it_contact`,
  `vendor_representative`, `other`) are the builder's proposal; (b) **OA-067** R-15.9 sign-off for the operator alert
  on `integration.registry_conflict`: a SECURITY DEFINER function or an INSERT grant so Submit can write an
  operator-only record of the holding connection (threat model S2); (c) **OA-068** should Reject clear the
  residency attestation and discovered endpoint, as built, or leave them; (d) **OA-069** the Notifications spec
  behind the activation notice: who is notified, retention, whether PHI-free e-mail is allowed; (e) **OA-070**
  retention of approval evidence: `operator.integration_approved|rejected` kept for the life of the connection plus
  6 years and under legal hold, or dedicated columns later; (f) **OA-071** an operator-side revoke must exist
  before the first real connection; (g) **OA-072** accept single-person approval and confirm exactly one person
  uses the operator account (unique user identification, 45 CFR 164.312(a)(2)(i)), else plan per-person
  operator accounts before production; (h) **OA-073** an operator-realm step-up gating Approve before the Azure
  cutover (`step_up_verified_at` in the approve audit); not built, pending this owner decision.
- **CI runs the integration suite as a PostgreSQL superuser, so FORCE ROW LEVEL SECURITY on the owner and
  platform paths is never exercised (raised 2026-09-28 after PR #89; owner action item **OA-074**, an
  R-15.9 decision; needs a CI change, not made here).** A superuser (and any BYPASSRLS role) ignores every policy, even on FORCE
  tables, so tests that pass in CI cannot show that `withTenantAsPlatform` (the connection owner with
  `app.tenant_id` set: operator approval, BAAs, University access) and the owner-role reads in tests
  (`systemDb()`) behave under the policy a non-superuser owner is subject to in Netlify and Azure. The
  practice path (`withTenant`, `set local role denialdesk_app`) is exercised under RLS regardless. A
  policy or an omitted `app.tenant_id` on an owner path would pass CI and fail (or show no rows) at the
  first real deploy; the same blind spot is behind the data-backfill lesson below. **Proposal (owner
  decision, then a CI/`docker-compose` change):** create the migration owner as a plain non-superuser,
  non-BYPASSRLS role that owns the schema (`CREATE ROLE denialdesk_owner LOGIN NOBYPASSRLS` with
  `CREATE`/ownership on the database), migrate and run `pnpm test:integration` as that role, keeping one
  superuser connection only for test setup that must bypass policies (`createTestTenant`, fixtures);
  assert in a test that the connection's role is neither `rolsuper` nor `rolbypassrls`. Expect some
  owner-path tests to need `app.tenant_id` set, which is the point. See spec `patient-integrations.md`,
  "Test infrastructure gap".
- **Is a payor key detached from any patient's PHI? (OA-075, 2026-09-28.)** A payor key (`Organization/<id>`) names an insurer, but it sits on the synced patient row (`coverage_payor_key`, Restricted PHI) and is repeated in `integration_payer_mappings` (classified Confidential). The answer decides whether the mapping table is reclassified to Restricted. Until then the payer mapping page is audited and no audit event or log carries a key (`specs/patient-integrations.md`, Classification).
- **TLS 1.3 minimum for the FHIR transport?** (2026-09-28, pending, `OA-062`.) R-7.3.1 is TLS 1.2+ (prefer 1.3); the transport enforces 1.2 with ECDHE + AEAD suites only and negotiates 1.3 when offered. A 1.3 minimum would refuse EHR vendors that only support 1.2. Must be decided before the first real endpoint is enabled.
- Patient integrations (`specs/patient-integrations.md`): U.S.-hosting attestation vs. vendor letter
  and BAA scope (OA-045); retire manual registration once connected (OA-046); phone/email not synced
  (OA-047); disconnect/switch EHR (OA-048); vendor sandboxes (OA-049); Bulk Data before first real
  practice (OA-050); who confirms EHR app scope (OA-051); PI1c approval decisions (OA-066 to OA-073, below); EHR-restricted (R/V) patients (OA-052);
  MRN conflicts (OA-053); interoperability requirement ID (OA-054); dependents' coverage (OA-055);
  sync interval (OA-056).
- Custom field list columns (PR 2): tagged patients show no custom values in the patient list
  (excluded at the query); confirm this over showing "Locked" cells. Threat model I5 (a member ID
  typed into a non-sensitive text field) now also covers list columns; owner to re-confirm.
- DenialDesk University: should lesson completions serve as the practice's HIPAA training evidence,
  and in what form (U3)? `OA-035`.
- Month-end clamping of the 6- and 12-month timely-filing windows (billing-structure review §3.4,
  §8 item 3): being researched separately; not yet decided.
- Appeals A1 (`specs/appeals.md`): late-filing blocking (OA-023), withdrawn/dismissed → denial
  status mapping (OA-024), appeal version history before A2 (OA-025), Medicare amount-in-controversy
  thresholds source (OA-026), tracking/recovered-amount field masking (OA-027), abandoning a draft
  appeal (OA-028), compliance member-ID reveal on appeals (OA-029), counsel sign-off on the level
  2–5 Medicare rules added in this review round (OA-030), sensitivity-tag masking timing (OA-031),
  appeal record retention (OA-032).
- Budget, timeline, team, success targets (`PRODUCT_BRIEF.md` TODOs).
- Regulatory role memo, counsel, clearinghouse choice (ROADMAP Phase 0, human items).
- Confirm Azure regions at cutover.
- Counsel review of the overall look and feel (trade dress) before public launch, including the
  elements ADR 0005 kept (navy/teal chrome, white header, tab bar with teal underline, serif
  titles); ADR 0005 records the engineering checks and the changes made, and is not legal advice.
  Related: git history still carries a competitor's name in earlier doc wording, and no
  requirement ID covers third-party IP / brand compliance yet (R-15.7 covers licensing).
- A vector (SVG) version of the logo from a designer; the app currently uses the PNG.
- Confirm and record the license and generating tool for the sign-in reception image
  (`public/brand/README.md`); it is owner-supplied and described as a synthetic render.
- Claims list: are patient names read only to order the unsubmitted queue by patient (never shown
  beyond the displayed page) covered by the `claim.list_viewed` audit event? `OA-060`.
- Integrations step-up (PI2a): confirm the step-up window, lockout interplay, which actions need it
  (Resume yes; Pause and Revoke no, on purpose), and whether TOTP is enough until WebAuthn ships
  (R-7.2.2 asks for phishing-resistant MFA; close before the first real EHR connection). `OA-063`.
- Integrations: the free-text connection name is now shown to every role on every page (the Patients
  data-source drop-down); accept the residual risk or ask for a stronger guard? `OA-061`.
- The repo has no `main` branch; the default branch is `claude/quirky-feynman-ufql5a`. Rename it
  to `main` and protect it (R-7.4.4) before more PRs land.
- Insight exported .xlsx workbooks (R-9.2.1, SOC 2 C1.1/CC6.7): owner said "not sure, let's
  confirm" on 2026-09-26 whether practices need a written handling/retention policy for downloaded
  workbooks (they leave the audited system as files on a user's device). See `OA-033` in
  `docs/owner/OWNER_ACTION_ITEMS.xlsx`. **Export to a production (Azure) tenant is gated on this
  item being resolved** — don't enable Insight export for a real practice before `OA-033` closes.

- Revenue cycle imports (before real data, `docs/threat-models/revenue-cycle-imports.md`):
  sensitivity tags for lines (Part 2/HIV/behavioral CPTs); encrypt account numbers or confirm
  PM exports never put member IDs there; accept the synthetic-only guard as attestation-level.
- Revenue cycle: the starter chart of accounts and payer-class codes are illustrative; each practice
  maps them to its own GL and PM financial classes (rule/GL editing UI needs version history first).
  Accountant to confirm the net-revenue presentation (posted write-offs vs. GAAP price concessions).
  The Statements page and dashboard are labelled a management view until that review.
- Revenue cycle deposits: the database owner role can still modify deposit rows (insert-only
  applies to the app role). Accept the risk or add a guard trigger? Owner decision.
- Git history still contains the reference prototype's names from before C0. Rewrite history
  (force-push of the default branch), or leave it? Owner decision.
- Claims C2 charge import: `claim_imports` table for file-identity duplicate detection (needs a GRANT,
  R-15.9, `OA-083`); biller roles, an override for a legitimate repeat service, one-claim-per-number, and
  which PM export feeds the file (`OA-084`, `specs/claims.md`).
- Claims: which Florida timely-filing exceptions (§ 627.6131(2)) the C3 submission block must
  honor; Medicare Advantage filing windows assumed to come from payer contracts (`specs/claims.md`).
- Patients before real data (`specs/patients.md`, P1 reviews): enforce sensitivity tags in access
  and masking (R-3.5.1, R-3.5.2) and a Part 2 consent decision before SUD-tagged data; demographic
  version history for HIPAA amendments (§164.526), P3; confirm compliance needs address and phone.
  Pre-prod entry relies on the SYN prefixes plus a synthetic attestation checkbox (ADR 0003).
- Patients: should front-desk registration be its own role? Guarantor now or with statements (§8.6)?

- Claims before real data: sensitivity masking of diagnosis codes in `claim_versions` snapshots and
  history; retention/legal-hold path for append-only history; PIP/workers' comp/Medicaid filing
  rules and the HMO citation for timely filing (`specs/claims.md`).

### Decisions from the 2026-09-26 agent reviews (need a human)
1. **MFA enrollment on first sign-in** needs only the password, so a stolen password for a
   never-enrolled account could enroll an attacker's authenticator. Recommended: admin-issued,
   expiring one-time enrollment links. (security #4)
2. **Separate database roles:** the app connects as the schema owner, which could disable RLS or
   the audit trigger if the app were compromised. Recommended: a migration-only owner and a
   non-owner runtime login; required before the Azure cutover. (security #6, R-15.9)
3. **Role/field matrix (R-5.1.2):** compliance can no longer reveal member IDs; every role still
   sees name, DOB, MRN, and diagnoses. Confirm who should see what. (compliance #5)
4. **Synthetic NPIs** pass the check digit and could coincide with real NPIs. Keep, or use a
   reserved/marked range? (compliance #7)

### Deferred review findings (tracked, not blocking pre-prod)
- **PI4 blocker (open, blocks the first real connection): population scope.** `population_scope` is recorded at
  approval but nothing applies it yet, so a real connection could pull patients beyond the practice's own. The sync
  therefore refuses every non-sandbox connection (`population_scope_unenforced`; `assertRunEnvironment` and
  `syncNow`, audited, en/es/pt message, tests in `sync-engine.test.ts` and `sync-now.test.ts`). PI4 must lift that check
  in the same change that applies the Group export or the verified filter, with a test (spec PI4).
- Migration follow-up (PR #98 review L3): 0043 seeds the service principal with `ON CONFLICT DO NOTHING` and no
  target, so an email clash silently skips the seed (sync then fails closed on the foreign key, quietly). A later
  migration should make it `ON CONFLICT (id) DO NOTHING` so a clash fails loudly. 0043 itself is not edited: Netlify has
  applied it.
- Sensitivity tags (HIV, SUD/Part 2, …) not yet enforced in queries — before any real data (R-3.5.1, R-4.5.1).
- Composite `(tenant_id, id)` foreign keys; today code validates referenced IDs.
- WORM audit export at Azure cutover (owner can still drop the trigger).
- Member-ID reveal on a denial decrypts the patient's primary-payer member ID even when the claim was
  billed to another payer (R-5.1.2); fix with coverage records (review §6.1), and until then reveal
  only when the claim's payer is the patient's primary payer (2026-09-26 review, security).
- Claims C2 follow-up: nothing in the database forces a `claim_versions` version-1 row when a claim is
  INSERTed (the C1 triggers guard updates only). `createDraftClaims` (`src/domain/claims/versions.ts`) is the
  supported way to create a claim and writes version 1 and the `claim.created` audit event; a deferred
  constraint trigger requiring version 1 at commit should land with C3 (no other code path inserts claims
  today except the seed, which writes its own version 1).
- `claims.status` / `paid_cents` are not covered by the version trigger, and no DB CHECK enforces
  0 ≤ paid ≤ billed, 0 < denied ≤ billed, charges ≥ 0; must land with C3 / 835 posting, before the
  Azure cutover (2026-09-26 review, security; owner decision §8.4).
- Azure deploy gate, logging (owner decision 2026-09-26: hold until the Azure deployment; PR #28 reviews):
  - Log-sink residency and BAA (R-7.5.5): the Azure log destination is U.S.-only and under a BAA.
  - Tracing: Drizzle puts every query's params in the `drizzle.query.params` span attribute when
    OpenTelemetry is present. Before adding Azure Monitor / Application Insights, disable Drizzle
    spans or scrub that attribute.
  - Migrations: `drizzle-kit migrate` runs outside the sanitizer and prints full Postgres errors
    (including `detail` row values). Decide how production migrations run and where their output goes.

## Lessons / conventions learned
- A CHECK like `key = lower(url)` evaluates to NULL, which PostgreSQL treats as passing, whenever
  either side is NULL, so it doesn't stop a key written with no URL; spell the NULL cases out
  (`key IS NULL OR (url IS NOT NULL AND key = lower(url))`), as 0041 does for the token endpoint.
- A step-up check that shares the sign-in attempt counter must give back its own successful attempt,
  or a handful of legitimate step-ups in one session lock the account (`releaseAttempt`).
- Components that take a function prop (e.g. `Pagination`'s `hrefFor`) must stay server components;
  a `"use client"` directive there breaks every page with "Functions cannot be passed directly to
  Client Components". Client components get translations from `useT`, server ones from `getT`.
- e2e tests assert exact English text and `aria-label`s; when a string moves into the dictionary,
  keep its English value verbatim (add a separate key rather than reusing a nearby one).
- Netlify env vars set as "secret" through the connector with context "all" were silently dropped;
  set secrets per context in the Netlify UI, or non-secret via the connector.
- In raw SQL subqueries, unqualified column names bind to the inner table (team-size bug caught by
  an integration test); prefer separate grouped queries.
- Tenant data only through `withTenant()` (src/db/tenant.ts); FK references from user input must be
  checked against the tenant in code (FKs bypass RLS).
- Next.js renders a hidden `role="alert"` route announcer; scope e2e alert queries to `main`.
- Once production exists, record tables (imports, vouchers, audit) change by adding columns only;
  C0's column drops were a one-time pre-production change on synthetic data.
- Never edit, rename, or renumber a migration once pushed: Netlify deploy previews apply each
  branch's migrations to a branch database, track them by number, and refuse any change ("modified
  after being applied"). Add a new migration instead. The same error appears when two
  branches pick the same number: branch databases start from the main preview database, so a
  base migration 0025 blocks a PR's own 0025. Before pushing a migration, merge the base branch
  and take the next free number (custom field values hit this on 2026-09-26: #49, then #52).
  Hit again on patient-integrations PR #77 (2026-09-28): a first push landed migration 0039;
  three later review-fix rounds hand-edited that same file in place across several commits before
  anyone pushed, and the third push (commit 1efe153) broke Netlify's preview build with exactly
  this error, because the preview database had already applied 0039 as it stood after the first
  push. Fix was to restore 0039 byte-for-byte to what was first pushed and move every later delta
  into a new migration 0040 (`pnpm drizzle-kit generate --custom --name=<name>`, then hand-write the
  DROP/ADD CONSTRAINT and CREATE OR REPLACE FUNCTION statements — a plain ALTER FUNCTION can't
  change a function body). The rule holds even mid-PR, across commits on the same branch, not only
  after merge: the moment a migration is pushed once, it is immutable for that branch's preview.
- Killing dev servers: use `pkill -f "[n]ext-server"` so the pattern doesn't match its own shell.
- Root layout calls `connection()` so APP_ENV is read at request time (never baked into a build).
- Data backfills in migrations must run tenant by tenant (`set_config('app.tenant_id', …, true)`):
  tenant tables FORCE RLS, so a non-superuser migration owner (Netlify, Azure) sees no rows
  otherwise. Local and CI databases use a superuser and hide this.
- Server-side validation must reject impossible dates (`z.iso.date()`).
- Every Drizzle query error (system and tenant) is sanitized where Drizzle creates it (ADR 0006,
  `src/db/errors.ts`): SQLSTATE + constraint for class 23, messages only for allow-listed codes and
  listed trigger formats. Match DB errors on `.code` / `.constraint` (`isUniqueViolation`), never on
  message text. A new trigger `RAISE` must be added to `TRIGGER_MESSAGE_FORMATS`.
- `onRequestError` (src/instrumentation.ts) logs route template, digest, error name and SQLSTATE
  only; Next.js still logs the error itself, so error messages must be PHI-free where thrown.
  `log.ts` checks the values of `route`/`routeType`/`digest`/`errorName`/`constraint` by pattern.
- Local test DB without Docker: `initdb`/`pg_ctl` from `/usr/lib/postgresql/16/bin` as the
  `postgres` user, with the data dir somewhere that user can reach.
- Playwright in this cloud env: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Azure has no Florida region; § 408.051(3) only requires continental U.S. storage.
- CI actions are pinned to full commit SHAs with a `# vX.Y.Z` comment (Dependabot bumps both);
  resolve annotated tags to the commit (`git ls-remote … 'refs/tags/vX.Y.Z^{}'`), not the tag object.
  Checkout runs with `persist-credentials: false`; gitleaks runs with PR comments off (token is `contents: read`).
- Local environment: Node 22 is installed; CI and Docker use Node 24 LTS. `engines` allows ≥ 22.
