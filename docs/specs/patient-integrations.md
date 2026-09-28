# Spec: Patient integrations (Patient Register synced from the EHR/PM over FHIR R4)

Status: approved by owner in chat 2026-09-27 (design); PI0 docs revised after security/compliance
review 2026-09-28 (coordinator decisions pending owner confirmation, OA-057)
Roadmap item: Phase 1 → integrations (REQUIREMENTS §8.8 "EHR/PM systems via FHIR R4"); prerequisite
for charge capture by EHR integration (§8.2 step 2)
Requirement IDs: §8.8, R-3.3.1, R-3.3.3, R-3.3.6, R-3.4.1, R-3.4.2, R-3.5.1, R-3.10.3, R-4.5.1,
R-5.1.2, R-7.1.3, R-7.2.2, R-7.2.3, R-7.2.4, R-7.3.1, R-7.3.3, R-7.3.4, R-7.3.5, R-7.4.1, R-7.4.5,
R-7.4.6, R-7.4.7, R-7.4.8, R-7.5.1, R-7.5.3, R-7.9.2, R-11.1, R-15.1, R-15.7; §9.1, §9.2.
⚠️ No numbered requirement covers EHR interoperability yet (§8.8 is a bullet list; R-4.4.1 is the
payer prior-auth API): OA-054.
Design: ADR `docs/decisions/0010-patient-data-synced-from-ehr.md`. Threat model:
`docs/threat-models/patient-integrations.md`. Supersedes in part: `specs/patients.md` (P1 forms).

## Goal
The practice's EHR/PM is the system of record for patients. An administrator connects it once
(HL7 FHIR R4, US Core), the platform operator verifies the connection with the practice, and the
Patient Register becomes an encrypted, read-only copy of only the billing minimum, refreshed by
sync. Staff stop typing demographics; claims and denials keep working when the EHR is down.

## Decisions
Owner, 2026-09-27 (chat):
1. "For Patient Register we want to sync data, not hold any of the data, so we will place a
   drop-down in the nav bar beside the table and select an integration so we can connect to this
   table only. We'll evaluate what tables this is needed in the future. Follow medical integration
   practices."
2. "Not hold" means a **synced read-only copy**: the EHR/PM is the system of record; DenialDesk keeps
   an encrypted, read-only copy of the billing minimum; no editing of synced demographics;
   claims/denials keep working if the EHR is down.
3. First connector: **HL7 FHIR R4 / US Core only**. 4. Scope: the Patients table only.

Coordinator, 2026-09-28, after the security and compliance reviews (owner to confirm, **OA-057**):
operator approval of every real connection plus a cross-practice endpoint registry (confused
deputy); per-connection signing keys by default; job and scheduler hardening with a system
principal; environment gating; SSRF deny-by-default; immutable endpoints once data is synced;
identifier-system and sensitivity-label rules; practice-scoped population in production.

## Standards (cite; vendor specifics are ⚠️ VERIFY)
- FHIR R4 4.0.1 — https://hl7.org/fhir/R4/ (search, `_lastUpdated`, POST `_search`:
  https://hl7.org/fhir/R4/search.html; paging: https://hl7.org/fhir/R4/http.html#paging).
- US Core **6.1.0** Patient and Coverage — https://hl7.org/fhir/us/core/STU6.1/ . ⚠️ VERIFY: the
  version required of products certified under ONC HTI-1 (USCDI v3) from 2026-01-01.
- SMART App Launch v2 Backend Services — https://hl7.org/fhir/smart-app-launch/STU2/backend-services.html ;
  asymmetric client auth (RFC 7523) — https://hl7.org/fhir/smart-app-launch/STU2/client-confidential-asymmetric.html ;
  scopes — https://hl7.org/fhir/smart-app-launch/STU2/scopes-and-launch-context.html .
  ⚠️ VERIFY 2.0.0 vs 2.2.0 and whether clients must support RS384, ES384, or either.
