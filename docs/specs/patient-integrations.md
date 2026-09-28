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
      built-in sandbox URL/key and can never reach `pending_approval` (`is_sandbox` cannot be
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
      row) whenever `app.sync_run_id` is set. Message added to `TRIGGER_MESSAGE_FORMATS` (ADR 0006).
- [x] Trigger on `integration_connections` enforces the lifecycle and editability rules above: the
      app role cannot write approval columns (column grants) or move `pending_approval → active`
      (also checked in the trigger, as a second layer, by role name); activation additionally
      requires a *fresh* approval (`approved_at` must change on the same update, not merely be
      carried over); `revoked` is terminal; the endpoint field set (`base_url`, `endpoint_key`,
      `token_endpoint`, `token_endpoint_key`, `issuer`, `client_id`, `mrn_identifier_system`) is
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
      ⚠️ The WHATWG-normalization algorithm itself is `src/integrations/fhir/url-rules.ts` (PI2a);
      PI1a stores whatever `endpoint_key`/`token_endpoint_key` the caller computes.
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
      a connection is outside `draft`/`revoked` (checked with `SELECT ... FOR SHARE`; the
      synced-patient refusal is checked first, so editing a specific synced patient reports that,
      not the generic "registration is closed" message). Sensitivity tags require the caller's role
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
- [ ] Integrations tab live: list (name, status, last sync); "New connection" →
      `/settings/integrations/new` (own page, DESIGN.md §8); `/settings/integrations/[id]`.
- [ ] Client-settable fields parsed by a strict zod allow-list (`.strict()`): `displayName` (≤ 80,
      "no patient information" hint), `baseUrl`, `clientId` (≤ 255), `mrnIdentifierSystem`,
      `usResidencyAttested`. Status, token endpoint, issuer, key reference, tenant, and approval
      fields never come from the client. ZodErrors are mapped to field codes, never logged or returned.
- [ ] URL rules on save: `https`; hostname only (no IP literal, userinfo, query, fragment); refuse
      `localhost`, `.local`, `.internal`, `.home.arpa`, `.invalid` (except the sandbox constant),
      single-label names, and a trailing dot; port 443 or one listed in `INTEGRATION_ALLOWED_PORTS`.
- [ ] MRN identifier system refused when it names SSN, MBI/Medicare, driver's license, or passport
      (`http://hl7.org/fhir/sid/us-ssn`, `urn:oid:2.16.840.1.113883.4.1`,
      `http://hl7.org/fhir/sid/us-mbi`, `http://hl7.org/fhir/sid/us-medicare`, DL OIDs
      `urn:oid:2.16.840.1.113883.4.3.*`, `http://hl7.org/fhir/sid/passport-*` — list ⚠️ VERIFY).
- [ ] Residency attestation on Submit of a real connection: "This EHR/PM endpoint stores and
      processes data only in the United States" — stricter than § 408.051(3), which also allows
      territories and Canada (DenialDesk defaults to U.S.-only, R-3.3.1). Audited.
- [ ] Submit, resume, attestation, and payer mapping require an MFA verification within the last
      5 minutes (step-up; R-7.2.2). Activation notifies every practice administrator (in-app notice
      now; e-mail once Notifications ships).
- [ ] Revoke (admin, confirm dialog) → `revoked`; the page shows the offboarding steps (deregister
      the client at the EHR).
- [ ] Drop-down per `specs/erp-shell.md`; states include Awaiting approval and Revoked.
- [ ] Every string in en/es/pt (R-11.1).

### PI1c — operator approval
- [ ] The operator practice page (`/operator/practices/<id>`, pattern of BAA recording and
      University access) lists connections awaiting approval with base URL, token endpoint, client
      ID, JWKS URL, key mode, and population scope — configuration only, no PHI.
- [ ] Approve records how it was verified with the practice's EHR administrator (method code, date,
      and the contact's role at the practice), the population scope (`group_export` or
      `verified_filter`), and optionally "MRNs are 9 digits (verified)"; Reject records a reason
      code. Writes via `withTenantAsPlatform`; audited `operator.integration_approved|rejected`.
