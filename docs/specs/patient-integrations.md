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
  real data. **Until PI4 can apply `population_scope`, the sync fails closed:** any run whose connection is
  not the synthetic sandbox is refused (`population_scope_unenforced`) before a transport is asked for, and
  Sync now refuses it with a message before anything is queued (compliance B1, security M1).

## Connection lifecycle
`draft` → (admin **Submit**: passing test in the last 24 h, residency attested, MFA step-up) →
sandbox: `active`; real: `pending_approval` (registry claimed) → operator **Approve** → `active` (all
practice administrators notified (notice pending, PI1c open item)) or **Reject** (reason code) → `draft` (registry released).
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
- Moved to PI2a (see there): Submit, the residency attestation, the MFA step-up, pause/resume
  (step-up, pause/resume, withdraw, and the revoke reason are done there; Submit and the attestation wait
  on Test connection).
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
**No migration and no privilege change** (R-15.9 not triggered): every write goes through
`withTenantAsPlatform` (the connection owner's privileges with `app.tenant_id` set, the path the
operator's BAA and University-access writes already use), so the approval columns stay ungranted to
`denialdesk_app`. The 0040 fresh-approval trigger and the 0039 registry functions apply to the owner
as they do to anyone: the trigger requires a fresh `approved_at` and a registry entry for
`pending_approval → active`, and `integration_registry_release` (tenant-checked against
`app.tenant_id`, which the platform context sets) refuses to release until the connection is `draft`
or `revoked`. Domain: `src/domain/integrations/approval.ts`, vocabularies in `approval-codes.ts`.
- [x] Operator queue and practice page: `/operator/integrations` lists every customer practice's
      `pending_approval` connections (oldest submission first; one platform transaction per practice,
      three at a time, because the tenant policy applies to the owner unless it bypasses row-level
      security and the connection pool is small) and the operator practice page (`/operator/practices/<id>`)
      lists that practice's; each links to the review page
      `/operator/practices/<id>/integrations/<connectionId>`, which shows base URL, token endpoint,
      issuer, client ID, MRN identifier system, JWKS address, key mode, population scope (set at
      approval), the practice's BAA status, the submission time and the residency confirmation time —
      configuration only, no PHI, no key reference. `getPendingApproval` finds a connection only under
      its own practice. Viewing the queue and a review page is audited `operator.integration_viewed`
      (operator, the operator's `session_id`, and for the queue the count, for a review the practice
      and connection IDs; configuration only, not PHI; `auditIntegrationViewed`).
- [x] Approve (`approveConnection`) records how it was verified with the practice's EHR administrator:
      a **method code** (`phone_callback`, `video_call`, `written_confirmation`, `vendor_portal`), the
      **date**, and the **contact's role at the practice** (`ehr_administrator`,
      `practice_administrator`, `it_contact`, `vendor_representative`, `other`; never a name), the
      **population scope**, optionally "MRNs contain a nine-digit number (verified)", and **the operator's
      confirmation, required, that the practice owns the `client_id`, verified outside the app**
      (pre-production signs every connection with one shared key (coordinator decision pending owner
      confirmation, OA-065), so the key alone doesn't tie a client registration to a practice). The
      connection row has one column for the method (`approval_method`), plus `population_scope` and
      `mrn_nine_digits_verified`; the date, the contact's role, and the ownership confirmation are
      recorded in the audit event (there is no column for them; a column would need a migration, no
      privilege change; retention of that evidence is OA-070). One UPDATE moves
      `pending_approval → active` with `approved_by` and a fresh `approved_at` on the database clock
      (0040), `status_reason` cleared. Refusals, in order (this is the order of the code, and the
      first that applies wins): **before the transaction**, on the request alone: not the operator
      (**also refused when `users.disabled_at` is set**); not a real environment (**the environment
      rule**: where `syntheticDataOnly()` a real connection is never made live, as on the
      practice-side transitions); a code outside the fixed vocabularies; **a scope other than
      `group_export`** (below); a date that is malformed or in the future (by the Florida date); no
      ownership confirmation. **Then, in the one platform transaction:** an unknown practice or a
      suspended one (the row is read `FOR SHARE`, so a suspension can't race the check); a sandbox or
      a connection missing, not awaiting approval, or changed since the page loaded (`updated_at`),
      found under that practice with the row locked `FOR UPDATE`; **a date before the Florida date of
      the submission** (`submitted_at`, which needs the locked row, so **this check comes after the
      lock**; the form's `min`/`max` say the same); **no Business Associate Agreement in force for the
      practice** (`agreementStatus` active or expiring, over the practice's `kind = 'baa'` agreements
      read through this transaction `FOR SHARE`, so a concurrent void is waited for and can't be
      missed; the review page shows the status and the reason); a registry entry that doesn't match
      this connection's endpoint, token endpoint, and client ID. The audit write is in the same
      transaction: if it fails, the decision rolls back whole (the row stays pending with its stamps
      unchanged and the registry claim kept; a regression test for approve and for reject).
      Audited `operator.integration_approved` (reason = the method code; metadata: previous status,
      method, `verified_on`, `contact_role`, `population_scope`, `mrn_nine_digits_verified`,
      `client_id_ownership_verified`, `registry_verified`, `session_id` (the operator's session), and the
      configuration: base URL, client ID, MRN identifier system, token endpoint, issuer, key mode).
      ⚠️ The method and contact-role lists are the builder's proposal (the spec named neither): owner
      review, OA-066.
- [x] Reject (`rejectConnection`) takes a **reason code from a fixed vocabulary**
      (`endpoint_not_verified`, `client_id_not_verified`, `contact_not_verified`,
      `population_not_scoped`, `configuration_incorrect`, `other`; no free text, so no patient
      information can reach the practice's page or the audit "why"), moves `pending_approval → draft`
      (reason kept as `status_reason` and the audit `reason`), then releases the registry claim through
      the SECURITY DEFINER function (after the status change, which the function requires), then a
      second UPDATE clears what belonged to the rejected submission exactly as Withdraw does: the
      residency attestation (the endpoint is editable again; 0042 refuses a stale one on the next
      Submit) and the discovered token endpoint, its registry key, and the issuer. The submission stamp
      stays. **Decision beyond the spec's words** ("→ `draft` (registry released)"): clearing the
      attestation and discovery on Reject follows Withdraw's reasoning; owner confirmation OA-068. The
      operator's dropdown shows a short label per code; the practice's connection page shows a whole
      sentence per code ("DenialDesk did not approve this connection: …", `rejected.notice.<code>`) while
      the connection is a draft carrying a reject code. Reject works for a suspended practice and needs no
      BAA and no environment rule (the safe direction). Audited `operator.integration_rejected` (reason
      code; what was cleared; `session_id`; the configuration).
- [x] Operator-only, everywhere: the console actions call `requireOperator` first (a practice session,
      an administrator's included, has no operator cookie and is sent to the operator sign-in), and the
      domain applies the console's own rule again before it touches anything (`isOperatorAccount`, on the
      user as the database has it: the configured operator email AND no practice membership), so a
      hand-built context with a practice user's ID, or with any other user's, is refused too. Forms are
      read as text only, checkboxes count only as `on`, the verification date is read whole (never
      truncated into a valid one), and a connection is always named together with its practice (a
      connection ID under the wrong practice is "not found"). Tests:
      `test/integration/integration-approval.test.ts`, `integration-approval-actions.test.ts`,
      `src/domain/integrations/approval-codes.test.ts`.
- [ ] **Population scope: capture a `verified_filter` as a structured value** (security review M2).
      `population_scope` is a code with nowhere to record the filter itself, so approving
      `verified_filter` would record a claim and no filter: **Approve refuses it now** (`errors.approvalScopeUnsupported`;
      the form labels the option with one whole message, "Verified search filter (not available
      yet)", `integrations.scope.verified_filter_unavailable`) and only `group_export` can be
      approved. **Until the filter can be recorded, only a group export is approvable** (threat model
      I3), and the sync must apply exactly the recorded scope.
      Needed: a structured filter value (for example the Patient search parameters the sync will use,
      validated against an allow-list, and shown in the review page and the audit event) in a future
      migration that adds a column with **no grant** to `denialdesk_app`, and the sync (PI2b/PI4)
      must apply exactly that recorded filter.
- [ ] **Operator step-up before Approve** (security review M1; owner decision, OA-073; before the Azure
      cutover and the first real connection). Approve has no second factor beyond the operator's sign-in
      (the practice-side Submit and Resume need a step-up within 5 minutes). Needed: an operator-realm
      step-up (the operator session's `mfa_verified_at` within the window, separate from the practice
      realm) gating Approve, with `step_up_verified_at` recorded in `operator.integration_approved`.
      Reject stays ungated (the safe direction). Not built: pending owner decision OA-073.
- [ ] **Operator-side revoke** (compliance review; OA-071; before the first real connection). The
      lifecycle says any state → `revoked` by "admin or operator", but only a practice administrator can
      revoke today (`revokeConnection` is admin-only). The operator needs a revoke action for a live
      connection (suspected compromise, the practice's administrator unreachable): reason code from the
      revoke vocabulary, registry released, signing key destroyed, audited `operator.integration_revoked`
      with the operator's `session_id`, and the offboarding runbook updated.
- [ ] **Activation notice to every practice administrator (open: no notice mechanism exists; OA-069).** The
      app has no in-app notices, banners, or notifications table (Notifications is a planned Settings
      tab, `specs/settings-and-custom-fields.md` S3; e-mail is planned with it). Building one is its own
      system (a tenant-scoped notices table with RLS and isolation tests, per-user read state, an audit
      trail, i18n, and the layout to show it), so it is not built in PI1c, per the coordinator's
      instruction. Until then the practice sees the new state on the connection page, the Settings list,
      and the tab-bar drop-down ("Awaiting approval" → "Active"), and an administrator learns of a
      rejection from the reason on the connection page. Needed for this item: the Notifications spec
      (who is notified, the notice's wording and retention, whether PHI-free e-mail is allowed), then a
      builder slice that writes one notice per practice administrator inside the approval transaction.
      Also wanted there: notify the practice's other administrators on revoke (CC7.3, PI1b follow-ups).
- [ ] **Operator alert on `integration.registry_conflict` (open: needs infrastructure that does not
      exist, and a privilege decision, OA-067).** The practice's audit event holds only its own
      configuration and can never show who holds the endpoint and client ID pair (threat model S2).
      Wanted: on each conflict, an operator-only record of the **holding connection's ID** outside the
      tenant's audit log, an alert on the console, never in the customer audit viewer and never in the
      refusal message. Why it isn't here: (1) the conflict is detected inside Submit, which runs as
      `denialdesk_app` in a practice session, so recording it needs a place that role may write but not
      read — a new operator-only table with an INSERT grant for the app role, or a SECURITY DEFINER
      function (`integration_registry_conflict_record(connection_id)` that looks up the holder in the
      registry and inserts the record), which is **a privilege change: R-15.9 needs the owner's
      sign-off**; (2) the console has no alert surface yet (a queue badge or a list on the approvals page
      would be the first). Sketch: table `integration_registry_conflicts` (`id`, `attempting_connection_id`,
      `holding_connection_id`, `occurred_at`, `acknowledged_by/_at`), no RLS and no grant to
      `denialdesk_app`, written only by the definer function (which checks the attempting connection
      belongs to `app.tenant_id`, is `pending_approval`, and claims nothing), read by the operator on
      `/operator/integrations`. Bounded meanwhile by the Test connection and Submit rate limits, and the
      practice-side event (`integration.registry_conflict`, its own configuration only) is audited.
      Owner decision needed: approve the definer function or the grant.
- [ ] **Approval evidence and single-person approval** (OA-070, OA-072). The approval evidence is the
      audit event (there are no columns for the date, the contact's role, or the ownership
      confirmation): `operator.integration_approved|rejected` are to be kept for the life of the
      connection plus six years and fall under legal hold, or dedicated columns are added later.
      Approval is a single-person control, and the operator account must be one person's
      (unique user identification, 45 CFR 164.312(a)(2)(i)); otherwise plan per-person operator
      accounts before production.
- [ ] Scale note for the queue: it reads one platform transaction per customer practice (three at a
      time; `listPractices` does the same for denial counts). Replace with an operator-visible index of
      pending connections when the number of practices makes that slow.
- Moved to PI2a (Submit ships there): Submit claims the registry; a conflict refuses Submit.

### PI2a — transport, discovery, keys, test connection
Also carries PI1b's Submit, attestation, step-up, and pause/resume (re-sequenced 2026-09-28). Order
is now PI2a → PI1c (approval has nothing to approve before Submit exists); sandbox Submit becomes
possible only in PI2b, which adds the in-process sandbox a test can pass against.
- [x] Resume from `error` requires a passing Test connection first (the error usually means the
      endpoint, key, or registration changed; resuming blindly restarts the failure). Resume from
      `paused` doesn't. Built (PI2a Submit slice): the step-up is checked first, then, for an `error`
      connection only, `hasRecentPassingTest` under the row lock with the live signing `kid`, **and the
      pass must be newer than the move into `error`** (`options.afterLastChange`: the pass's
      `occurred_at` is strictly greater, in the database, than the connection's `updated_at`, which
      the move into `error` sets). A pass recorded while the connection was still `active` can't
      clear an error that came after it. Test connection never bumps `updated_at` on a connection
      past `draft` (only a draft pins the endpoint), so a test run after the error always counts; a
      rename after the test does bump it and asks for a new test, the safe side. The `kid` is
      resolved by the action before the transaction (`resolveSigningKid`); without one an `error`
      connection can't be resumed (fail closed). The refusal reads "Run Test connection and get a pass
      before resuming" (`error.testRequiredToResume`, en/es/pt); the resumed event records
      `test_kid`. **Sandbox in `error`:** it can't be resumed until PI2b adds its test path (the
      sandbox has no transport to test with today). Tests:
      `test/integration/integration-submit.test.ts`, `integration-submit-actions.test.ts`
      (including: `errored()` then an immediate Resume is refused, then allowed after a new pass;
      a pass recorded while active, then the error, is refused).
- [x] Submit (admin, draft → `pending_approval` for a real connection, → `active` for the sandbox;
      stamps `submitted_by/_at` in both cases — the drop-down treats a revoked connection as a past
      source only if it was ever submitted or synced):
      requires a passing Test connection in the last 24 h, the residency attestation (real only),
      and an MFA verification within the last 5 minutes (step-up; R-7.2.2; the gate and `/step-up`
      exist now, see "Step-up MFA" below: call `requireStepUp`). Tests: Submit refused without a
      recent passing test, and without a recent step-up. Submit locks the row `FOR UPDATE` and calls
      `hasRecentPassingTest` (with the live signing `kid`) in the same transaction as the status
      change, so a concurrent test can't land between the check and the move (PR #87 review); the
      app role can write these columns directly, so the gate is app-enforced. Submit writes both stamps
      (`submitted_at`, `us_residency_attested_at`) in the same UPDATE that changes status.
      **Built** (`submitConnection`, `src/domain/integrations/connections.ts`; action
      `submitConnectionAction`; panel `SubmitConnectionForm` on the connection page). Before the
      transaction: admin, the displayed language, a per-practice rate limit (bucket
      `integration_submit`, 10 per 10 minutes, every attempt counts, refusal audited
      `security.rate_limited`), and the live signing key's `kid` from `SigningKeyStore.kid()`,
      public material only, never a signer and never under the row lock. Then, all under the row lock
      in one transaction: not found (another practice's connection), revoked, stale page, status
      `draft`, the environment rule, **no other connection of the practice outside `draft`/`revoked`**
      (refused in words, `error.anotherConnectionLive`, which says paused and error connections count too; the `integration_connections_one_active`
      unique index is the backstop and a violation of it, two drafts racing, maps to the same
      refusal), `requireStepUp`, the passing test (a rotation between the `kid` lookup and the lock is
      caught by the pass binding), the attestation (real only), then one UPDATE (status, `status_reason`
      cleared, both fresh stamps on the database clock), then the registry claim (real only), then the
      audit. No migration and no GRANT: the UPDATE names only columns 0039 already grants, and a test
      pins that the approval columns stay ungranted. The Submit panel shows the same reasons as a
      disabled button instead of one the server would refuse (`submitBlockedReason`: environment,
      another live connection, no usable signing key (the key's own refusal, as Submit gives it, not
      "no passing test"), no passing test), and the connection page shows "Awaiting DenialDesk
      approval" after a real Submit. **The passing test is required for the sandbox too**: only the
      attestation is "real only" (this line and "sandbox Submit becomes possible only in PI2b, which
      adds the in-process sandbox a test can pass against"), so the sandbox Submit path is
      implemented and tested at the domain level with a seeded pass, and is unreachable from the page
      until PI2b (the panel shows the button disabled, with the reason). **PI2b must change the
      `submit.blocked.sandbox` copy** ("the built-in test sandbox can't be tested yet") when the
      sandbox gets its test path. Tests cover: refused without a recent passing test, when the newest
      test failed, when the pass is older than 24 h (injected clock), when it was for another key or
      an edited connection, without a step-up, without the attestation, in the wrong status, for
      another practice (not found), on a stale page, in the wrong environment, while another
      connection is live (submitted or active; allowed again after a withdraw or revoke; two drafts
      racing), rate limited; two Submits at once (one wins) and two practices submitting the same
      endpoint and client ID at once (exactly one claims); a successful Submit stamps both columns and
      claims the registry; Withdraw, then Submit again needs a fresh test and a fresh attestation.
- [ ] Submit stamp time floor (compliance N3; owner/counsel decision, OA-045; due before the first
      real connection or the Azure cutover, whichever is first). `attested_by` non-null is already
      enforced by the 0039 CHECKs (`integration_connections_attested_fields_together` and
      `integration_connections_pending_requires_submission`). What is missing: a later migration
      that requires `submitted_at` and `us_residency_attested_at` to be ≥ `transaction_timestamp()` on
      `draft → pending_approval` (so an app-role writer can't back-date or forward-date the stamps;
      0042 only requires them to differ from the previous ones) and, optionally, `attested_by =
      submitted_by`. It changes the lifecycle trigger only, and no privilege.
- [x] Residency attestation on Submit of a real connection: "This EHR/PM endpoint stores and
      processes data only in the United States" — stricter than § 408.051(3), which also allows
      territories and Canada (DenialDesk defaults to U.S.-only, R-3.3.1). Audited. The checkbox
      carries this exact wording (`submit.attestation`, with Spanish and Portuguese translations,
      **unreviewed: native-speaker and counsel review in OA-041**); unit tests pin the English, Spanish,
      and Portuguese texts to `US_RESIDENCY_ATTESTATION_VERSION` (an edit is a version bump).
      `integration_connections` has no column for the wording's version or language, so they go in the
      `connection_submitted` audit metadata: `attestation_version`, `attestation_locale`,
      `attestation_text_sha256` (SHA-256 of the exact text shown, in the displayed language) and
      `us_residency_attested`; the who/when are the `us_residency_attested_by/_at` stamps. Only a
      form value of `on` counts. **`attestation_locale` is the displayed locale**: the form carries the
      language it rendered in (a hidden field), and the action refuses the Submit (`error.localeChanged`,
      en/es/pt) if it doesn't match the request's, so the text an administrator agrees to is the text
      recorded. The form likewise carries **the wording's version** (`attestationVersion`, a hidden
      field set from `US_RESIDENCY_ATTESTATION_VERSION`), and the action refuses a missing or different
      one (`error.attestationChanged`, en/es/pt), so a wording change deployed between the page load and
      the click can't be recorded as agreed to under the old version. Whether the wording should also name backups/DR copies and "accessed only from the
      United States" is open (compliance N6, OA-045); changing it is a new version.
- [x] Submit claims the registry; a conflict refuses Submit with "This endpoint and client ID are
      already connected" (no other practice named) and audits `integration.registry_conflict`.
      The claim (SECURITY DEFINER `integration_registry_claim`) requires the row to be
      `pending_approval`, so it runs after the UPDATE inside the same transaction; a refusal rolls the
      whole Submit back, and the conflict event is written in a second transaction (the first one's
      audit would roll back with it). If that write fails it is logged (IDs only) and the
      administrator still sees the conflict. Its metadata is the practice's own configuration
      (`base_url`, `client_id`, `mrn_identifier_system`), never the other practice. A false from the
      claim function is treated as a conflict only because the checks before it make every other
      false-return reason unreachable. The conflict message still reveals that some practice holds the
      pair, with no identity: bounded by the Test connection and Submit limits, accept or reject in
      OA-065 (c).
- [x] Step-up MFA (R-7.2.2; PI2a lifecycle slice): migration 0041 adds `sessions.mfa_verified_at`
      (set at sign-in MFA and at each step-up; null on a session from before 0041, which must step
      up first); `hasRecentMfa` (`src/auth/step-up.ts`, 5-minute window from
      `MFA_STEP_UP_WINDOW_MS`, inclusive at 5:00; unit-tested at 4:59 / 5:00 / 5:01); `/step-up`
      re-verifies the sign-in TOTP and returns to a `returnTo` that `stepUpTarget` keeps to one of the
      integrations pages (built on `safeInternalPath`, the open-redirect fix, `src/lib/safe-path.ts`); a success rotates
      the session token and cookie (`completeStepUpMfa`); it shares the sign-in attempt counter but
      refuses, before checking any code, the attempt that would reach the lockout limit
      (`reserveStepUpAttempt`); that refused attempt is what sets the lock, for the usual 15
      minutes, audited `auth.locked_out` (session, tenant, route, no code), so a correct code never
      causes the lock and no guess is evaluated (a step-up doesn't clear the counter, so letting the
      last attempt through would succeed and still leave the account locked); an attempt on an
      account already locked is refused and audited `auth.step_up_refused` with `reason: locked`;
      the message says the account is locked for up to the lockout time; a
      failure never resets the sign-in lockout counter, and a success keeps earlier failures
      (`claimTotp(..., resetLockout: false)`) while giving back only its own attempt
      (`releaseAttempt`), so successful step-ups can't add up to a lockout; audited
      `auth.step_up_verified|failed` (session, tenant, and the page as a route template plus the
      connection UUID, e.g. `/settings/integrations/[id]`: never the raw path, so free text in a
      crafted `returnTo` can't reach the log; `returnTo` is capped at 256 characters and must be one
      of the integrations pages with a UUID id segment (a connection page or, from PI2b, its `/payers` page), else it resolves to the default page). A
      step-up that finds its session revoked meanwhile (`completeStepUpMfa` returns false) audits
      nothing as verified and sends the browser to sign in. `hasRecentMfa` also refuses a
      verification more than 30 s in the future (clock skew between instances is tolerated up to
      that). The gate for
      domain actions is `requireStepUp(actor)` (`connections.ts`: `actor.recentMfa` comes from the
      session, never the request; refusal carries `stepUpRequired`, and the page links to
      `/step-up`). Resume and Submit use it now; **payer mapping (PI2b) calls the same
      helper.** No GRANT changes: `sessions` is reached through the connection owner only.
      Owner decisions: OA-063 (incl. TOTP vs WebAuthn, R-7.2.2).
- [x] Withdraw (`pending_approval` → `draft`, releases the registry claim through the SECURITY
      DEFINER function after the status change; audited `integration.connection_withdrawn`).
      Admin-only, tenant-scoped (another practice's connection is "not found" and its claim is
      untouched), environment-rule checked, stale-page checked. The endpoint is editable again once
      it is a draft, so a **second UPDATE clears the residency attestation**
      (`us_residency_attested_by/_at`; a separate statement, because the lifecycle trigger refuses
      to change the attestation in the statement that leaves `pending_approval`) and, in the
      same statement, the discovered token endpoint, its registry key, and the issuer (they belong
      to the old endpoint; Test connection finds them again), so a different endpoint is attested
      and discovered afresh. The audit event records what was cleared (`previous_attested_by/_at`,
      the previous token endpoint and issuer, normalized); the submission stamp (`submitted_by/_at`) stays as the record
      that it was submitted once, and the page shows "Submitted" only while the connection is not a
      draft. Database backstop (drizzle/0042): `draft → pending_approval` requires the attestation
      and submission stamps that are present to differ from the row's previous ones (the fresh-stamp
      pattern 0040 uses for approval), so a stale attestation can't be carried into a new
      submission whatever the app does; a missing stamp is still refused by the 0039 CHECK.
- [x] Pause (`active` → `paused`) and resume (`paused`/`error` → `active`, MFA step-up; resume also
      clears `status_reason`), audited `integration.connection_paused|resumed`; same admin, tenant,
      environment, and stale-page checks. Pause and Revoke deliberately need **no** step-up (the safe
      direction and the emergency stop for a suspected compromise; OA-063). Wired into the
      connection page as one action per state (Settings › Integrations › connection), every string
      in en/es/pt.
- [x] Payer mapping also requires step-up (ships with payer mapping, PI2b; `savePayerMappings` calls `requireStepUp`, so the rule and its message are the ones Resume and Submit use).
- [x] Revoke records a reason code from a fixed vocabulary (`no_longer_used`, `switching_systems`,
      `configured_in_error`, `security_concern`, `other`; `src/domain/integrations/revoke-reasons.ts`)
      as the audit event's `reason` and the connection's `status_reason`; required on the form and
      in the domain (no free text, so no patient information can reach the "why").
- [x] Database CHECKs (drizzle/0041) `endpoint_key = lower(base_url)` and, for the token endpoint,
      "no key, or a key equal to `lower(token_endpoint)` with the endpoint present" — a bare
      `token_endpoint_key = lower(token_endpoint)` evaluates to NULL, which a CHECK accepts, for a key
      written with no endpoint, so the second CHECK is spelled out. An endpoint without a key stays
      allowed (discovery sets the endpoint first; the registry claim refuses a missing key). Security
      review L-3; existing rows are guarded by 0041's `ADD CONSTRAINT` validation, which fails the
      migration if any row violates a CHECK (`integration-lifecycle.test.ts` only asserts the
      invariant holds afterwards). The PI1a fixtures that set a bare `token_endpoint_key` now
      set the endpoint with it (`setDraftField`).
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
- [x] Limits (M1), run-level, **PI2b** wires these into the sync loop: `MAX_BUNDLE_ENTRIES`
      (`assertBundleEntryLimit`, Bundle ≤ 1,000 entries), `RunBudget` (12 min / 5,000 requests /
      500 MB per run) and `PagingLoopGuard` (same `next` URL twice) exist in `limits.ts` with unit
      tests, and `assertNextIsSameOrigin` refuses a cross-origin `next`, but none of them is called
      from a sync loop yet.
      **Built in PI2b part 1** (`search.ts`, `sync.ts`; tests in `search.test.ts`).
- [x] Callers of the transport, **discovery and the token request** (PI2a part 2), **never log or
      store a non-2xx response body** (the transport discards it unread, N3; `AccessToken` refuses to
      serialize; errors carry only fixed codes) and emit `address_refused`, `tls_failed` and
      `redirect_refused` as security events (`integration.transport_refused`, IDs and the code only,
      no URL or host). Tests: `test/integration/test-connection.test.ts`.
- [x] Callers of the transport, **search** (PI2b): the same two rules, carried into PI2b's acceptance
      criteria.
      **Built**: the search never logs or stores a non-2xx body (the transport discards it; `Retry-After` is the only header read), and refusals are audited `integration.transport_refused` (code only) when they end a run.
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
      Patient `_lastUpdated` search (declared per resource, or once for the server at
      `rest[].searchParam`), Coverage `patient` search. Scope style from `capabilities`:
      `permission-v2` → `system/Patient.rs system/Coverage.rs system/Organization.rs`; **anything
      else is treated as `permission-v1`** (`.read`) rather than refused — ⚠️ VERIFY per vendor (a
      server that supports v2 without advertising it fails at the token request with
      `scope_insufficient`, never a silent wrong grant). Issuer recorded (normalized base URL + CapabilityStatement
      `implementation.url` when present). Built as: `metadata` first, then `smart-configuration`, both
      through the injected `Transport`; issuer is `<base URL>` or `<base URL> <implementation.url>`
      (the second only when it passes the URL rules); the discovered token endpoint must pass
      `checkBaseUrl` and may use the sandbox host only for a sandbox connection; the connection's key
      algorithm must be in the server's list. The token endpoint is used **exactly as the server
      advertised it** (after `checkBaseUrl` validated it) for the assertion's `aud` and the POST URL;
      the normalized form (host lower-cased, no trailing slash) is used only for the pin, its
      comparison, and `token_endpoint_key`. Test connection pins `token_endpoint`,
      `token_endpoint_key`, and `issuer` on a still-draft connection. **Past draft the token endpoint
      and the issuer are pinned, and a missing pin counts as a change** (fail closed): a different one
      is refused (`smart_config_invalid`, audit detail `token_endpoint_changed` or `issuer_changed`) and
      no assertion is sent. Editing a draft's base URL or client ID clears the pin (token endpoint,
      key, issuer) and the residency attestation, so a pin never outlives the endpoint it was
      discovered from. Where only synthetic data is allowed the token endpoint's host must also be in
      `vendor-sandboxes.ts` (`token_host_not_permitted`).
- [x] Token (`auth.ts`, `src/lib/crypto/jwt-sign.ts`): assertion `iss = sub = client_id`, `aud` = the
      token endpoint as advertised (see Discovery; it is the pinned endpoint's exact form), `iat`,
      `exp` ≤ iat + 5 min, unique `jti`, header `alg` from the allow-list {ES384, RS384}, `kid`,
      `typ: JWT`; node:crypto signing. Response must have `token_type` bearer and granted scopes
      including the required ones (`scope_insufficient` otherwise, reported as the
      `capability_missing` outcome; an unusable answer, including a wrong `Content-Type`, is
      `smart_config_invalid`). TODO: wildcard grants (`system/*.rs`) are reported as
      `scope_insufficient` for now (⚠️ VERIFY per vendor). `exp` is `iat + 4 min` (skew margin under
      the 5-minute cap); `AccessToken` redacts itself under JSON, string, template, and
      `util.inspect`; the in-memory `AccessTokenCache` exists.
- [x] Token: re-request on expiry **or one 401** from the FHIR server — the sync loop that does this
      is PI2b (`AccessTokenCache.invalidate` is ready for it).
      **Built** (`createTokenSource`, `FhirClient`).
- [x] Keys, pre-production (R-7.3.4, R-7.3.5; decided 2026-09-28: follow the spec, no migration, no
      grant). **A pre-production exception, production control deferred:** R-7.3.4/R-7.3.5 call for
      per-connection, non-exportable keys; the shared environment key below is a pre-production exception
      (coordinator decision pending owner confirmation, OA-065) (residual risk in the threat model, S3), and the production control
      (Key Vault per connection) is the unticked item after this one.
      **One shared key from a functions-only hosting secret**, `INTEGRATION_SIGNING_KEY` (a PKCS#8
      ES384 PEM; RS384 also accepted; literal `\n` accepted for hosts that flatten multi-line
      secrets), owner action OA-064. **Register this key only with vendor sandbox tenants holding
      synthetic data, never with a live practice EHR:** Test connection enforces it (the
      environment rule is re-run before any network call: where only synthetic data is allowed, only
      the hosts in `vendor-sandboxes.ts`, empty until OA-049, may be dialed, for the base URL and the
      token endpoint). `EnvSharedKeyStore` (`keys.ts`) is constructed only when
      `syntheticDataOnly()`, reads the variable on first use (a missing or unreadable one is
      `not_configured`/`key_unreadable` at use, so the app and the JWKS route start without it), keeps
      the key in a true `#private` field (it can't be serialized by `JSON.stringify`, `util.inspect`,
      or a logger), and never writes `key_mode`/`key_ref` or any other column. **Production refuses
      to start integrations if the variable is present** (`assertNoEnvSigningKeyInProduction`, thrown by
      `getSigningKeyStore` and checked by `register()` in `src/instrumentation.ts` at boot; the
      `security.env_signing_key_in_production` event, no value, is written at boot and by Test
      connection when it meets the refusal; the JWKS route answers 404 in production before it
      reaches the store; Key Vault only). The `AzureKeyVaultKeyStore` stub fails closed. Tests
      generate their keys at test time; no PEM is committed. `.env.example` carries an empty
      `INTEGRATION_SIGNING_KEY=`. Rotation (current + next `kid`) is still open.
- [ ] Keys, production, **per connection — for the Azure cutover; needs human sign-off (R-15.9)**:
      **per-connection key by default** — production creates a non-exportable Azure Key Vault key per
      connection at creation, published at `/.well-known/jwks/<connection-uuid>.json`; a shared key
      only as a documented per-vendor exception (`key_mode = shared_vendor_exception` + reason code;
      e.g. a vendor with one client per app, ⚠️ VERIFY), set only by the operator at approval (never
      client-settable) and audited. Connection creation is rate-limited per practice (each one creates
      a Key Vault key). Annual rotation with current + next `kid`. It needs a migration: `GRANT UPDATE
      (key_mode, key_ref)` to `denialdesk_app` (the app role has no grant on either today,
      `drizzle/0039`; a privilege change, R-15.9) and a SECURITY DEFINER `integration_jwks_lookup(uuid)`
      returning only `(status, key_ref)` (the JWKS route is unauthenticated and the table is FORCE
      RLS, so it has no tenant to set). The Key Vault SDK arrives then, under R-15.7. Also: clearing
      the key on revoke, and the key rotation and compromise runbooks.
- [x] JWKS route, pre-production (`src/app/.well-known/jwks.json/route.ts`, `jwks-route.ts`):
      `GET /.well-known/jwks.json` publishes the shared key's public half — public-field allow-list
      (`kty`, `crv`, `x`, `y`, `n`, `e`, `kid`, `alg`, `use`; applied twice, in the adapter and again in
      the handler; tests assert `d`, `p`, `q`, `dp`, `dq`, `qi`, `k` never appear, even from a leaky
      adapter), its own `jwks` rate-limit bucket (120 per minute per client network; 429 with
      `Retry-After`), `Cache-Control: public, max-age=300`, `application/jwk-set+json`. **404**
      (uncached, empty) when the key isn't configured or unreadable, and — before any rate-limit
      write — always where real data is allowed. No key or connection lookup (the only database write
      is the rate-limit counter; an IPv6 client is counted by its /64, and the Netlify client-IP
      header is trusted only on Netlify).
- [ ] JWKS route, production, per connection (`/.well-known/jwks/<connection-uuid>.json`; 404 for
      unknown or revoked) — with the Azure-cutover item above.
- [x] Test connection (`src/domain/integrations/test-connection.ts`; action `testConnectionAction`
      and the button on `/settings/integrations/[id]`, real connections only, admin only; unit tests
      for discovery/token/keys, integration tests in `test/integration/test-connection.test.ts`, run
      by CI's PostgreSQL job): discovery + one token request, no patient data; its own rate-limit
      buckets (per connection and per practice); outcomes collapsed to `ok`, `unreachable`,
      `tls_failed`, `not_fhir_r4`, `smart_config_invalid`, `auth_refused`, `capability_missing`;
      audited (`integration.connection_tested`, configuration and codes only;
      `integration.transport_refused` with `{ code }` for `address_refused`, `tls_failed`,
      `redirect_refused`; `security.rate_limited`). Buckets `integration_test_connection` (5 per 10
      min) and `integration_test_practice` (20 per 10 min). The network calls run with no database
      transaction open. Without `INTEGRATION_SIGNING_KEY` (or with an unreadable one, or in a
      production process holding one) the result is a translated "signing key isn't configured/usable"
      refusal, before any request and without spending the rate limit — never a crash. The built-in
      sandbox has no transport until PI2b, so its page shows no button and the service refuses it.
      Every attempt is audited: an unexpected error after the rate limit was spent still writes a
      `connection_tested` row (`unreachable`, detail `internal_error`) before rethrowing; a
      connection edited while the test ran is recorded as `smart_config_invalid` with detail
      `config_changed` and is never pinned (the row records what was actually dialed); a pin change is
      recorded with `previous_token_endpoint` and `previous_issuer`.
      **The record of the result (decided 2026-09-28): no column, the audit log.** "A passing test in
      the last 24 h" is `hasRecentPassingTest(tx, tenantId, id, kid)`: **the newest test outcome must be
      a pass** — the newest `integration.connection_tested` or `integration.transport_refused` event
      for the connection has to be an `ok` test inside the window — **and** the pass must match the
      connection now: base URL, client ID, token endpoint, token endpoint key, issuer, and the
      signing key's `kid` (rotation or a different key voids it), each recorded in the event's
      metadata (`PASS_BINDING_METADATA_KEYS`, pinned by a test). So any later failed test, or refused
      address/TLS/redirect, voids the pass. *This departs from the PI2a wording ("a passing test in
      the last 24 h") and is the coordinator's decision, pending owner confirmation.* The tenant is
      checked explicitly as well as by row-level security. Submit and Resume from `error` call it (both under the row lock, with the live signing `kid`).
      Messages in en/es/pt (`integrations.test.*`).

### PI2b — sync engine, sandbox, jobs, history, payer mapping
- [x] Every writer of `error` stamps the transition in the database (PI2a follow-up, PR #88 review):
      the lifecycle trigger sets `NEW.updated_at := clock_timestamp()` on any status change (a PI2b
      migration, changing the trigger function only, no privilege). Resume's gate compares a pass's
      `occurred_at` with `updated_at` in the database (`afterLastChange`, "the pass is strictly newer
      than the move into `error`"); the app's own transitions write `updated_at = now()`, which is the
      **transaction's start**, so a sync that goes `active → error` at the end of a long transaction
      stamps a time before a pass taken during that transaction, and Resume would accept a pass that
      preceded the error. Every writer of `error` (the sync engine, and the trigger for any other) must
      therefore get the database's actual clock, not the writer's start-of-transaction one. Test: an
      `error` set inside a transaction that started before a pass was recorded is not cleared by that
      pass.
      **Built** (`drizzle/0043_patient_integrations_sync_engine.sql`, the lifecycle function only, no privilege): the
      trigger sets `NEW.updated_at := clock_timestamp()` on any status change. Tests: `test/integration/sync-db.test.ts`
      (a status change carries the real time whatever the writer wrote; an `error` set inside a transaction that
      started before a pass was recorded is not cleared by that pass, and Resume then needs a newer one). One existing
      assertion changed: approval's `approved_at` (transaction start) and `updated_at` (real clock) are no longer
      equal, only ordered (`integration-approval.test.ts`).
- [x] Pause and `error` stop work already in flight: a connection leaving `active` (pause, error)
      abandons its queued runs (as revoke does), and the sync loop re-checks `status = 'active'`
      before each page commit, so a run that started before a Pause stops at its next page instead of
      finishing. PI2a's Pause only stops new runs from being queued.
      **Built** (0043: the abandon trigger also fires on `paused` and `error`, queued and running runs alike; the
      loop locks the connection row (`FOR NO KEY UPDATE`, which a concurrent Pause waits for) and re-checks
      `status = 'active'` and the run `running` before each page commit, so a run stops at its next page). Tests:
      `sync-engine.test.ts` (Pause during a run: the first page stays, nothing after it, the watermark doesn't move;
      Pause between fetching and committing a page stores nothing; an `error` set by someone else) and
      `sync-db.test.ts` (each state, a finished run and another practice's runs untouched).
- [x] The transport is chosen from `is_sandbox` only (never the host), and a sandbox run is refused
      unless `syntheticDataOnly()`, so `SYN` patients never land in a production tenant (compliance
      review #13, security review L-1).
      **Built** (`src/integrations/fhir/select-transport.ts`, `src/app/(app)/settings/integrations/test-deps.ts`):
      a sandbox connection gets the in-process `SandboxTransport` only where `syntheticDataOnly()` (elsewhere no
      transport at all, and the transport class refuses to be constructed), never chosen by host; the sync run and
      `syncNow` refuse a sandbox where real data is allowed (`environment_refused` before any transport is asked
      for) and a real connection where only synthetic data is. Test (`APP_ENV=production` on Netlify:
      `test-deps.test.ts`; the run itself: `sync-engine.test.ts`, `sync-now.test.ts`).
- [x] **Fail closed on real connections** (PR #98 review, blocking): `assertRunEnvironment` (run) and `syncNow`
      refuse every connection that is not the synthetic sandbox until PI4 applies `population_scope`: the run ends
      `failed` with the allow-listed code `population_scope_unenforced` (a real connection where only synthetic data is
      allowed stays `environment_refused`), no transport is asked for, no request leaves the process, no patient row is
      written; Sync now queues nothing, audits the refusal (`integration.sync_failed`, reason `sync_now`) and shows
      `sync.error.populationScopeUnenforced` in en/es/pt. Tests: `sync-engine.test.ts`, `sync-now.test.ts`. Recorded as
      an open PI4 blocker in `docs/PROJECT_STATE.md`; the PI4 item below lifts it.
- [x] **Review round hardening** (PR #98): the practice's calendar date (`todayIn("America/New_York")`, not UTC) is used
      for coverage periods, address periods and the minor check, with boundary tests at 23:30 Eastern; the mapper holds
      MRN to 40 and names to 60 characters and a `23514` from the database skips one record (`record_rejected`) instead
      of failing the page; Coverage entries whose beneficiary is not in the chunk are dropped and a chunk is capped at 20
      pages; the token request honours `Retry-After` (60 s cap) and records `http_status`; a sandbox access token is
      bound to the key set that obtained it and expired tokens are pruned; a manual run's `integration.sync_started`
      carries the administrator's IP, user agent and `session_id`; a Pause between queueing and claiming a run is an
      `abandoned` result, not an error.
- [x] Refuse SSN- and MBI-shaped MRN values at ingest, whatever the identifier system (security
      review M-1: a deny-list can't know a vendor's local SSN OID); also check `Identifier.type`
      (v2-0203 SS, MB, MC, DL, PPN).
      **Built** (`src/integrations/fhir/mrn-shapes.ts`, `map-patient.ts`; security review M2): judged on the whole value,
      wherever the shape sits (a `SYN-` marker or a vendor prefix does not hide it). An SSN grouped 3-2-4 with any
      one or more separators (`-`, `.`, space, `_`, `/`, so `123.45.6789` and `123--45--6789` too) is refused always;
      any standalone run of exactly nine digits (`A123456789`, `MRN 123456789`), also when separators split it
      (`123-456789`, `12345-6789`), is refused unless the operator recorded "MRNs contain a nine-digit number"
      (`mrn_nine_digits_verified`); the CMS MBI format (⚠️ VERIFY) is refused as a token anywhere in the value,
      compact, grouped 4-3-4 or split at other places by separators (`1EG4TE5-MK73`). `Identifier.type` SS, MB, MC, DL, PPN →
      `mrn_government_identifier`. Tests: `mrn-shapes.test.ts`, `map-patient.test.ts`.
- [ ] Jobs: payload `{ runId }` only, with an HMAC-SHA256 header (body + timestamp, 5-min window)
      keyed by `INTEGRATION_JOB_SECRET`. The worker claims the run with SECURITY DEFINER
      `integration_claim_run(run_id)` (only a `queued` run; returns `tenant_id, connection_id`;
      EXECUTE granted to a `denialdesk_jobs` role, not `denialdesk_app`; also requires the
      connection to be `active`; HMAC compared in constant time). Tests: unsigned call,
      stale timestamp, and forged or already-claimed `runId` refused.
- [x] All sync reads and writes run as `denialdesk_app` under a new
      `withTenantAsSystem(tenantId, runId)` (sets tenant, run, and connection settings; never
      `withTenantAsPlatform` or `systemDb`). Audit actor: one fixed integration
      service-principal UUID (the same in every environment) in reviewed code, seeded by migration as a `users` row that cannot
      sign in, has no memberships and no roles (keeps the `audit_events.actor_user_id` FK; a test
      asserts the FK stays); the admin who pressed Sync now in
      `metadata.triggeredBy`; reason `ehr_sync`; "where" = runtime function id and host.
      `app.sync_run_id`/`app.sync_connection_id` must be set with `set_config(name, value, true)`
      (transaction-local — `is_local = true`), the same way PI1a's own tests set them, never with
      `is_local = false`/session-level: a pooled connection reused by another request afterwards
      must not inherit a stale run/connection setting that `patients_synced_readonly` would then
      trust.
      **Built** (`src/db/tenant.ts` `withTenantAsSystem(tenantId, runId, fn)`, `src/db/integration-principal.ts` (re-exported by `src/domain/integrations/principal.ts`)
      `INTEGRATION_SERVICE_PRINCIPAL_ID = d3a7c0de-5a1c-4e11-8a0c-0000000d0d01`, seeded by 0043 as a disabled `users`
      row whose password hash is not a hash: no sign-in, no membership, no session, no second factor). Settings are
      `set_config(..., true)` only; a test checks nothing is left on the pooled connection, that another practice's or a
      made-up run is refused, and that the service principal stays a foreign-key target
      (`connection.updated_by`). **The FK note:** `audit_events` has no foreign keys (ADR 0005); the FKs that need the
      row are `integration_connections.updated_by` and `integration_payer_mappings.updated_by`. Audit events written
      by the engine carry no request IP or user agent (`AuditEvent.system`); the runtime function id and host are in
      their metadata.
- [x] Every run first checks the connection's issuer against discovery; a mismatch fails the run
      before any upsert (`issuer_mismatch`); a changed token endpoint sets `error`.
      Issuer format (PI2a, `discovery.ts`): the normalized base URL, or `<base URL> <implementation.url>`
      (space-separated, the second only when the CapabilityStatement carried one that passes the URL
      rules); compare the whole string.
      **Built** (`src/domain/integrations/sync.ts`): discovery, then the pinned token endpoint (a change sets `error`,
      `token_endpoint_changed`), then the issuer (`issuer_mismatch`, the run fails, nothing is requested for patients;
      a missing pin counts as a change). Tests in `sync-engine.test.ts`.
- [x] Search: `Patient?_lastUpdated=ge<watermark>&_count=100` (no filter on the initial load); Coverage for a
      page's patients by POST `Coverage/_search` (`patient=<id>,<id>`, 50 a request) so FHIR ids stay out of
      request URLs, else, for a server that answers 404/405/415/501 to it, GET in chunks of 20 (documented: the
      URL goes only to the practice's own EHR; ⚠️ VERIFY support per vendor); every result page is followed,
      `next` same-origin only (`assertNextIsSameOrigin`), `PagingLoopGuard`, `RunBudget` and
      `MAX_BUNDLE_ENTRIES` wired in (`src/integrations/fhir/search.ts`). Where only synthetic data is allowed
      the first request is `_count=1` (the `SYN` probe). Tests: `search.test.ts`, `sync-engine.test.ts`.
- [ ] Not built yet, left for a follow-up: Coverage-only changes by `Coverage?_lastUpdated` when advertised (the
      `coverage_watermark` column stays unused; a Coverage-only change reaches a patient at its next
      Patient change or, for a payer mapping, by the re-derive pass), and `_elements` when advertised.
- [x] Retries: 3, exponential backoff, `Retry-After` capped at 60 s; 401/403/`invalid_client` → `error`.
      **Built**: 3 retries after the first attempt, 1 s, 2 s, 4 s (cap 30 s), `Retry-After` capped at 60 s (the
      transport now returns `retryAfterSeconds` for an error response, the header being the only thing read from it),
      408/425/429/5xx and a timeout or unreachable server retried, address/TLS/redirect refusals never; one 401
      re-requests the token, a second 401, a 403, or `invalid_client` sets the connection to `error`.
- [x] Mapping as in the table below; a record failing a required rule is skipped with a code, never
      partially guessed. Server timestamps are clamped (future beyond 5 min skew → our now; the
      watermark never exceeds our clock). `OperationOutcome.issue.code` kept only if it is an R4
      IssueType code, else `other`; `diagnostics` never stored.
      **Built** (`map-patient.ts`, `map-coverage.ts`, `security-labels.ts`). Source status (`inactive`, `merged`) is
      mapped too, although the table assigns it to PI3; `gone` and the weekly reconciliation stay PI3. An R4
      `OperationOutcome.issue.code` is mapped onto our own vocabulary (see "Sync run and issue codes"): the R4
      IssueType codes with hyphens as underscores, **anything else `other`** (not `unknown`, which is itself an R4
      code); `diagnostics` is never read.
- [x] Upsert keyed by `(tenant_id, source_connection_id, external_id)`; no regression on
      `meta.lastUpdated` (and, when that is missing or equal, on a numeric `meta.versionId`: `isOlderCopy`); same `versionId` = unchanged. Linking: MRN **and** birth date equal to a
      manual patient → linked (`patient.linked_to_source`); MRN equal, birth date different →
      `mrn_conflict` with the manual patient's ID; otherwise a new row. No fuzzy matching.
      **Built** (`src/domain/integrations/sync-upsert.ts`): the update writes only the columns that differ (member ID
      compared decrypted, so an unchanged value is not re-encrypted); a patient with no billing-minimum change is
      `unchanged` (no write, no audit; the run-level `integration.sync_completed` counts it); a link also writes an
      issue row `linked_to_source`; every patient write is audited `patient.synced_created|synced_updated|
      linked_to_source` (plus `source_inactivated|merged` on a change), as the service principal, reason `ehr_sync`.
- [x] Page-by-page commits; watermark advances only on success to the first page's server time minus
      5 minutes. One run per connection (partial unique on `(tenant_id, connection_id)` while
      `queued`/`running`); no heartbeat for 20 min → `abandoned`. Sync now once a minute.
      **Built**: one transaction per page (or re-derive batch); `has_synced` is set by the first page that stored a
      patient (a page that stored nothing doesn't lock the endpoint); the watermark is the first page's server time
      (clamped to our clock) minus 5 minutes, never backwards, written only on success. "Sync now" is limited to once
      a minute per connection (bucket `integration_sync_now`), refuses while a run is queued or running, and
      abandons a run with no heartbeat for 20 minutes first (`abandonStaleRuns`, the database clock).
- [x] Sync never writes `claims` or claim versions; the 837P builder (claims C3) snapshots patient
      demographics into the claim version at submission (R-3.10.3).
      **Built**: the engine touches only `patients`, `integration_*` and `audit_events`; a test asserts no `claims` or `claim_versions` row appears.
- [x] Payer mapping page (step-up), `/settings/integrations/[id]/payers` (PI2b UI slice; no migration,
      no GRANT: `integration_payer_mappings` grants SELECT/INSERT/UPDATE to the app role and has tenant
      RLS; `src/domain/integrations/payer-mappings.ts`): payor keys (`Organization/<id>`, with the
      Organization name when the sync recorded one) → a payer of this practice, or not mapped. The page
      lists every key a synced patient of the connection carries (with a patient count) plus every key
      that already has a mapping row, with one select of the practice's payers per key. **Counts are of
      live patients only** (`source_status IS NULL`, so not inactive, merged, or gone; decided
      2026-09-28), while any stored key still counts as reported: a key carried only by patients who are no
      longer live is listed with 0 and can be mapped, and `affected_patient_count` in the audit event
      counts the same live patients. A stored key that fails the save rules (over 256 characters, or
      containing control, zero-width, or bidi characters) is listed **read-only, marked and cut, with a
      note**, never submitted and never a reason to refuse the rest of the form. Administrators
      only (any other role gets a 404 on the page and `error.notAdmin` from the action and the domain).
      **Saving needs an MFA step-up in the last five minutes** (`requireStepUp`, checked before any
      line is validated or written; the page shows the step-up link and `/step-up` returns to this page, which
      `stepUpTarget` now allows). Refusals, in order: not an administrator; no recent step-up; a
      malformed form (fixed shape, at most 500 lines, no duplicate key, payer empty or a UUID); a
      connection that isn't the practice's (not found) or is revoked; an insurer the connection never
      reported (no mapping row and no patient carries the key: keys can't be planted); a payer that isn't
      the practice's own; a line whose mapping changed since the page was opened (each line carries the
      mapping's `updated_at`, checked under a row lock). Only lines that change something are written
      (a payer set, changed, or cleared to "not mapped"). **Each written line is one
      `integration.payer_mapping_changed` event in the same transaction** (entity = the mapping row's
      own ID; metadata: `connection_id`, `payer_id`, `previous_payer_id`, `change` =
      `mapped|changed|cleared`, `affected_patient_count`, `step_up_verified_at`, `session_id`; the audit
      `reason` is the fixed code `payer_mapping`; **never the payor key,
      the name, or a patient**, since a payor key is Restricted PHI on the patient row it comes from), so
      a failed audit write rolls the whole save back. Viewing the page is audited
      `integration.payer_mappings_viewed` (connection ID, insurer and patient counts, `session_id`, reason
      `payer_mapping`). The page says a saved mapping applies to a patient when the sync next updates that
      patient's coverage (see the open item below). Every string is
      an en/es/pt key. Tests: `test/integration/integration-payer-mapping.test.ts` (isolation, non-admin
      refused, step-up required at 4:55 / 6:00 / from-the-future, foreign connection and foreign payer,
      planted key, a key reported only by another connection of the same practice, stale page and a
      first-decision race, audit atomicity, PHI-free audit, live-only counts, more than 500 insurers, an
      unsavable stored key, the page and the action, a revoked connection read-only).
- [x] **The sync mapper enforces the payor-key rules on write** (PI2b sync engine): a payor key stored in
      `patients.coverage_payor_key` or `integration_payer_mappings.payor_key` is 1 to 256 characters
      and contains no control, zero-width, or bidi character (the same rules `isSavablePayorKey` applies
      when a save is read); a key that fails is not stored, and the resource is skipped with a code.
      Test: a Coverage whose payor reference is over-long or has an invisible character is skipped and
      writes neither a patient key nor a mapping row. Until then the page lists such a stored key
      read-only.
      **Built by construction and by test**: the mapper accepts a payor only as `Organization/<id>` with `<id>` a FHIR id
      (1 to 64 characters of letters, digits, `-` and `.`), so the stored key is at most 77 characters and can hold no
      control, zero-width, or bidi character; a Coverage whose payor reference fails that is not used (the patient is
      stored with coverage `needs_review`, no payer, no member ID), and writes neither a patient key nor a mapping
      row. The display name is stored only if it is at most 200 characters with no invisible character.
- [x] **Apply a saved mapping to the patients that carry the key** (the second half of the spec's
      "one audited update of affected patients"; **open, by design of the database**). A synced patient's
      `primary_payer_id`, `coverage_status`, and member ID are read-only outside a running sync run
      (trigger `patients_synced_readonly`), and the run's own context (`withTenantAsSystem`) belongs to the
      sync engine, so the mapping page saves the decision and records how many patients it concerns
      (`affected_patient_count`) but does not touch a patient. The sync must re-derive coverage for every
      patient whose payor key has a mapping newer than the patient's `synced_at`, even when the
      resource's `versionId` is unchanged ("same `versionId` = unchanged" would otherwise never apply a
      new mapping), and audit that update once per run (`patient.synced_updated`, changed field names).
      Until then the page says what a mapping is for, not that it has been applied.
      **Built** (`findRederiveCandidates`, `rederiveCoverage`, `sync.ts` `rederivePass`): at the start of every run,
      before the Patient pages, the sync finds this connection's synced patients whose mapping row's `updated_at` is
      newer than the patient's `synced_at`, fetches only their Coverage, re-derives payer, coverage status, payor key
      and member ID, and updates and audits (`patient.synced_updated`, changed field names, one event per patient per
      run) the ones that changed; a patient whose derivation did not change only has `synced_at` refreshed (no audit
      event, no `updated_at` bump), so it leaves the set. Works at an unchanged `versionId` and for a patient that
      isn't in the Patient search at all. Up to 10,000 patients a run. Tests: `sync-engine.test.ts` "payer
      mappings" (mapped, applied once, cleared, and unchanged-touch cases; mapping rows created by the sync use the
      service principal and are never overwritten). The mapping page's wording "applies when the sync next updates" is
      now accurate for the next run.
- [x] Sync history (`/settings/integrations/[id]/runs`, admin; PI2b UI slice,
      `src/domain/integrations/sync-history.ts`): every run of the connection, newest first (25 a page),
      as counts (created, updated, linked, skipped), status, queued and finished times, who started it as
      "Sync now" or "Schedule" (never a user ID or name), the run's issue codes, and its HTTP status; one
      run's issue rows (`?run=<uuid>`, at most 200) list a code and, when the record became a patient, a
      link to that patient by DenialDesk ID (the link text is "Open patient": no name and no visible
      identifier). The selects name their columns, so nothing else can reach the page: no resource,
      external ID, MRN, name, URL, watermark, or `diagnostics` (a test walks the page's element tree for a
      synced patient's name, MRN, external ID, and payor key). **A stored code is shown only through the
      fixed allow-list in `src/domain/integrations/sync-codes.ts`** (`SYNC_RUN_CODES`,
      `SYNC_ISSUE_CODES`, with type guards), as a translated label (`runs.code.<code>`, en/es/pt);
      **anything not listed shows as "Other", never as the stored string** (the database CHECK only
      bounds the shape, so the page can't trust a stored code to be PHI-free). The lists start from the
      codes this spec names and contain no sensitivity, restriction, minor, or Part 2 code (a unit test
      refuses any list entry containing such a word). A page past the last is clamped to the last page,
      and the "no sync has run yet" message shows only when the connection has no runs. A run ID that
      isn't this connection's (another connection's or practice's) is a message, never listed.
      Administrators only (404 otherwise). The run list (counts and codes) is not audited; **opening one
      run's issue rows is** (`integration.sync_run_viewed`: entity = the run, metadata `connection_id`,
      `row_count`, `session_id`, reason `sync_history`; IDs and a count only). Tests:
      `test/integration/integration-sync-history.test.ts`, `src/domain/integrations/sync-codes.test.ts`.
- [x] **The sync engine writes codes only from `sync-codes.ts`, and keeps them PHI-free** (PI2b sync
      engine; the engine's own module path is reconciled with `src/domain/integrations/sync-codes.ts`
      at merge). Every value written to `integration_sync_runs.issue_codes` and
      `integration_sync_issues.code` is a member of `SYNC_RUN_CODES` or `SYNC_ISSUE_CODES` (an R4
      `OperationOutcome.issue.code` outside the list is stored as `other`). **A code on a row linked to
      a patient must not reveal what the EHR says about the patient beyond a data-quality defect:**
      never a sensitivity label (HIV, psychiatric, substance use, 42 CFR Part 2, ethnicity, domestic
      violence), a restriction (R/V), minor status, a diagnosis, or a program. Test: for every skip and
      link path of the mapper, and with restricted, sensitive, and minor synthetic patients, the stored
      codes are all on the allow-list and none is derived from `meta.security`, `birthDate`, or a
      clinical resource.
      **Built**: `src/domain/integrations/sync-codes.ts` is the one module (the engine extended #91's lists; the
      mapper's, transport's and R4 groupings are defined in `src/integrations/fhir/sync-codes.ts` and asserted to be
      inside the lists). Every value written to `issue_codes` or `integration_sync_issues.code` goes through
      `normalizeRunCodes` / `normalizeIssueCode` (anything not listed is stored as `other`). A minor is recorded
      with the neutral `review_required` (never a minor, sensitivity, or restriction code; `source_restricted`
      and the labels produce no code at all). One code was renamed to fit the CHECK: `not_fhir_r4` is stored as
      `not_fhir`. Tests: `sync-codes.test.ts`, `sync-codes-engine.test.ts` (every code the mapper, the failures and the
      R4 mapping can produce is listed).
- [x] Synthetic sandbox (base URL `https://sandbox.fhir.denialdesk.invalid/r4`, in-process
      `SandboxTransport`, only when `syntheticDataOnly()`): token endpoint verifies the assertion
      (signature, alg allow-list, `aud`, `exp`, `jti` remembered until `exp`); deterministic
      `SYN-` resources with a synthetic `meta.tag`, multi-page, and one each of: inactive,
      `replaced-by`, partial birth date, dependent coverage, unmapped payor, non-Organization payor,
      `R` label, `HIV` label, unknown label, minor, SSN-shaped MRN.
      **Built** (`src/integrations/fhir/sandbox/`): 125 deterministic Synthea-style synthetic patients (seeded PRNG,
      `SYN-` MRNs and member IDs, a synthetic `meta.tag`, Florida cities and made-up addresses, 555-01xx phone numbers
      that the sync must never store), two pages at `_count=100`, and the fixtures `SANDBOX_FIXTURES` (inactive,
      `replaced-by`, partial birth date, dependent coverage, unmapped payor, non-Organization payor, `R`, `HIV` and an
      unknown label, a minor, an SSN-shaped MRN, no coverage, a secondary coverage). The token endpoint verifies the
      assertion against the public half of the signing key (signature, ES384/RS384 only, `kid`, `typ`, `iss`, `sub`,
      `aud`, `exp` and lifetime ≤ 5 min, `jti` remembered until `exp`) and issues an opaque bearer token; searches
      need it and the scope. Test connection, Submit and Sync now all work for the sandbox (needs the shared
      signing key configured, OA-064). `submit.blocked.sandbox` and `test.error.sandboxUnavailable` were reworded and
      the Test panel now shows for the sandbox. **Migration 0043 also replaces the sandbox CHECK**: 0040 pinned the
      sandbox issuer to the string `sandbox-client`, which discovery never produces (it records the base URL), so a
      passing test could not pin it; the issuer is now NULL or the base URL.
- [x] Test: `APP_ENV=production` on Netlify refuses a real endpoint and allows only the sandbox.
      **Built**: `src/app/(app)/settings/integrations/test-deps.test.ts`; the run-level refusals are in `sync-engine.test.ts` and `sync-now.test.ts`.
- [x] Update `docs/data-sources.xlsx` with the FHIR R4 source.

### Sync run and issue codes (PI2b)
The codes on `integration_sync_runs.issue_codes` and `integration_sync_issues.code` are shown on screen as raw
labels on the sync-history page, which is not audited and must contain no PHI. They are a **fixed vocabulary
defined in code** (`src/domain/integrations/sync-codes.ts`: `SYNC_RUN_CODES`, `SYNC_ISSUE_CODES`), lower-case
snake_case, no digits (the CHECK is `^[a-z_]{1,64}$`), each with a `runs.code.<code>` label in en/es/pt. Nothing
from a server is stored verbatim: anything not listed is `other`. A code on a patient row never names a
sensitivity, restriction, minor or Part 2 category.

| Family | Codes |
|---|---|
| Record skipped (issue row, counted in `skipped_count`) | `resource_invalid`, `id_invalid`, `mrn_missing`, `mrn_ambiguous`, `mrn_invalid`, `mrn_government_identifier`, `mrn_looks_like_ssn`, `mrn_looks_like_mbi`, `name_incomplete`, `name_invalid`, `birthdate_incomplete`, `birthdate_invalid` |
| Record stored, with a note (issue row) | `address_incomplete`, `review_required` (a new patient the administrator should look at; the reason is not stated) |
| Matching (issue row, names the other patient) | `mrn_conflict` (skipped), `linked_to_source` (linked) |
| Run notice | `issues_truncated` (only the first 1,000 issue rows of a run are kept) |
| Why a run failed | `unreachable`, `tls_failed`, `timeout`, `address_refused`, `redirect_refused`, `content_type_refused`, `too_large`, `paging_loop`, `bad_response`, `not_fhir`, `smart_config_invalid`, `capability_missing`, `auth_refused`, `issuer_mismatch`, `token_endpoint_changed`, `not_synthetic`, `environment_refused`, `signing_key_unavailable`, `connection_not_active`, `internal_error` |
| R4 `OperationOutcome.issue.code` (only if exactly an R4 IssueType code, hyphen → underscore) | `invalid`, `structure`, `required`, `value`, `invariant`, `security`, `login`, `unknown`, `expired`, `forbidden`, `suppressed`, `processing`, `not_supported`, `duplicate`, `multiple_matches`, `not_found`, `deleted`, `too_long`, `code_invalid`, `extension`, `too_costly`, `business_rule`, `conflict`, `transient`, `lock_error`, `no_store`, `exception`, `timeout`, `incomplete`, `throttled`, `informational` |
| Anything else | `other` |

`scope_insufficient`, `invalid_client` and `needs_review` are on the lists for the history page but are not
written by the engine today (a 400 at the token endpoint is `auth_refused`).

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
- [ ] **Lift the `population_scope_unenforced` refusal** (`assertRunEnvironment`, `syncNow`) only together with the
      code that applies `population_scope` (the practice's Group export, or the operator-verified filter), and a test
      that a real connection syncs that population and nothing else. Until then no real connection can sync.
- [ ] ⚠️ VERIFY (Coverage page cap): PI2b caps a Coverage chunk at 20 pages (`too_large`). A server that ignores `_count`
      and returns a huge single page, or one that pages Coverage far below the requested size, could hit that cap for a
      large practice; check each vendor's behavior before the first real connection and revisit the cap with PI4.
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
| `mrn` | `Patient.identifier` whose `system` = the connection's MRN system | `identifier` 1..*, MS `system`, `value` | Exactly one, else `mrn_missing`/`mrn_ambiguous`; visible ASCII, 1 to 40 characters (the `patients` CHECK), else `mrn_invalid`. `ddd-dd-dddd` → `mrn_looks_like_ssn`; any standalone run of exactly nine digits (also when separators split it) too, unless the operator recorded "MRNs contain a nine-digit number"; MBI-shaped (CMS format, ⚠️ VERIFY) → `mrn_looks_like_mbi` |
| `first_name`, `last_name` | `Patient.name` (official, else usual, else the only one): `given[0]`, `family` | MS | Missing → `name_incomplete`; each name at most 60 characters (the `patients` CHECK), else `name_invalid` |
| `birth_date` | `Patient.birthDate` | MS | Full date, 1900..today; partial → `birthdate_incomplete`. Under 18 (on the practice's calendar date, `America/New_York`) → the new patient gets the neutral history note `review_required`; nothing is tagged, restricted or named "minor" automatically (OA-081) |
| `sex` | `Patient.gender` | 1..1 | female → F, male → M, other/unknown → U (837P DMG03) |
| `address_line1`, `city`, `state`, `postal_code` | `Patient.address` (home or no use, current) | MS | Invalid → all four null + `address_incomplete` |
| `source_status` | `Patient.active`, `Patient.link` `replaced-by` | not MS | PI3 |
| `source_restricted`, `source_sensitivity` | `Patient.meta.security` | — | Restricted if confidentiality `R`/`V`, an ActCode sensitivity code (`HIV`, `PSY`, `ETH`, `SDV`, `42CFRPart2`; ⚠️ VERIFY), or **any unrecognized label**. Codes stored as a fixed vocabulary (`unknown` for unrecognized) |
| `primary_payer_id`, `coverage_payor_key` | primary Coverage `payor` | 1..1 MS | Must reference `Organization`, else `needs_review`; payer only by explicit mapping (CLAUDE.md #9). The payor name is the reference's own `display`; PI2b fetches no `Organization` resource (the scope is requested for a later lookup) |
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
- Environment: `INTEGRATION_SIGNING_KEY` (pre-production only, functions-only secret; production refuses it);
  `INTEGRATION_JOB_SECRET` (Key Vault in production); `INTEGRATION_ALLOWED_PORTS` (default `443`).

**Classification (§9.1):** synced demographics, member ID, `external_id`, `coverage_payor_key` —
Restricted PHI (identifiers never logged or audited); `source_restricted`/`source_sensitivity` —
Restricted-Sensitive PHI; connections, registry, mappings — Confidential configuration; runs and
issues — Internal; JWKS — Public; private signing keys and the job secret — **Secret** (credentials;
outside the §9.1 data classes, R-7.3.5). ⚠️ **Open (OA-075): is a payor key detached from any
patient's PHI?** A payor key (`Organization/<id>`) names an insurer, not a person, but it sits on the
patient row (`coverage_payor_key`, Restricted PHI above) and the mapping rows repeat it
(`integration_payer_mappings`, classified Confidential above). The owner's answer decides whether the
mapping table is reclassified from Confidential to Restricted; until then the pages that show keys are
audited and no audit event or log carries a key.

**Audit events** (never MRNs, names, external ids, tokens, query strings; the payer mapping and sync
history reads and writes of PI2b are listed with their items):
`integration.connection_created|updated|submitted|tested|activated|paused|resumed|withdrawn|errored|revoked`
with old/new base URL, token endpoint host + path, and client ID — always the normalized value
with no query string or fragment (configuration, not PHI);
`integration.transport_refused` (`address_refused`, `tls_failed`, `redirect_refused`; connection ID
and the code only), `security.env_signing_key_in_production`,
`integration.registry_conflict`, `integration.payer_mapping_changed` (one per changed mapping: mapping,
connection, and payer IDs, counts, never a payor key or name), `integration.payer_mappings_viewed`, `integration.sync_run_viewed`,
`operator.integration_approved|rejected`, `integration.sync_started|completed|failed` (counts; the
run-level `sync_completed` is the record of receipt for unchanged and skipped resources),
`patient.synced_created|synced_updated|linked_to_source|source_inactivated|source_merged|source_gone`
(patient, connection, run IDs; changed field names).

_Audit note (PI2a Submit slice): `integration.connection_submitted` carries `previous_status`,
`status` (`pending_approval` or `active`), `sandbox`, `step_up_verified_at`, and `test_kid`; for a
real connection also the endpoint configuration (normalized base URL, client ID, MRN identifier
system, token endpoint and issuer), `registry_claimed`, `us_residency_attested`,
`attestation_version`, `attestation_locale` (the displayed locale), and `attestation_text_sha256`. A
Submit refused for a missing test, step-up, or
attestation writes nothing; one refused for rate limiting writes `security.rate_limited` (bucket
`integration_submit`). `security.env_signing_key_in_production` is emitted by Test connection
only; Submit and Resume refuse the same misconfiguration without a second security event._

_Audit change for SIEM consumers (PI2a lifecycle slice): withdraw is recorded as
`integration.connection_withdrawn`, not `integration.connection_updated` with
`transition: withdrawn` (the form #81 and the first version of this branch used). Revoke
additionally carries `reason_code` in its metadata (the code is also in the audit `reason` column) and
`previous_status_reason`; resume carries `previous_status_reason` and `step_up_verified_at`;
step-up events carry `route`/`route_id` (a route template and a UUID, never the raw path), and a
step-up refused at the lockout limit is `auth.locked_out` (`source: step_up`) or
`auth.step_up_refused` (`reason: locked`)._

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
- **OA-066** Approval method and contact-role lists. **OA-067** R-15.9 sign-off for the registry-conflict operator alert. **OA-068** Whether Reject clears the attestation. **OA-069** Notifications spec (activation notice). **OA-070** Retention of approval evidence. **OA-071** Operator-side revoke. **OA-072** Single-person approval and the operator account. **OA-073** Operator step-up before Approve. **OA-074** CI runs as a superuser, so FORCE RLS on owner and platform paths is never exercised: a non-superuser, NOBYPASSRLS owner role in CI (R-15.9). **OA-075** Is a payor key detached from any patient PHI? (Decides whether `integration_payer_mappings` is Confidential or Restricted.) **OA-076** Migration 0043 (the service-principal identity): **resolved, approved by the owner 2026-09-29** (R-15.9). **OA-077** Three small sync decisions: (a) Sync now in-request until jobs ship; (b) the neutral `review_required` note for a new minor, chosen so the unaudited history page never names a minor or a sensitivity category (the audited patient page is where a person can see why); (c) Coverage-only change search. **OA-078** Member-ID field encryption has no AAD binding to record or practice, app-wide (needs an ADR and a re-encryption migration). **OA-079** Linking a synced patient overwrites a manually entered patient with the same MRN (and birth date): confirm that is wanted. **OA-080** Store the source's sensitivity category, or only the `source_restricted` flag. **OA-081** Should minors be restricted by default. **OA-082** Restricted patients are visible to every role until patients P4 masking: accept the interim?
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
  `approval.ts` (operator), `payer-mappings.ts`, `sync-history.ts`, `sync-runs.ts`, `sync.ts`, `principal.ts`.
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
- **Test infrastructure gap (open; needs a CI change and the owner's decision; raised 2026-09-28,
  after PR #89).** CI connects to PostgreSQL as a superuser, which ignores row-level security even
  on `FORCE` tables, so the integration suite never exercises FORCE RLS on the **owner and platform
  paths** (`withTenantAsPlatform`, which the operator's Approve and Reject, BAAs, and University
  access use, and the owner-role `systemDb()` reads in tests). Only the practice path
  (`set local role denialdesk_app`) runs under the policy. A missing `app.tenant_id` or a policy
  that hides rows from the owner would pass CI and surface at the first non-superuser deploy
  (Netlify preview, Azure). **Proposed:** run migrations and `pnpm test:integration` as a
  non-superuser, `NOBYPASSRLS` schema-owner role (setup that must bypass policies, such as
  `createTestTenant`, keeps a separate superuser connection), and add a test asserting the test
  connection's role has neither `rolsuper` nor `rolbypassrls`. Not changed here: it touches the CI
  workflow and `docker-compose.yml`. Owner action item **OA-074** (an R-15.9 decision);
  recorded in `docs/PROJECT_STATE.md` (open questions).