- FHIR Bulk Data Access 2.0.0 — https://hl7.org/fhir/uv/bulkdata/STU2/
- v2-0203 identifier types (MR, MB); v3-Confidentiality; v3-ActCode sensitivity codes
  (http://terminology.hl7.org/CodeSystem/v3-ActCode).
- 45 CFR 170.315(g)(10) — population services via Bulk Data + Backend Services, for products
  certified to it (PM-only systems often are not). ⚠️ VERIFY.

**Population search is not guaranteed.** US Core 6.1.0 does not require a population-wide
`Patient?_lastUpdated=…` search (⚠️ VERIFY). PI2 uses it only where the CapabilityStatement
advertises it; Bulk Data `Group/$export` (PI4) is required before the first real practice, and in
production only a practice-scoped population is accepted (see Environment and population rules).

## User stories
- As an administrator, I connect our EHR/PM in Settings › Integrations, test it without pulling any
  patient, attest U.S. residency, and submit it; once the platform operator approves, sync starts.
- As the platform operator, I verify a submitted connection (base URL, token endpoint, client ID,
  population scope) with the practice's EHR administrator out of band, then approve or reject it.
- As an administrator, I sync now, pause, resume, or revoke from the drop-down beside the Patients
  tab or from Settings, read sync history (counts only), and map each insurer to one of our payers.
- As any user, I see beside the Patients tab where patient data comes from and when it last synced.
- As a billing specialist, I bill a synced patient as before; the chart tells me to fix demographics
  in the EHR.

## Environment and population rules
| Environment | Built-in sandbox | Vendor sandboxes | Real EHR endpoints |
|---|---|---|---|
| `syntheticDataOnly()` (local, CI, every Netlify deploy, even with `APP_ENV=production`) | Allowed | Only hosts in a reviewed code constant (`src/integrations/fhir/vendor-sandboxes.ts`, empty; OA-049) | Refused |
| `!syntheticDataOnly() && !onNetlify()` (Azure production) | Refused | Refused | Allowed after operator approval |

- **Synthetic guard (non-production), before any transform:** every raw MRN and member ID must start
  with `SYN`; the first page is requested with `_count=1`; one failing record rolls back the page and
  fails the run (`not_synthetic`). No prefixing on ingest.
- **Population (production):** only a practice-scoped population: Bulk Data export of the
  practice's Group (PI4), or a search filter the operator verified at approval. Blocking before
  real data.

## Connection lifecycle
`draft` → (admin **Submit**: passing test in the last 24 h, residency attested, MFA step-up) →
sandbox: `active`; real: `pending_approval` (registry claimed) → operator **Approve** → `active` (all
practice administrators notified) or **Reject** (reason code) → `draft` (registry released).
`active` ⇄ `paused` (resume: MFA step-up); `active` → `error` (automatic, reason code) → re-test and
resume. Any state → **`revoked`** (admin or operator; terminal; registry released; signing key
destroyed; offboarding runbook). At most one connection per practice and target table outside
`draft`/`revoked`.

**Editability.** Display name: always. `draft`: every client-settable field. `pending_approval`:
none (withdraw → `draft`). Once the connection has synced any patient, **base URL, token endpoint,
issuer, MRN identifier system, and client ID are immutable** — a different endpoint or client
registration is a new connection (re-review 2026-09-28, M-c: on shared vendor clouds a new client ID
can mean another organization's patients). "Has synced" is set when the first page commits, not
when the run succeeds, so a failed first run still locks the endpoint.

## Acceptance criteria

### PI0 — design docs
- [x] This spec, ADR 0010, threat model, notes in `specs/patients.md` and `specs/erp-shell.md`.
- [x] Revised after security/compliance review (2026-09-28).

### PI1a — data layer (no network calls, no UI)
- [x] Migration adds provenance to `patients` and the new tables (Data changes); existing patients
      become `source = 'manual'`. Every new table has `tenant_id`, RLS ENABLE + FORCE, a tenant
      policy, composite `(tenant_id, x)` FKs for every reference, tenant in every unique key, no
      DELETE grant, and an isolation test (read, insert, update across tenants). CHECK constraints
      close the gaps a first pass left open: a sandbox connection can only ever point at the
      built-in sandbox URL/key, client ID, token endpoint, and issuer (`token_endpoint`/
      `token_endpoint_key`/`issuer` must be NULL or the fixed sandbox value; `client_id` — NOT NULL
      — must equal it) and can never reach `pending_approval` (`is_sandbox` cannot be
      self-declared to skip approval); a non-sandbox connection cannot reach
      `active`/`paused`/`error` without recorded `approved_by/_at`, `approval_method`, and
      `population_scope`; `pending_approval` requires submission + US-residency attestation fields;
      `revoked` requires `revoked_by/_at`; `patients_member_id_presence` requires a manual row's
      member id and ties a `fhir` row's member id to `coverage_status`; a manual row keeps every
      sync-owned column at its default; `source_sensitivity` is a fixed vocabulary; `external_id`
      matches FHIR `id` syntax; and `issue_codes`/`status_reason`-style code arrays match a
      `[a-z_]{1,64}` format (via the immutable helper `integration_codes_well_formed`, since a CHECK
      cannot itself run a subquery). A partial unique index allows only one queued/running
      `integration_sync_runs` row per connection.
      (`drizzle/0039_patient_integrations_data_layer.sql`, `test/integration/patient-integrations.test.ts`)
      ⚠️ Cutover consideration: these CHECKs and the partial unique indexes are added with a plain
      `ALTER TABLE ... ADD CONSTRAINT` / `CREATE UNIQUE INDEX`, which takes a table lock and
      validates existing rows inline — fine here because the tables are new and empty in every
      environment this migration has run in. A **future** change to these constraints on a
      populated table should use `NOT VALID` + a separate `VALIDATE CONSTRAINT`, and
      `CREATE UNIQUE INDEX CONCURRENTLY`, to avoid locking reads/writes.
- [x] Trigger `patients_synced_readonly` refuses INSERT of a `fhir` row, any change to a synced
      column, and any change of `source`/`source_connection_id`/`external_id`, unless
      `app.sync_run_id` names a `running` run of `app.sync_connection_id` in the current tenant,
      that run's connection is `active`, and that connection owns the row. `fhir → manual` is
      always refused, and sensitivity tags are frozen (never touched by a sync, even on a manual
      row) whenever `app.sync_run_id` is set — including the very first INSERT of a synced row,
      which is refused outright unless `sensitivity_tags = '{}'` (sensitivity tags are always
      practice-set, never carried in from the EHR/PM). Message added to `TRIGGER_MESSAGE_FORMATS`
      (ADR 0006).
- [x] Trigger on `integration_connections` enforces the lifecycle and editability rules above: the
      app role cannot write approval columns (column grants) or move `pending_approval → active`
      (also checked in the trigger, as a second layer, by role name); activation additionally
      requires a *fresh* approval (`approved_at` must change on the same update, not merely be
      carried over) **and**, for a non-sandbox connection, a matching `integration_endpoint_registry`
      row (the registry is what stops two practices going live on the same real EHR registration, so
      activation without a claimed entry would defeat the point of the registry); `revoked` is
      terminal; the endpoint field set (`base_url`, `endpoint_key`, `token_endpoint`,
      `token_endpoint_key`, `issuer`, `client_id`, `mrn_identifier_system`) is
      writable only while `status = 'draft'`, regardless of whether the same update also changes
      `status`, and is locked forever once `has_synced`; while `pending_approval`, only
      `display_name`, the updated-by/at bookkeeping, and the status transition itself may change.
      A second trigger abandons any `queued`/`running` sync run when its connection is revoked, and
      a partial unique index allows only one connection per tenant outside `draft`/`revoked` at a
      time (unchanged from the first pass, now covered by an explicit isolation/edge-case test
      matrix rather than a single happy-path test).
- [x] Endpoint registry `integration_endpoint_registry` (no RLS, no grants to `denialdesk_app`;
      `PUBLIC`'s default EXECUTE on the two functions below is explicitly revoked before the
      practice role is granted it back): unique `(endpoint_key, client_id)` over all practices,
      reached only through SECURITY DEFINER `integration_registry_claim(connection_id)` /
      `_release(connection_id)` returning a boolean. `endpoint_key` = WHATWG-normalized scheme +
      host + port + path (no trailing slash; path compared case-insensitively). A second unique key
      covers the normalized **discovered token endpoint** + client ID, so a vanity hostname or CNAME
      for the same server can't bypass the registry (M-b); claiming refuses (rather than silently
      registering) a connection with no discovered token endpoint yet. Both functions require
      `connection.tenant_id = current_setting('app.tenant_id')`, claim only a connection that is
      `pending_approval` and not a sandbox (row locked `FOR UPDATE`), run with
      `SET search_path = pg_catalog, public, pg_temp` (`pg_temp` last, so a session-local temp table
      can never shadow a catalog/schema lookup — tested with a planted temp table), and release only
      on a transition to `draft` (withdraw/reject) or `revoked`, enforced in the database; isolation
      test: practice A cannot claim or release practice B's entry (M-a). Sandbox connections are not
      registered.
      ⚠️ The WHATWG-normalization algorithm itself is `src/integrations/fhir/url-rules.ts` (shipped
      in PI1b-1; PI2a derives `token_endpoint_key` with the same function, and must refuse the
      sandbox host for a discovered endpoint, since `checkBaseUrl` exempts it from `.invalid`); PI1a stores whatever
      `endpoint_key`/`token_endpoint_key` the caller computes.
      ⚠️ R-15.9: the `REVOKE`/`GRANT EXECUTE` and column-grant statements in this migration are a
      privilege change; per non-negotiable 5/R-15.9 they still need a human sign-off recorded on the
      PR before this migration is applied anywhere beyond a local/test database, same as any other
      IAM-adjacent change.
- [x] `purge_demo_practices()` (0038) is extended (`CREATE OR REPLACE`, same function, same
      trigger-disable/enable pattern) to delete the five new tables' demo-practice rows in FK order
      (`integration_sync_issues`, `integration_sync_runs`, `integration_payer_mappings`, `patients`,
      `integration_endpoint_registry`, `integration_connections`) and to disable/re-enable the two
      new append-only-style guards around that; extended in `test/integration/demo-purge.test.ts`.
- [x] Domain refusals (before the triggers): `updatePatient` on synced patients; register/edit while
      a connection is outside `draft`/`revoked`. `assertPatientsRegisterOpen` locks every one of the
      practice's `target_table = 'patients'` connections that isn't `revoked` with `SELECT ... FOR
      SHARE` — **draft rows included** — and only then decides in code whether any of them is
      outside `draft`/`revoked`; locking only the already-blocking rows (correctness review N2,
      final round) would leave a still-`draft` connection unlocked and racing a concurrent Submit.
      The synced-patient refusal is checked first, so editing a specific synced patient reports
      that, not the generic "registration is closed" message. Sensitivity tags require the caller's role
      to grant tag-management (`updatePatientSensitivityTags(tx, actor, ...)` takes
      `actor.canTag` and validates the tag against the known vocabulary at runtime) and stay
      editable on synced patients — separate from `updatePatient`, since the latter is refused
      outright on a synced patient. Custom field values also stay editable on a synced patient.
- [x] `canManageIntegrations` (admin only).
- [x] `src/lib/log.ts`'s redaction helpers additionally drop any `*Id`-shaped field whose value isn't
      a UUID, and refuse a small deny-list of identifier keys outright (`externalId`, `memberId`,
      `clientId`, `sourceVersionId`) so a raw FHIR/member identifier can never reach a log record
      even under a plausible-looking key name.

### PI1b — Settings › Integrations and the tab-bar drop-down
Split into PRs (2026-09-28): **PI1b-1** domain (below, done), **PI1b-2** Settings pages (done), **PI1b-3** (done)
drop-down. Re-sequenced: Submit needs "a passing test in the last 24 h", and Test connection is
PI2a (discovery + token request) — so **Submit, the residency attestation, the MFA step-up, and
pause/resume move to PI2a**, where Submit first becomes possible. Until then no code path moves a
connection out of `draft` except to `revoked`. That is the absence of a code path, not a database
rule: the lifecycle trigger lets the app role move a real draft to `pending_approval` (only with the
attestation and submission stamps, CHECK `pending_requires_submission`) and a sandbox draft to
`active`; a real connection still can't go live without a fresh operator approval and a registry
claim, both database-enforced. The "passing test in 24 h" and MFA step-up gates are app-only and
get their own tests in PI2a.
- [x] PI1b-1: client-settable fields parsed by a strict zod allow-list (`.strict()`): `displayName`
      (1–80, no control, zero-width, or bidi characters), `baseUrl`, `clientId` (visible ASCII, ≤ 255),
      `mrnIdentifierSystem`; a sandbox connection takes `displayName` only. Status, endpoint key,
      token endpoint, issuer, key reference, tenant, and approval fields never come from the
      client; an extra key is refused, not dropped. ZodErrors are mapped to field-level refusals,
      never logged or returned. (`src/domain/integrations/connections.ts`)
- [x] PI1b-1: URL rules on save (`src/integrations/fhir/url-rules.ts`): `https`; hostname only (no IP
      literal in any form the WHATWG parser accepts, userinfo, query, fragment); refuse `localhost`,
      `.localhost`, `.local`, `.internal`, `.localdomain`, `.arpa`, `.onion`, `.invalid` (except the sandbox constant),
      single-label names, and a trailing dot; port 443 or one listed in `INTEGRATION_ALLOWED_PORTS`;
      path limited to unreserved characters and `/` (no escapes, `;`, or dot segments; repeated
      slashes collapse), and a real connection may not use the sandbox host or MRN system.
      The endpoint key (scheme + host + non-default port + lowercased path, no trailing slash) is
      computed here, ahead of PI2a, because `endpoint_key` is NOT NULL.
- [x] PI1b-1: MRN identifier system refused when it names SSN, MBI/Medicare, driver's license, or
      passport (`http://hl7.org/fhir/sid/us-ssn`, `urn:oid:2.16.840.1.113883.4.1`,
      `http://hl7.org/fhir/sid/us-mbi`, `…/us-medicare`, `…/us-medicaid`, MBI/HICN OIDs `…4.927`,
      `…4.572`, DL OIDs `urn:oid:2.16.840.1.113883.4.3.*`, passport `…4.330.*` and
      `http://hl7.org/fhir/sid/passport-*` — list ⚠️ VERIFY), and must be a plain URI (http(s)
      host/path without port, query, fragment, userinfo, or escapes; `urn:oid:`; `urn:uuid:`), so
      spellings of a listed system can't slip past. (`src/integrations/fhir/identifier-rules.ts`)
- [x] PI1b-1: environment rule at save: where `syntheticDataOnly()`, a real endpoint is refused
      (only a host in `VENDOR_SANDBOX_HOSTS`, empty, OA-049); the built-in sandbox is its own create
      path with the pinned endpoint and is refused in production; the sandbox URL typed as a real
      endpoint is refused.
- [x] PI1b-1: edit (stale-edit check; name in any state but revoked; endpoint set only while a
      never-synced draft) and revoke (admin, any state → `revoked`, releases the registry claim),
      audited `integration.connection_created|updated|revoked` with normalized base URL and client
      ID (configuration, never PHI). Integration tests: `test/integration/integration-connections.test.ts`.
- [x] PI1b-2: Integrations tab live: list (name, source, status, last sync, created) for every
      role — the same summary the drop-down gives everyone, configuration only, not audited;
      "New connection" (admin) → `/settings/integrations/new` (own page, DESIGN.md §8; where only
      synthetic data is allowed it creates the built-in sandbox, taking only a name);
      `/settings/integrations/[id]` (admin; configuration, edit form with the endpoint inputs
      disabled once locked); the name field carries a "no patient information" hint.
      (`src/app/(app)/settings/integrations/**`)
- [x] PI1b-2: Revoke (admin) → `revoked`, with inline confirmation (a required "I understand"
      checkbox, checked on the server too) rather than a modal (DESIGN.md §3); the page shows the
      offboarding steps before and after revoking (real connections); runbook
      `docs/runbooks/integration-offboarding.md`.
- [x] PI1b-3: Drop-down per `specs/erp-shell.md`; states include Awaiting approval and Revoked (every
      state that exists today; the sync actions join it in PI2a/PI2b).
- [x] Every string in en/es/pt (R-11.1): PI1b-1's refusal messages, PI1b-2's pages, PI1b-3's
      drop-down.
- [x] PI1b-2: the server actions pass `syntheticDataOnly()` as the actor's `syntheticOnly` (never a
      client value), with a test (`form-state.test.ts`, incl. `APP_ENV=production` on Netlify); and
      map database errors from a connection write to a generic message — PostgreSQL's CHECK/unique
      detail ("Failing row contains …") never reaches the page or an error tracker (compliance
      review #5, #10). The connection page and the new page are admin-only (404 otherwise; e2e);
      every action re-checks the role on the server.
- Moved to PI2a (see there): Submit, the residency attestation, the MFA step-up, pause/resume.
- PI1b follow-ups (compliance review of PI1b-2, not yet scheduled): an audited "offboarding
  confirmed by/at" record for the EHR-side deregistration (SOC 2 CC6.2/CC6.3 evidence); notify the
  practice's other administrators on revoke (CC7.3), alongside the activation notice (PI1c).
  The Patients list still shows "Register patient" while a connection is outside draft/revoked
  (registering is refused then, PI1a): hide or explain it with the drop-down's state (PI2a, when a
  connection can first leave draft). The new page offers only the built-in sandbox where only synthetic data is allowed, so a reviewed
  vendor sandbox (`VENDOR_SANDBOX_HOSTS`, empty, OA-049) has no UI path yet: add one with the first
  host. Residual risk, pending owner acceptance (**OA-061**): the connection name is free text shown to
  every role, on the list and in the drop-down on every signed-in page (screen shares, screenshots);
  its only guard against patient information is the "no patient information" hint plus the length
  and invisible-character checks.