- [ ] Submit claims the registry; a conflict refuses Submit with "This endpoint and client ID are
      already connected" (no other practice named) and audits `integration.registry_conflict`.

### PI2a — transport, discovery, keys, test connection
- [ ] `HttpsTransport` (node:https): TLS options explicit (`minVersion: 'TLSv1.2'`,
      `rejectUnauthorized: true`, `servername` = host, system CAs only); environment proxies ignored;
      no redirects; `application/fhir+json` only.
- [ ] Address guard, deny by default: a `node:net` `BlockList` built from the IANA IPv4 and IPv6
      special-purpose registries plus explicit `168.63.129.16`; only global unicast passes; embedded
      IPv4 decoded and re-checked (IPv4-mapped, IPv4-compatible, NAT64 `64:ff9b::/96`, 6to4
      `2002::/16`, Teredo `2001::/32`); applied in the `lookup` hook to **every** resolved address at
      connect time; host WHATWG-normalized before checks. Unit test per range.
- [ ] Limits (M1): 5 s DNS timeout; 30 s total per request (DNS through body); 10 MB per response
      after decompression; ≤ 1,000 entries per Bundle; per run: 12 min wall clock, 5,000 requests,
      500 MB; a repeated `next` URL stops the run (`paging_loop`); `next` must be same origin.
- [ ] Discovery: `.well-known/smart-configuration` and `metadata`; require `fhirVersion` 4.0.1,
      `private_key_jwt`, an allowed alg (ES384 or RS384), a token endpoint passing the URL rules,
      Patient `_lastUpdated` search, Coverage `patient` search. Scope style from `capabilities`:
      `permission-v2` → `system/Patient.rs system/Coverage.rs system/Organization.rs`; else
      `permission-v1` → `.read`. Issuer recorded (normalized base URL + CapabilityStatement
      `implementation.url` when present).
- [ ] Token: assertion `iss = sub = client_id`, `aud` = pinned token endpoint, `iat`, `exp` ≤ iat +
      5 min, unique `jti`, header `alg` from the allow-list {ES384, RS384}, `kid`, `typ: JWT`;
      node:crypto signing. Response must have `token_type` bearer and granted scopes including the
      required ones (`scope_insufficient` otherwise). Token in memory only, re-requested on expiry
      or one 401.
- [ ] Keys (R-7.3.4, R-7.3.5): **per-connection key by default** — production creates a
      non-exportable Azure Key Vault key per connection at creation, published at
      `/.well-known/jwks/<connection-uuid>.json`; a shared key only as a documented per-vendor
      exception (`key_mode = shared_vendor_exception` + reason code; e.g. a vendor with one client
      per app, ⚠️ VERIFY), set only by the operator at approval (never client-settable) and audited.
      Connection creation is rate-limited per practice (each one creates a Key Vault key).
      Pre-production uses one shared key from a functions-only hosting secret,
      distinct from production. Production refuses to start integrations if an env signing key is
      present (Key Vault only). Annual rotation with current + next `kid`.
- [ ] JWKS routes: public-field allow-list (`kty`, `crv`, `x`, `y`, `n`, `e`, `kid`, `alg`, `use`),
      own rate-limit bucket, `Cache-Control: public, max-age=300`; 404 for unknown or revoked.
- [ ] Test connection: discovery + one token request, no patient data; its own rate-limit bucket
      (per connection and per practice); outcomes collapsed to `ok`, `unreachable`, `tls_failed`,
      `not_fhir_r4`, `smart_config_invalid`, `auth_refused`, `capability_missing`; audited.

### PI2b — sync engine, sandbox, jobs, history, payer mapping
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
values). PRs (< ~400 lines each): PI1a data layer → PI1b Settings UI + drop-down → PI1c operator
approval → PI2a transport, guard, discovery, keys, JWKS, test → PI2b sync, jobs, sandbox, history,
payer mapping → PI3 → PI4. Runbooks with PI2a: key rotation and **integration key compromise**
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