- PI2a follow-ups (compliance review of PI1b-3): the drop-down panel says "Patients sync read-only
  from {name}" for every non-revoked state; give `pending_approval` / `paused` / `error` their own
  sentence (e.g. nothing synced yet; staff can't register patients by hand meanwhile). The revoked
  sentence ("can't be edited here for now") depends on OA-048.
- PI2b: the drop-down's summary loads with the signed-in layout, which persists across client
  navigation, so other users' open sessions can show a stale state — and a relative time frozen at
  the layout's render — until a reload. Once syncs can change it: fetch the summary when the menu
  opens (or on an interval) and recompute the relative time against the browser's clock after
  mount (keep the server's render time for the first paint). That also lets the layout skip the
  per-request query on modules without a data-source tab.

### PI1c — operator approval
- [ ] The operator practice page (`/operator/practices/<id>`, pattern of BAA recording and
      University access) lists connections awaiting approval with base URL, token endpoint, client
      ID, JWKS URL, key mode, and population scope — configuration only, no PHI.
- [ ] Approve records how it was verified with the practice's EHR administrator (method code, date,
      and the contact's role at the practice), the population scope (`group_export` or
      `verified_filter`), and optionally "MRNs are 9 digits (verified)"; Reject records a reason
      code. Writes via `withTenantAsPlatform`; audited `operator.integration_approved|rejected`.
- [ ] Activation (Approve) notifies every practice administrator (in-app notice now; e-mail once
      Notifications ships).
- Moved to PI2a (Submit ships there): Submit claims the registry; a conflict refuses Submit.

### PI2a — transport, discovery, keys, test connection
Also carries PI1b's Submit, attestation, step-up, and pause/resume (re-sequenced 2026-09-28). Order
is now PI2a → PI1c (approval has nothing to approve before Submit exists); sandbox Submit becomes
possible only in PI2b, which adds the in-process sandbox a test can pass against.
- [ ] Submit (admin, draft → `pending_approval` for a real connection, → `active` for the sandbox;
      stamps `submitted_by/_at` in both cases — the drop-down treats a revoked connection as a past
      source only if it was ever submitted or synced):
      requires a passing Test connection in the last 24 h, the residency attestation (real only),
      and an MFA verification within the last 5 minutes (step-up; R-7.2.2). Tests: Submit refused
      without a recent passing test, and without a recent step-up.
- [ ] Residency attestation on Submit of a real connection: "This EHR/PM endpoint stores and
      processes data only in the United States" — stricter than § 408.051(3), which also allows
      territories and Canada (DenialDesk defaults to U.S.-only, R-3.3.1). Audited.
- [ ] Submit claims the registry; a conflict refuses Submit with "This endpoint and client ID are
      already connected" (no other practice named) and audits `integration.registry_conflict`.
- [ ] Withdraw (`pending_approval` → `draft`, releases the registry claim).
- [ ] Pause (`active` → `paused`) and resume (`paused`/`error` → `active`, MFA step-up); payer
      mapping also requires step-up.
- [ ] Revoke records a reason code (audit "why", compliance review #6a) now that it can stop a live
      sync.
- [ ] Database CHECKs `endpoint_key = lower(base_url)` and `token_endpoint_key =
      lower(token_endpoint)`, so the registry key can't be written apart from the URL (security
      review L-3; `url-rules.ts` already guarantees the equality).
- [x] `HttpsTransport` (node:https, PI2a part 1, `src/integrations/fhir/transport.ts`): TLS options
      explicit (`minVersion: 'TLSv1.2'`, a TLS 1.2 cipher list of ECDHE with AES-GCM/ChaCha20-Poly1305
      only — TLS 1.3 suites at their defaults, and TLS 1.3 is negotiated when the server offers it —
      `rejectUnauthorized: true`, `servername` = host for hostnames, Node's bundled CA store plus
      `NODE_EXTRA_CA_CERTS`, which the deployment must not set); a private `https.Agent` per
      instance, never the module-level default. Environment proxies are ignored: on Node 22.21+/24
      `node:https` honors `HTTPS_PROXY` only for the global agent with `NODE_USE_ENV_PROXY=1` at
      process start, or for an `Agent` built with `proxyEnv`; ours is private and has neither
      (tested against a fake proxy, with a control showing an agent built with `proxyEnv` does use
      it). A 3xx response is refused (`redirect_refused`), not followed. URLs that carry a username
      or password are refused; callers cannot set `Host`, `Content-Length`, `Transfer-Encoding`,
      `Connection` (or `Accept`/`Content-Type`, which the transport sets). A `Content-Encoding`
      other than identity/gzip/deflate/br is refused (`content_type_refused`). A truncated or
      prematurely closed response — compressed or not — rejects immediately (`stream.pipeline`),
      and the total-timeout signal rejects directly, whatever the streams are doing. The
      test-only options (`ca`, `allowAddress`, `resolve`, timeout/size overrides) throw outside a
      test run (`VITEST=true` or `NODE_ENV=test`; not `syntheticDataOnly()`, which fails open here). `NODE_TLS_REJECT_UNAUTHORIZED=0`
      fails at `HttpsTransport` construction (`assertTlsVerificationEnabled`). Test fixture: the
      self-signed certificate is generated with `openssl` at test time (`test/support/https-fixture.ts`);
      no key material is committed. Discovery, auth (token), and search (PI2a part 2 / PI2b) are not
      built yet; the `Transport` interface exists so PI2b's in-process `SandboxTransport` can stand
      in for `HttpsTransport` in non-production.
- [x] Content-type allow-list: the response `Content-Type` must be one of a **caller-supplied**
      `accept` list. FHIR resource calls pass `application/fhir+json` only. Documented deviation
      from a fixed FHIR-only rule: the token endpoint and `smart-configuration` (PI2a part 2) will
      also pass `application/json`, per SMART Backend Services / RFC 6749 §5.1. ⚠️ VERIFY per
      vendor that no EHR answers those with another type (e.g. `application/jwk-set+json` for JWKS).
- [x] Address guard, deny by default (PI2a part 1, `src/integrations/fhir/address-guard.ts`): a
      `node:net` `BlockList` built from the IANA IPv4 and IPv6 special-purpose registries (⚠️ VERIFY
      the exact range list against the live registries — they could not be fetched from the build
      environment; cited range-by-range in the file) plus explicit `168.63.129.16` (Azure
      WireServer, not IMDS; IMDS `169.254.169.254` is inside the link-local block). **IPv6 must be
      inside the global-unicast allocation `2000::/3`; everything else is denied**, then the
      non-globally-reachable ranges inside it: `2001::/23` (RFC 6890; covers Teredo, benchmarking
      `2001:2::/48`, ORCHID `2001:10::/28`, ORCHIDv2 `2001:20::/28`, DETs `2001:30::/28`, and the
      protocol-anycast sub-assignments), `2001:db8::/32`, `2002::/16` (**6to4 is denied outright**,
      deprecated by RFC 7526, rather than decoded and allowed), `2620:4f:8000::/48`, and
      `3fff::/20`; `5f00::/16` (SRv6) and the rest are outside `2000::/3` and listed as well. IPv4-mapped,
      IPv4-compatible, IPv4-translated and NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`) are therefore
      refused even when they carry a public IPv4 — **a deployment behind DNS64/NAT64 would need a
      deliberate, signed-off exception**. The embedded-IPv4 decode is still run as defense in depth.
      Applied to **every** DNS-resolved address in the `lookup` hook at connect time (5 s DNS timeout;
      the underlying `dns.lookup` cannot be cancelled, so a timeout stops waiting for it rather than
      stopping it), refusing the whole resolution if any candidate address is blocked so a
      DNS-rebinding attempt can't slip one blocked address past a checked one; and to **IP-literal
      hosts**, for which Node never calls `lookup`: `request()` re-parses the URL with WHATWG `URL`
      (so `2130706433` and `0x7f.1` normalize to `127.0.0.1`) and applies the same check before
      connecting. Tests: `127.0.0.1`, `2130706433`, `0x7f.1`, `169.254.169.254`, `168.63.129.16`,
      `[::1]`, `[::ffff:127.0.0.1]` are refused with a live server listening. ⚠️ One documented
      Node quirk (verified on v22.22.2; CI and Docker use Node 24 — re-verify there): adding
      `::ffff:0:0/96` (IPv4-mapped) as a `BlockList` IPv6 subnet also blocks every plain IPv4
      check, so that range is not added directly; the `2000::/3` requirement refuses it instead.
      Host WHATWG-normalization (`url-rules.ts`, PI1b) happens before a connection is ever saved;
      this guard runs on whatever host reaches it. One unit test per listed range (first and last
      address of every IPv4 range; a sample of every IPv6 range checked against the list itself,
      so a range that the `/3` rule would also refuse still needs its own entry to pass).
- [x] Limits (M1), what the transport enforces today (`address-guard.ts` + `transport.ts`): 5 s DNS
      timeout; 30 s total per request, DNS through body — the `AbortSignal.timeout` signal both
      aborts the request and rejects the call directly, separate from any socket idle timeout
      (which a slow trickle would reset forever); 10 MB per response **after** decompression
      (gzip/deflate/br, tested for each), streamed and aborted over the cap rather than buffered;
      truncated compressed responses reject rather than hang. Test-only overrides for these are
      refused outside tests.
- [ ] Limits (M1), run-level, **PI2b** wires these into the sync loop: `MAX_BUNDLE_ENTRIES`
      (`assertBundleEntryLimit`, Bundle ≤ 1,000 entries), `RunBudget` (12 min / 5,000 requests /
      500 MB per run) and `PagingLoopGuard` (same `next` URL twice) exist in `limits.ts` with unit
      tests, and `assertNextIsSameOrigin` refuses a cross-origin `next`, but none of them is called
      from a sync loop yet.
- [ ] Callers of the transport (PI2a part 2 discovery/token, PI2b search) must **never log or store
      a non-2xx response body**, and must emit `address_refused`, `tls_failed` and
      `redirect_refused` as security events (audit/alert, IDs only, no URL or host). Not built in
      part 1; carried into those PRs' acceptance criteria.
- [x] Decided (reviewer N3, PR #83): **a non-2xx response resolves with its status and the body is
      discarded unread, whatever its `Content-Type` or `Content-Encoding`** (`transport.ts`; a 3xx is
      still `redirect_refused`; a 2xx with a wrong type is still `content_type_refused`). So a
      401/403/5xx is no longer reported as `content_type_refused`, callers branch on `status`
      (`outcomeForStatus` in `outcomes.ts`), and an error body can't reach memory, a log, or an error.
      `TransportResponse.body` is `""` for every non-2xx. Tests: `transport.test.ts` ("non-2xx
      responses"). Still open from #83's reviews: an exact-cap boundary test, isolated tests for each
      timeout path, refusing a set `NODE_EXTRA_CA_CERTS` in production, and the IPv4 AS112/AMT ranges
      (⚠️ VERIFY with the registry pass).
- [x] Discovery (`src/integrations/fhir/discovery.ts`, `discovery.test.ts`): `.well-known/smart-configuration` and `metadata`; require `fhirVersion` 4.0.1,
      `private_key_jwt`, an allowed alg (ES384 or RS384), a token endpoint passing the URL rules,
      Patient `_lastUpdated` search, Coverage `patient` search. Scope style from `capabilities`:
      `permission-v2` → `system/Patient.rs system/Coverage.rs system/Organization.rs`; else
      `permission-v1` → `.read`. Issuer recorded (normalized base URL + CapabilityStatement
      `implementation.url` when present). Built as: `metadata` first, then `smart-configuration`, both
      through the injected `Transport`; issuer is `<base URL>` or `<base URL> <implementation.url>`
      (the second only when it passes the URL rules); the discovered token endpoint must pass
      `checkBaseUrl` and may use the sandbox host only for a sandbox connection; the connection's key
      algorithm must be in the server's list. Test connection pins `token_endpoint`,
      `token_endpoint_key`, and `issuer` on a still-draft connection; past draft a different token
      endpoint is refused (`smart_config_invalid`, audit detail `token_endpoint_changed`).
- [x] Token (`auth.ts`, `src/lib/crypto/jwt-sign.ts`): assertion `iss = sub = client_id`, `aud` = pinned token endpoint, `iat`, `exp` ≤ iat +
      5 min, unique `jti`, header `alg` from the allow-list {ES384, RS384}, `kid`, `typ: JWT`;
      node:crypto signing. Response must have `token_type` bearer and granted scopes including the
      required ones (`scope_insufficient` otherwise, reported as the `capability_missing` outcome).
      Token in memory only, re-requested on expiry or one 401 (`AccessTokenCache`; the sync loop that
      uses it is PI2b). `exp` is `iat + 4 min` (skew margin under the 5-minute cap); `AccessToken`
      redacts itself under JSON, string, template, and `util.inspect`.
- [ ] Keys (R-7.3.4, R-7.3.5) — **partly built, blocked on a migration (PI2a part 2 report):** the
      adapter (`keys.ts`: `SigningKeyStore`, `LocalEncryptedKeyStore` for `syntheticDataOnly()` —
      ES384 per connection, PKCS#8 encrypted with the field-encryption helpers and bound by AAD to its
      connection, the ciphertext being `key_ref` — and an `AzureKeyVaultKeyStore` stub that fails
      closed) exists and is tested; what's missing is writing `key_mode`/`key_ref` (no app-role
      grant, drizzle/0039) at connection creation and clearing them on revoke.
      **Per-connection key by default** — production creates a
      non-exportable Azure Key Vault key per connection at creation, published at
      `/.well-known/jwks/<connection-uuid>.json`; a shared key only as a documented per-vendor
      exception (`key_mode = shared_vendor_exception` + reason code; e.g. a vendor with one client
      per app, ⚠️ VERIFY), set only by the operator at approval (never client-settable) and audited.
      Connection creation is rate-limited per practice (each one creates a Key Vault key).
      Pre-production uses one shared key from a functions-only hosting secret,
      distinct from production. Production refuses to start integrations if an env signing key is
      present (Key Vault only). Annual rotation with current + next `kid`.
- [ ] JWKS routes — **allow-list built (`pickPublicJwkFields`, tested that `d`, `p`, `q`, `dp`, `dq`,
      `qi`, `k` never appear); the route is blocked on a migration**: it is unauthenticated, so it has
      no tenant to set, and `integration_connections` is `FORCE ROW LEVEL SECURITY`, so it needs a
      SECURITY DEFINER lookup returning only `(status, key_ref)` for one connection id. Public-field allow-list (`kty`, `crv`, `x`, `y`, `n`, `e`, `kid`, `alg`, `use`),
      own rate-limit bucket, `Cache-Control: public, max-age=300`; 404 for unknown or revoked.
- [ ] Test connection — **domain service built** (`src/domain/integrations/test-connection.ts`; unit
      tests for discovery/token, integration tests in `test/integration/test-connection.test.ts`;
      the Settings action and button wait for key provisioning): discovery + one token request, no patient data; its own rate-limit bucket
      (per connection and per practice); outcomes collapsed to `ok`, `unreachable`, `tls_failed`,
      `not_fhir_r4`, `smart_config_invalid`, `auth_refused`, `capability_missing`; audited
      (`integration.connection_tested`, configuration and codes only; `integration.transport_refused`
      with `{ code }` for `address_refused`, `tls_failed`, `redirect_refused`; `security.rate_limited`).
      Buckets `integration_test_connection` (5 per 10 min) and `integration_test_practice` (20 per
      10 min). The network calls run with no database transaction open. **Record of the result:** no
      column exists, so "a passing test in the last 24 h" is derived from the audit log
      (`hasRecentPassingTest`: newest `ok` event in the window whose base URL, client ID, and token
      endpoint still match the connection; a later failing test doesn't cancel it); Submit will call it.
      Messages in en/es/pt (`integrations.test.*`).

### PI2b — sync engine, sandbox, jobs, history, payer mapping
- [ ] The transport is chosen from `is_sandbox` only (never the host), and a sandbox run is refused
      unless `syntheticDataOnly()`, so `SYN` patients never land in a production tenant (compliance
      review #13, security review L-1).
- [ ] Refuse SSN- and MBI-shaped MRN values at ingest, whatever the identifier system (security
      review M-1: a deny-list can't know a vendor's local SSN OID); also check `Identifier.type`
      (v2-0203 SS, MB, MC, DL, PPN).
- [ ] Jobs: payload `{ runId }` only, with an HMAC-SHA256 header (body + timestamp, 5-min window)
      keyed by `INTEGRATION_JOB_SECRET`. The worker claims the run with SECURITY DEFINER
      `integration_claim_run(run_id)` (only a `queued` run; returns `tenant_id, connection_id`;
      EXECUTE granted to a `denialdesk_jobs` role, not `denialdesk_app`; also requires the
      connection to be `active`; HMAC compared in constant time). Tests: unsigned call,
      stale timestamp, and forged or already-claimed `runId` refused.
- [ ] All sync reads and writes run as `denialdesk_app` under a new
      `withTenantAsSystem(tenantId, runId)` (sets tenant, run, and connection settings; never
      `withTenantAsPlatform` or `systemDb`). Audit actor: a fixed per-environment integration
      service-principal UUID in reviewed code, seeded by migration as a `users` row that cannot
      sign in, has no memberships and no roles (keeps the `audit_events.actor_user_id` FK; a test
      asserts the FK stays); the admin who pressed Sync now in
      `metadata.triggeredBy`; reason `ehr_sync`; "where" = runtime function id and host.
      `app.sync_run_id`/`app.sync_connection_id` must be set with `set_config(name, value, true)`
      (transaction-local — `is_local = true`), the same way PI1a's own tests set them, never with
      `is_local = false`/session-level: a pooled connection reused by another request afterwards
      must not inherit a stale run/connection setting that `patients_synced_readonly` would then
      trust.
- [ ] Every run first checks the connection's issuer against discovery; a mismatch fails the run
      before any upsert (`issuer_mismatch`); a changed token endpoint sets `error`.
- [ ] Search: `Patient?_lastUpdated=ge<watermark>&_count=100`; Coverage for a page's patients by POST
      `Coverage/_search` (`patient=<id>`) where supported so FHIR ids stay out of request URLs
      (⚠️ VERIFY support), else GET (documented: the URL goes only to the practice's own EHR);
      Coverage-only changes by `Coverage?_lastUpdated` when advertised; `_elements` when advertised.
- [ ] Retries: 3, exponential backoff, `Retry-After` capped at 60 s; 401/403/`invalid_client` → `error`.
- [ ] Mapping as in the table below; a record failing a required rule is skipped with a code, never
      partially guessed. Server timestamps are clamped (future beyond 5 min skew → our now; the
      watermark never exceeds our clock). `OperationOutcome.issue.code` kept only if it is an R4
      IssueType code, else `unknown`; `diagnostics` never stored.
- [ ] Upsert keyed by `(tenant_id, source_connection_id, external_id)`; no regression on
      `meta.lastUpdated`; same `versionId` = unchanged. Linking: MRN **and** birth date equal to a
      manual patient → linked (`patient.linked_to_source`); MRN equal, birth date different →
      `mrn_conflict` with the manual patient's ID; otherwise a new row. No fuzzy matching.
- [ ] Page-by-page commits; watermark advances only on success to the first page's server time minus
      5 minutes. One run per connection (partial unique on `(tenant_id, connection_id)` while
      `queued`/`running`); no heartbeat for 20 min → `abandoned`. Sync now once a minute.
- [ ] Sync never writes `claims` or claim versions; the 837P builder (claims C3) snapshots patient
      demographics into the claim version at submission (R-3.10.3).
- [ ] Payer mapping page (step-up): payor keys (`Organization/<id>`, Organization name) → practice
      payer or unmapped; one audited update of affected patients.
- [ ] Sync history (`/settings/integrations/[id]/runs`, admin): counts and codes; issue rows link
      to DenialDesk patient IDs.
- [ ] Synthetic sandbox (base URL `https://sandbox.fhir.denialdesk.invalid/r4`, in-process
      `SandboxTransport`, only when `syntheticDataOnly()`): token endpoint verifies the assertion
      (signature, alg allow-list, `aud`, `exp`, `jti` remembered until `exp`); deterministic
      `SYN-` resources with a synthetic `meta.tag`, multi-page, and one each of: inactive,
      `replaced-by`, partial birth date, dependent coverage, unmapped payor, non-Organization payor,
      `R` label, `HIV` label, unknown label, minor, SSN-shaped MRN.
- [ ] Test: `APP_ENV=production` on Netlify refuses a real endpoint and allows only the sandbox.
- [ ] Update `docs/data-sources.xlsx` with the FHIR R4 source.

### PI3 — scheduled sync and source-state hardening
- [ ] Scheduled every 15 minutes (OA-056): SECURITY DEFINER `integration_enqueue_due_runs()`
      (EXECUTE: `denialdesk_jobs`) inserts `queued` runs for due `active` connections and returns run
      IDs only; the scheduled function posts one signed job per run ID. Isolation test: the
      function exposes no other column and `denialdesk_app` cannot execute it.
- [ ] `source_status`: `inactive`, `merged` (`replaced-by`), `gone` (404/410 in a weekly
      reconciliation, which also re-reads Coverage when Coverage `_lastUpdated` is not advertised).
      Nothing is deleted; synced rows follow the §9.2 retention of the claims they support.
- [ ] Three consecutive failed runs → `error`. SIEM alerts at the Azure cutover (R-7.5.3):
      activation, revocation, registry conflict, token-endpoint change, issuer mismatch, repeated
      failures, unusually large runs.

### PI4 — Bulk Data (before the first real practice; OA-050)
- [ ] `Group/<practice group>/$export?_type=Patient,Coverage,Organization&_since=…`; the status URL
      and every output URL pass the URL rules and address guard; the bearer token is sent only to
      the FHIR origin (`requiresAccessToken=true` files must be on it); other output hosts are
      allowed only if listed per vendor in reviewed code; NDJSON line and file caps; the export is
      deleted on the server when done.

## Field mapping (FHIR R4 / US Core 6.1.0 → `patients`)
Must-support (MS) notes ⚠️ VERIFY against the published StructureDefinitions at build.

| Column | FHIR source | US Core 6.1.0 | Rule |
|---|---|---|---|
| `external_id` | `Patient.id` | — | Required; FHIR `id` syntax, ≤ 64 chars |
| `source_version_id`, `source_last_updated` | `Patient.meta.versionId`, `.lastUpdated` | not MS | Clamped; no-regression rule |
| `mrn` | `Patient.identifier` whose `system` = the connection's MRN system | `identifier` 1..*, MS `system`, `value` | Exactly one, else `mrn_missing`/`mrn_ambiguous`. `ddd-dd-dddd` → `mrn_looks_like_ssn`; bare 9 digits too unless the operator recorded "MRNs are 9 digits"; MBI-shaped (CMS format, ⚠️ VERIFY) → `mrn_looks_like_mbi` |
| `first_name`, `last_name` | `Patient.name` (official, else usual, else the only one): `given[0]`, `family` | MS | Missing → `name_incomplete` |
| `birth_date` | `Patient.birthDate` | MS | Full date, 1900..today; partial → `birthdate_incomplete`. Under 18 → "minor" tag **suggested** to administrators, never set automatically |
| `sex` | `Patient.gender` | 1..1 | female → F, male → M, other/unknown → U (837P DMG03) |
| `address_line1`, `city`, `state`, `postal_code` | `Patient.address` (home or no use, current) | MS | Invalid → all four null + `address_incomplete` |
| `source_status` | `Patient.active`, `Patient.link` `replaced-by` | not MS | PI3 |
| `source_restricted`, `source_sensitivity` | `Patient.meta.security` | — | Restricted if confidentiality `R`/`V`, an ActCode sensitivity code (`HIV`, `PSY`, `ETH`, `SDV`, `42CFRPart2`; ⚠️ VERIFY), or **any unrecognized label**. Codes stored as a fixed vocabulary (`unknown` for unrecognized) |
| `primary_payer_id`, `coverage_payor_key` | primary Coverage `payor` | 1..1 MS | Must reference `Organization`, else `needs_review`; payer only by explicit mapping (CLAUDE.md #9) |
| `member_id_enc`, `member_id_last4` | primary Coverage `identifier` type MB, else `subscriberId` | MS | Encrypted (R-7.3.3); null unless coverage is `mapped`/`unmapped` |
| `coverage_status` | primary Coverage selection | — | `none` / `mapped` / `unmapped` / `needs_review` |
| `phone` | not synced (null) | — | OA-047 |

Primary Coverage = active, beneficiary this patient, period covering today, lowest `order`,
relationship `self`; ties with no `order`, dependents (OA-055), or a non-Organization payor →
`needs_review`, no payer, no member ID. **Not synced:** telecom, e-mail, race, ethnicity, birth sex,
gender identity, language, contacts, practitioners, SSN, clinical resources.

## Data / API changes
Migration numbers: next free at build time (today 0039+).

- `patients` + `source` (`manual`/`fhir`), `source_connection_id`, `external_id`,
  `source_version_id`, `source_last_updated`, `synced_at`, `source_status`, `source_restricted`,
  `source_sensitivity text[]`, `coverage_status`, `coverage_payor_key`. New unique
  `patients_tenant_id_key (tenant_id, id)` as an FK target. Unique `(tenant_id,
  source_connection_id, external_id) WHERE source = 'fhir'`; composite FK to connections.
  `member_id_enc`/`member_id_last4` become nullable with CHECK: manual rows keep them NOT NULL (today's
  behavior); `fhir` rows have them set iff `coverage_status IN ('mapped','unmapped')`. Readers of
  the member ID handle null.
- `integration_connections`: `id`, `tenant_id`, `target_table` (`patients`), `kind` (`fhir_r4`),
  `is_sandbox`, `display_name`, `base_url`, `endpoint_key`, `token_endpoint`, `issuer`, `client_id`,
  `mrn_identifier_system`, `mrn_nine_digits_verified`, `key_mode`
  (`per_connection`/`shared_vendor_exception`/`preprod_shared`), `key_ref`, `key_exception_reason`,
  `status` (`draft`/`pending_approval`/`active`/`paused`/`error`/`revoked`), `status_reason`,
  `population_scope`, `us_residency_attested_by/_at`, `submitted_by/_at`, `approved_by/_at`,
  `approval_method`, `revoked_by/_at`, watermarks, `last_success_at`, `bulk_group_id`, `has_synced`,
  `created_by/_at`, `updated_by/_at`. Partial unique `(tenant_id, target_table) WHERE status NOT IN
  ('draft','revoked')`.
- `integration_endpoint_registry` (global, definer-only; above).
- `integration_payer_mappings`: `tenant_id`, `connection_id`, `payor_key`, `payor_name`, `payer_id`;
  unique `(tenant_id, connection_id, payor_key)`.
- `integration_sync_runs`: `id`, `tenant_id`, `connection_id`, `trigger`, `triggered_by`, `status`
  (`queued`/`running`/`succeeded`/`failed`/`abandoned`), times, heartbeat, watermarks, counts,
  `issue_codes text[]` (fixed vocabulary + R4 IssueType), `http_status`. Updatable only while
  `queued`/`running` (trigger).
- `integration_sync_issues` (append-only): `tenant_id`, `run_id`, `code`, `patient_id` (nullable).
- Routes: `/.well-known/jwks/<connection-uuid>.json`, `/.well-known/jwks.json` (pre-production
  shared key). Pages under `/settings/integrations/**`; operator approval on the operator practice
  page. No patient identifiers in any URL.
- Environment: `INTEGRATION_SIGNING_KEY`/`_KEY_ID` (pre-production only, functions-only secret);
  `INTEGRATION_JOB_SECRET` (Key Vault in production); `INTEGRATION_ALLOWED_PORTS` (default `443`).

**Classification (§9.1):** synced demographics, member ID, `external_id`, `coverage_payor_key` —
Restricted PHI (identifiers never logged or audited); `source_restricted`/`source_sensitivity` —
Restricted-Sensitive PHI; connections, registry, mappings — Confidential configuration; runs and
issues — Internal; JWKS — Public; private signing keys and the job secret — **Secret** (credentials;
outside the §9.1 data classes, R-7.3.5).

**Audit events** (never MRNs, names, external ids, tokens, query strings):
`integration.connection_created|updated|submitted|tested|activated|paused|resumed|errored|revoked`
with old/new base URL, token endpoint host + path, and client ID — always the normalized value
with no query string or fragment (configuration, not PHI);
`integration.registry_conflict`, `integration.payer_mapping_changed`,
`operator.integration_approved|rejected`, `integration.sync_started|completed|failed` (counts; the
run-level `sync_completed` is the record of receipt for unchanged and skipped resources),
`patient.synced_created|synced_updated|linked_to_source|source_inactivated|source_merged|source_gone`
(patient, connection, run IDs; changed field names).

## Legal rules used
None (no legal clock). Residency is enforced by attestation and environment rules.

## Out of scope
Writing to the EHR; clinical resources; other connectors (HL7 v2, CSV); other tables; fuzzy
matching and merge tooling; dependents and secondary coverage (patients P2); SMART user launch;
real vendor endpoints in pre-production.

## Open questions (docs/owner/OWNER_ACTION_ITEMS.xlsx)
- **OA-045** Residency: attestation enough, or vendor confirmation? BAA coverage for pulling from
  the EHR (counsel)? Also vendor screening for foreign-country-of-concern ties (R-3.3.6) and
  offshore access to the EHR's data (R-3.3.3).
- **OA-046** Retire manual registration; unmatched legacy manual patients stay read-only?
- **OA-047** Phone and e-mail not synced.
- **OA-048** Disconnect or switch EHR (a new endpoint is a new connection): synced patients stay
  read-only, revert to manual, or re-link to the new connection?
- **OA-049** Vendor sandboxes: their identifiers lack `SYN`, and there is no prefixing on ingest, so
  they stay unusable until the owner decides how their synthetic origin is proven.
- **OA-050** Bulk Data (PI4) before the first real practice.
- **OA-051** Who at the practice confirms the population scope at approval.
- **OA-052** Restricted-in-source patients until patients P4 masking; whether any practice is a
  42 CFR Part 2 program (human decision).
- **OA-053** MRN conflicts: EHR-only fix or an admin tool.
- **OA-054** Requirement ID for §8.8. **OA-055** Dependents' coverage. **OA-056** Sync interval.
- **OA-057** Confirm the 2026-09-28 coordinator decisions above.

## Implementation plan
**builder** builds everything; **edi-x12-specialist** reviews the mapping for 837P fit (DMG03,
N3/N4, NM109) and the C3 snapshot dependency; **florida-rules-engine** not involved (no legal
values). PRs (< ~400 lines each): PI1a data layer → PI1b Settings UI + drop-down (PI1b-1 domain,
PI1b-2 pages, PI1b-3 drop-down; all done) → PI2a transport, guard, discovery, keys, JWKS, test,
Submit/attestation/step-up/pause-resume → PI1c operator approval (needs submitted connections) →
PI2b sync, jobs, sandbox, history, payer mapping (sandbox Submit needs the in-process sandbox to
test against) → PI3 → PI4. Runbooks with PI2a: key rotation and **integration key compromise**
(revoke at each EHR, customer notice within 72 h per R-3.4.2, FIPA 30-day clock per R-3.4.1); with
PI1b: offboarding a connection.

### Files
- `drizzle/00NN_*.sql` (+ Netlify mirror, `src/db/schema.ts`); `src/db/tenant.ts`
  (`withTenantAsSystem`).
- `src/domain/integrations/`: `connections.ts` (lifecycle, zod allow-list, audit), `registry.ts`,
  `approval.ts` (operator), `payer-mappings.ts`, `sync-runs.ts`, `sync.ts`, `principal.ts`.
- `src/integrations/fhir/`: `transport.ts`, `address-guard.ts`, `url-rules.ts`, `discovery.ts`,
  `auth.ts`, `search.ts`, `map-patient.ts`, `map-coverage.ts`, `identifier-rules.ts`,
  `security-labels.ts`, `types.ts`, `vendor-sandboxes.ts`, `sandbox/`.
- `src/lib/crypto/jwt-sign.ts`; `src/platform/netlify/jobs.ts`, `src/platform/azure/` (Key Vault
  signer, worker; at cutover).
- `src/app/.well-known/jwks/**`; `src/app/(app)/settings/integrations/**`; operator practice page;
  `src/components/shell/DataSourceMenu.tsx`; `navigation.ts`; `AppShell.tsx`; patients pages.
- `src/auth/permissions.ts`, step-up helper; `src/lib/audit.ts`; i18n (en/es/pt).

### Tests
- Unit: every address range and embedded-IPv4 form; URL/host rules; identifier-system refusals and
  SSN/MBI shapes; security labels; mapper skip codes; JWT claims, alg allow-list, `jti`; token
  response checks; limits and `paging_loop`; timestamp clamping; zod `.strict()`; environment
  matrix incl. `APP_ENV=production` on Netlify; production refuses an env signing key.
- Integration: isolation for every table; composite FKs; both triggers; registry uniqueness across
  practices and definer-only access; claim/enqueue functions (grants, forged run, non-queued run);
  `withTenantAsSystem`; upsert/link/conflict; issuer mismatch; audit rows free of MRN, name,
  external id, URL query.
- E2E (sandbox): admin creates, tests, submits (sandbox skips approval), syncs; chart read-only;
  specialist sees status only; operator approval flow on a real-type connection with a stubbed
  transport; drop-down at 1024px.
- Log capture over a full sandbox sync: no resource content, tokens, paths with ids, or ZodErrors.

### Risks
- Vendor variance (search, scopes, key registration) — ⚠️ VERIFY per vendor; Bulk Data in PI4.
- Netlify limits (⚠️ VERIFY ~15 min background, ~30 s scheduled): 12-min run budget, idempotent
  re-runs.
- One audit event per patient on initial load (batched).
- `app.sync_*` settings and the owner-role connection remain settable by a compromised app
  (separate DB roles: open project decision).
- Operator approval is manual and single-person (single-administrator risk already open).
