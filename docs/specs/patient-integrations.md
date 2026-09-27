# Spec: Patient integrations (Patient Register synced from the EHR/PM over FHIR R4)

Status: approved by owner in chat 2026-09-27 (design); PI0 docs
Roadmap item: Phase 1 → integrations (REQUIREMENTS §8.8 "EHR/PM systems via FHIR R4"); prerequisite
for charge capture by EHR integration (§8.2 step 2)
Requirement IDs: §8.8, R-3.3.1, R-5.1.2, R-7.1.3, R-7.2.3, R-7.2.4, R-7.3.1, R-7.3.3, R-7.3.4,
R-7.3.5, R-7.4.1, R-7.4.5, R-7.4.6, R-7.4.7, R-7.4.8, R-7.5.1, R-7.9.2, R-9.2.1, R-11.1, R-15.1,
R-15.7. ⚠️ No numbered requirement covers EHR interoperability yet (§8.8 is a bullet list; R-4.4.1
is the payer prior-auth API, not this): spec-writer to assign one (OA-054).
Design: ADR `docs/decisions/0010-patient-data-synced-from-ehr.md`. Threat model:
`docs/threat-models/patient-integrations.md`. Supersedes in part: `specs/patients.md` (P1 forms).

## Goal
The practice's EHR/PM is the system of record for patients. An administrator connects it once
(HL7 FHIR R4, US Core) and the Patient Register becomes an encrypted, read-only copy of only the
billing minimum, refreshed by sync. Staff stop typing demographics into DenialDesk; claims and
denials keep working when the EHR is down.

## Owner decisions (2026-09-27, in chat)
1. "For Patient Register we want to sync data, not hold any of the data, so we will place a
   drop-down in the nav bar beside the table and select an integration so we can connect to this
   table only. We'll evaluate what tables this is needed in the future. Follow medical integration
   practices."
2. "Not hold" means a **synced read-only copy**: the EHR/PM is the system of record; DenialDesk keeps
   an encrypted, read-only copy of the billing minimum, refreshed by sync; no typing or editing of
   synced demographics; claims/denials keep working if the EHR is down.
3. First connector: **HL7 FHIR R4 / US Core only** (not HL7 v2 ADT, not CSV, not manual-as-connector).
4. Scope: the Patients table only; other tables evaluated later.

## Standards (cite; vendor specifics are ⚠️ VERIFY)
- FHIR R4 4.0.1 — https://hl7.org/fhir/R4/ (search `_lastUpdated`, paging via `Bundle.link[next]`:
  https://hl7.org/fhir/R4/search.html, https://hl7.org/fhir/R4/http.html#paging).
- US Core **6.1.0** Patient and Coverage — https://hl7.org/fhir/us/core/STU6.1/ . ⚠️ VERIFY: the
  version certified EHRs must support under ONC HTI-1 (USCDI v3) from 2026-01-01.
- SMART App Launch v2 **Backend Services** — https://hl7.org/fhir/smart-app-launch/STU2/backend-services.html ;
  asymmetric client auth (`private_key_jwt`, RFC 7523) —
  https://hl7.org/fhir/smart-app-launch/STU2/client-confidential-asymmetric.html ; scopes —
  https://hl7.org/fhir/smart-app-launch/STU2/scopes-and-launch-context.html . ⚠️ VERIFY 2.0.0 vs 2.2.0.
- FHIR Bulk Data Access 2.0.0 (`Group/[id]/$export`, `_since`) — https://hl7.org/fhir/uv/bulkdata/STU2/
- Identifier types (MR, MB) — http://terminology.hl7.org/CodeSystem/v2-0203 ; confidentiality
  codes — http://terminology.hl7.org/CodeSystem/v3-Confidentiality .
- ONC 45 CFR 170.315(g)(10) (population services via Bulk Data + Backend Services) — ⚠️ VERIFY.

**Design change flagged:** US Core 6.1.0 does **not** require a server to support a population-wide
`Patient?_lastUpdated=…` search (its SHALL searches are `_id`, `identifier`, `name`,
`birthdate+name`, `gender+name`; ⚠️ VERIFY). Paged search therefore works only where the server
advertises `_lastUpdated` on Patient in its CapabilityStatement (Coverage-only changes need it on
Coverage too, else they wait for the patient to change or for PI3's reconciliation); "Test connection"
checks this and activation is refused otherwise. Bulk Data `Group/$export` — what certified EHRs are
required to offer for population access — moves from "later" to **PI4, before the first real
practice** (OA-050).

## User stories
- As an administrator, I connect our EHR/PM to the Patient Register in Settings › Integrations,
  test it without pulling any patient, and activate it.
- As an administrator, I press "Sync now" or pause sync from the data-source drop-down beside the
  Patients tab, and I read the sync history (counts only).
- As an administrator, I map each insurer the EHR sends to one of our payers; unmapped insurers stay
  unmapped, never guessed.
- As any user, I see beside the Patients tab where patient data comes from and when it last synced.
- As a billing specialist, I bill a synced patient exactly as before; I cannot change their
  demographics in DenialDesk and the chart tells me to fix them in the EHR.

## Acceptance criteria

### PI0 — design docs
- [x] This spec, ADR 0010, threat model, notes in `specs/patients.md` and `specs/erp-shell.md`.

### PI1 — data model, provenance, read-only enforcement, connections (no network calls)
- [ ] Migration adds provenance to `patients` (see Data changes); existing rows become
      `source = 'manual'`; no data change otherwise.
- [ ] A DB trigger refuses INSERT of a `fhir` row, any change to a synced column of a `fhir` row,
      and any change of `source`/`source_connection_id`/`external_id`, unless the transaction-local
      setting `app.sync_connection_id` equals the row's connection. `fhir → manual` is always refused.
      Trigger message added to `TRIGGER_MESSAGE_FORMATS` (ADR 0006). Integration tests cover each case.
- [ ] Domain: `updatePatient` refuses synced patients (before the trigger) with a translated error.
      Sensitivity tags (administrators) and custom field values stay editable on synced patients.
- [ ] New tables `integration_connections`, `integration_payer_mappings`, `integration_sync_runs`,
      `integration_sync_issues`: RLS ENABLE + FORCE, tenant policy, isolation tests (read, insert,
      update across tenants), no DELETE grant.
- [ ] At most one non-draft connection per practice and target table (partial unique index).
- [ ] New permission `canManageIntegrations` (admin only); pages and server actions refuse others.
- [ ] Settings › **Integrations** tab is live: lists connections (name, kind, status, last sync);
      "New connection" opens `/settings/integrations/new` (own page, DESIGN.md §8) for a FHIR R4
      connection saved as **draft**; `/settings/integrations/[id]` shows and edits it.
- [ ] Base URL validation on save: `https` only, hostname (no IP literal), no userinfo, no query or
      fragment, port 443 unless listed; in non-production only the built-in sandbox or a host on the
      pre-production allow-list (empty by default); in production the sandbox is refused.
- [ ] Saving a real (non-sandbox) connection requires the administrator to tick "This EHR/PM
      endpoint stores and processes data only in the United States" (§ 408.051(3)); recorded in the
      audit event as `usResidencyAttested: true`.
- [ ] Connection display name is warned "no patient information" (like custom field labels).
- [ ] Base URL, client ID, and MRN identifier system can be changed only in `draft` or `paused`;
      any change returns the connection to `draft` (re-test needed). Connections are never deleted.
- [ ] Tab bar: the Patients tab carries a data-source drop-down (acceptance criteria in
      `specs/erp-shell.md`); in PI1 it shows "Source: Manual" or the draft/paused state.
- [ ] Every string in en/es/pt (R-11.1).

### PI2 — FHIR client, synthetic sandbox, test, activate, Sync now, history
- [ ] FHIR client in `src/integrations/fhir/` over a `FhirTransport` interface: `HttpsTransport`
      (node:https, TLS ≥ 1.2, `lookup` hook rejecting loopback/private/link-local/CGNAT/multicast/
      unique-local/IPv4-mapped addresses for every resolved IP, no redirects, 20 s timeout, 10 MB
      response cap, `application/fhir+json` only) and `SandboxTransport` (in-process, no socket).
- [ ] Discovery: `GET [base]/.well-known/smart-configuration` and `GET [base]/metadata`; require
      `fhirVersion` 4.0.1, `private_key_jwt` with ES384 or RS384, a `token_endpoint` that passes the
      same URL rules, Patient search with `_lastUpdated`, and Coverage search with `patient`.
- [ ] The discovered token endpoint is shown to the administrator and **pinned** on the connection at
      test time; a later discovery that returns a different one sets the connection to `error`
      ("token endpoint changed — re-test") instead of following it.
- [ ] Client assertion per SMART Backend Services: `iss = sub = client_id`, `aud = token endpoint`,
      `exp` ≤ now + 5 min, unique `jti`, header `alg` (ES384 default), `kid`, `typ: JWT`; signed
      with node:crypto (no new dependency). Scopes `system/Patient.rs system/Coverage.rs
      system/Organization.rs`; fall back to v1 `.read` scopes only if the server lists no v2 scopes.
      Access tokens stay in memory for the run and are re-requested on expiry or 401 (once).
- [ ] DenialDesk publishes its public keys at `GET /.well-known/jwks.json` (public, rate-limited,
      current + next key for rotation, no private material).
- [ ] "Test connection" (admin): discovery + one token request; reads no patient data; records the
      outcome code; audited `integration.connection_tested`. "Activate" requires a passing test.
- [ ] Sync: `Patient?_lastUpdated=ge<watermark>&_count=100` following same-origin `next` links only;
      Coverage per page by `Coverage?patient=<id>&status=active` (or `_revinclude` when advertised),
      Coverage-only changes by `Coverage?_lastUpdated=ge<watermark>` when advertised. `_elements`
      limited to mapped elements when advertised (the mapper discards everything else regardless).
- [ ] Limits: 500 pages per run, 10 MB per response, 3 retries with exponential backoff honoring
      `Retry-After` (capped at 60 s); 401/403/`invalid_client` stops the run and sets `error`.
- [ ] Mapping exactly as in the table below; a resource that fails a required rule is skipped with an
      issue code, never partially guessed. In synthetic-only environments, an MRN or member ID not
      starting with `SYN` is skipped (`not_synthetic`) and the run fails closed after 1 such record.
- [ ] Idempotent upsert keyed by `(tenant_id, source_connection_id, external_id)`; a resource whose
      `meta.lastUpdated` is older than the stored `source_last_updated` is ignored (no regression);
      same `versionId` = unchanged.
- [ ] Linking: when no row has the external id, a manual patient with the same MRN **and** the same
      birth date in the same practice is linked (`source → fhir`, audited
      `patient.linked_to_source`); same MRN with a different birth date → not linked, not created,
      issue `mrn_conflict` with the manual patient's ID for the administrator. Otherwise a new row.
      No fuzzy or name-based matching. An MRN change in the source that collides → `mrn_conflict`.
- [ ] Each page commits in its own transaction; the watermark advances only when the run succeeds,
      to the server time of the first page (`Bundle.meta.lastUpdated`, else HTTP `Date`) minus a
      5-minute overlap.
- [ ] One run at a time per connection: partial unique index on `integration_sync_runs
      (connection_id) WHERE status IN ('queued','running')`; a run with no heartbeat for 20 min is
      marked `abandoned` by the next start. "Sync now" at most once per minute per connection.
- [ ] "Sync now" (admin) enqueues a run via the platform job adapter (Netlify background function in
      pre-production; Azure worker later); the drop-down shows "Sync running".
- [ ] Payer mapping: every Coverage payor seen (`Organization/<id>` on that server, with the
      Organization's name) is listed on the connection page; an administrator maps it to one of the
      practice's payers or leaves it unmapped. Mapping sets `primary_payer_id` on affected synced
      patients in one audited update; unmapping clears it.
- [ ] Sync history (`/settings/integrations/[id]/runs`, admin): runs with start/end, trigger,
      outcome, counts, issue codes; issues listing DenialDesk patient IDs link to the chart.
- [ ] **Synthetic FHIR sandbox**: base URL `https://sandbox.fhir.denialdesk.invalid/r4` (RFC 6761
      `.invalid`, can never resolve); served in-process only in non-production; its token endpoint
      verifies the client assertion (signature against DenialDesk's JWKS, `aud`, `exp`, `jti`
      replay); serves deterministic Synthea-style Patient/Coverage/Organization resources with
      `SYN-` MRNs and member IDs, identifier system `urn:denialdesk:synthetic:mrn`, multi-page
      results, one inactive, one `replaced-by` link, one partial birth date, one dependent coverage,
      one unmapped payor, and one `R` confidentiality label. Every resource carries
      `meta.tag` `urn:denialdesk:synthetic|synthetic`.
- [ ] Synced patient chart: "Synced from <connection> · updated <date>" and a read-only notice;
      "Edit" hidden.
- [ ] While the practice has a non-draft Patients connection (active, paused, or error — **brief
      refined**: paused still means the EHR is the system of record), "Register patient" and "Edit"
      are hidden for every patient and `registerPatient`/`savePatient` refuse (translated error
      "Patients come from <connection>; change them in your EHR"). Legacy manual patients that never
      matched stay read-only (OA-046). With no connection, today's forms work unchanged.
- [ ] Update `docs/data-sources.xlsx` (CLAUDE.md) with the FHIR R4 source.

### PI3 — scheduled sync and source-state hardening
- [ ] Scheduled run every 15 minutes per active connection (platform scheduler adapter; the
      scheduled function only enqueues, IDs only).
- [ ] `source_status`: `inactive` (Patient.active = false), `merged` (Patient.link type
      `replaced-by`), `gone` (404/410 on a direct read during a weekly reconciliation of rows not
      seen); none deletes a row (claims reference patients, R-9.2.1). Chart and list show the state.
- [ ] The weekly reconciliation also re-reads primary Coverage for every synced patient when the
      server does not advertise Coverage `_lastUpdated`.
- [ ] Three consecutive failed runs set the connection to `error` and show it in the drop-down.

### PI4 — Bulk Data (before the first real practice; OA-050)
- [ ] `Group/[id]/$export?_type=Patient,Coverage,Organization&_since=…` with the practice's Group
      id on the connection; NDJSON streamed with the same size limits and mapper.

## Field mapping (FHIR R4 / US Core 6.1.0 → `patients`)
Must-support (MS) notes are from the US Core 6.1.0 profiles, ⚠️ VERIFY against the published
StructureDefinitions at build.

| Column | FHIR source | US Core 6.1.0 | Rule |
|---|---|---|---|
| `external_id` | `Patient.id` | — | Required; FHIR `id` syntax, ≤ 64 chars |
| `source_version_id` | `Patient.meta.versionId` | not MS | Optional |
| `source_last_updated` | `Patient.meta.lastUpdated` | not MS | Absent → run time; no-regression rule |
| `mrn` | `Patient.identifier` whose `system` = the connection's MRN system → `value` | `identifier` 1..*, MS `system`, `value` | Exactly one match, else skip `mrn_missing` / `mrn_ambiguous`. `type` = MR not required (not MS; **brief refined**). Existing length CHECKs |
| `first_name`, `last_name` | `Patient.name`: `use` official, else usual, else the only name; `given[0]`, `family` | `name` MS (`family`, `given`) | Missing either → skip `name_incomplete` |
| `birth_date` | `Patient.birthDate` | MS | Full `YYYY-MM-DD` only, 1900..today; partial → skip `birthdate_incomplete` |
| `sex` | `Patient.gender` | 1..1 | female → F, male → M, other/unknown → U (837P DMG03) |
| `address_line1`, `city`, `state`, `postal_code` | `Patient.address`: `use` home or absent, period current; `line[0]`, `city`, `state`, `postalCode` | `address` MS | State 2-letter USPS, ZIP or ZIP+4; otherwise all four null + issue `address_incomplete` (patient still synced) |
| `source_status` | `Patient.active`, `Patient.link` (`replaced-by`) | not MS | See PI3 |
| `source_confidentiality` | `Patient.meta.security` (v3-Confidentiality `R` / `V`) | — | Stored; chart shows "Restricted in source"; masking with P4 of `specs/patients.md` (OA-052) |
| `primary_payer_id` | primary Coverage `payor` → `integration_payer_mappings` | `payor` 1..1 MS | Mapped exactly or null; never guessed (CLAUDE.md #9) |
| `member_id_enc`, `member_id_last4` | primary Coverage `identifier` with type MB, else `subscriberId` | `identifier:memberid`, `subscriberId` MS | Encrypted (R-7.3.3), last 4 in clear |
| `coverage_status` | primary Coverage selection | — | `none` / `mapped` / `unmapped` / `needs_review` |
| `phone` | **not synced** (null) | — | Owner may revisit (OA-047) |

Primary Coverage = `status` active, `beneficiary` this patient, `period` covering today, lowest
`order`; `relationship` must be `self`. Several candidates with no `order` → `needs_review`, no
payer, no member ID. A dependent (relationship ≠ self) → `needs_review` until patients P2 adds
subscriber-other-than-patient (OA-055). **Not synced:** telecom, email, race, ethnicity, birth sex,
gender identity, language, contacts, general practitioner, SSN, any clinical resource.

## Data / API changes
Migrations take the next free numbers at build time (today 0039+; PROJECT_STATE lesson).

- `patients` + `source text NOT NULL DEFAULT 'manual' CHECK IN ('manual','fhir')`,
  `source_connection_id uuid`, `external_id text`, `source_version_id text`,
  `source_last_updated timestamptz`, `synced_at timestamptz`, `source_status text CHECK IN
  ('active','inactive','merged','gone')`, `source_confidentiality text`, `coverage_status text`,
  `coverage_payor_key text` (the `Organization/<id>` reference, for re-mapping without a refetch).
  CHECK: `source = 'fhir'` ⇔ connection, external id, status all set. Unique
  `(tenant_id, source_connection_id, external_id) WHERE source = 'fhir'`. Composite FK
  `(tenant_id, source_connection_id) → integration_connections (tenant_id, id)`.
  Trigger `patients_synced_readonly` (PI1 criteria).
- `integration_connections`: `id`, `tenant_id`, `target_table` (CHECK `'patients'`), `kind`
  (CHECK `'fhir_r4'`), `is_sandbox bool`, `display_name`, `base_url`, `token_endpoint` (pinned),
  `client_id`, `mrn_identifier_system`, `signing_key_ref` (key name, never key material), `status`
  (`draft`/`active`/`paused`/`error`), `status_reason` (code), `us_residency_attested_by/_at`,
  `patient_watermark`, `coverage_watermark`, `last_success_at`, `last_run_id`, `bulk_group_id` (PI4),
  `created_by/_at`, `updated_by/_at`. Partial unique `(tenant_id, target_table) WHERE status <> 'draft'`.
- `integration_payer_mappings`: `tenant_id`, `connection_id`, `payor_key`, `payor_name` (Organization
  name, not PHI), `payer_id` (nullable; composite tenant FK), `updated_by/_at`. Unique
  `(connection_id, payor_key)`.
- `integration_sync_runs`: `id`, `tenant_id`, `connection_id`, `trigger` (`manual`/`scheduled`),
  `triggered_by` (user, nullable), `status` (`queued`/`running`/`succeeded`/`failed`/`abandoned`),
  `started_at`, `heartbeat_at`, `finished_at`, `watermark_from`, `watermark_to`, counts (`fetched`,
  `created`, `updated`, `linked`, `unchanged`, `skipped`, `inactivated`, `errors`), `issue_codes
  text[]` (our fixed codes and FHIR `OperationOutcome.issue.code` values only), `http_status`.
  **Refined from "append-only":** a trigger allows updates only while `queued`/`running` and freezes
  the row once finished; no DELETE grant.
- `integration_sync_issues` (append-only): `run_id`, `code`, `patient_id` (nullable; DenialDesk ID
  only). Never MRNs, names, external ids, or resource content.
- Routes: `GET /.well-known/jwks.json` (public). Pages `/settings/integrations`,
  `/settings/integrations/new`, `/settings/integrations/[id]`, `/settings/integrations/[id]/runs`.
  Server actions: create/update draft, test, activate, pause, resume, sync now, map payer. No
  identifiers in any URL.
- Environment: `INTEGRATION_SIGNING_KEY` (PEM, P-384) and `INTEGRATION_SIGNING_KEY_ID` in
  pre-production; Azure Key Vault key (sign operation, non-exportable) at cutover (ADR 0010).
  `INTEGRATION_SANDBOX_HOSTS` (non-production allow-list; empty).

**Classification (REQUIREMENTS §9.1):** synced patient columns — Restricted PHI (unchanged);
`external_id`, `coverage_payor_key` — Restricted PHI (identifiers in a patient row; never logged or
audited); connections, payer mappings — Confidential configuration; sync runs and issues — Internal
(counts, codes, DenialDesk IDs); JWKS — Public.

**Audit events (IDs, counts, enum codes only; never MRNs, names, external ids, URLs, tokens):**
`integration.connection_created|updated|tested|activated|paused|resumed|errored`,
`integration.payer_mapping_changed`, `integration.sync_started|completed|failed` (run ID, counts),
`patient.synced_created|synced_updated|linked_to_source|source_inactivated|source_merged|source_gone`
(patient ID, connection ID, run ID, changed field names). Sync writes use `actorUserId` = the
administrator who pressed "Sync now" or null for scheduled runs, with metadata
`actor: "integration"`, `connectionId`, `runId`; user agent `denialdesk-sync`.

## Legal rules used
None. No legal clock. U.S. residency (§ 408.051(3)) is enforced by attestation and environment rules,
not a computed value.

## Out of scope
Writing anything back to the EHR; clinical resources; HL7 v2 ADT, CSV, or other connectors; other
tables (owner to evaluate); fuzzy/probabilistic patient matching and merge tooling; secondary
coverage and dependents (patients P2); SMART user launch; per-connection signing keys; real vendor
endpoints in pre-production.

## Open questions (docs/owner/OWNER_ACTION_ITEMS.xlsx)
- **OA-045** U.S. residency: is the administrator's attestation enough, or must DenialDesk obtain
  written confirmation from the EHR vendor? Does the customer BAA need to cover DenialDesk pulling
  from the practice's EHR (counsel)?
- **OA-046** Retire manual registration once the first practice is connected? What happens to
  legacy manual patients that never match a synced record (read-only today)?
- **OA-047** Confirm phone and email are not synced (billing minimum); the `phone` column stays
  null for synced patients.
- **OA-048** Disconnecting or switching EHRs: do synced patients stay read-only, convert back to
  manual, or link to the new connection?
- **OA-049** Allow-list vendor sandboxes (Epic on FHIR, Oracle Health, athenahealth) in
  pre-production; their test identifiers lack `SYN`: prefix on ingest in non-production?
- **OA-050** Build Bulk Data (PI4) before the first real practice, since US Core does not require
  the population search PI2 uses?
- **OA-051** Population scope: the EHR's client registration must be limited to the practice's own
  patients (minimum necessary). Who confirms this at onboarding?
- **OA-052** Patients labelled `R`/`V` in the EHR: until sensitivity enforcement (patients P4),
  import and show "Restricted in source", or hold them back?
- **OA-053** MRN conflicts: fixed in the EHR only, or an admin tool in DenialDesk?
- **OA-054** Assign a requirement ID for EHR/PM interoperability (§8.8).
- **OA-055** Dependents (subscriber ≠ patient) get no coverage until patients P2 — acceptable?
- **OA-056** Is a 15-minute scheduled sync right?

## Implementation plan

All parts are built by **builder** unless noted. No legal deadlines, rates, or thresholds →
`florida-rules-engine` not involved. No X12 → `edi-x12-specialist` only **reviews** the mapping table
for 837P alignment (DMG03 sex, subscriber N3/N4 address, NM109 member ID) before PI2 merges.
Keep PRs under ~400 lines: PI1 splits into PI1a (migration, trigger, domain refusals, tests) and
PI1b (Settings › Integrations pages, drop-down).

### Files
- `drizzle/00NN_patient_source_provenance.sql`, `drizzle/00NN_integration_connections.sql` (+
  `netlify/database/migrations/` mirror, `src/db/schema.ts`).
- `src/domain/integrations/connections.ts` (validation, status transitions, audit),
  `payer-mappings.ts`, `sync-runs.ts`, `sync.ts` (orchestrator: run lease, pages, watermark).
- `src/integrations/fhir/`: `transport.ts` (interface, `HttpsTransport` with the address guard),
  `discovery.ts`, `auth.ts` (client assertion, token), `search.ts` (paging, limits, retries),
  `map-patient.ts`, `map-coverage.ts` (pure, zod-validated input; unit-tested per rule), `types.ts`
  (minimal hand-written R4 types; no `@types/fhir`).
- `src/integrations/fhir/sandbox/` (resources generator, token verifier, `SandboxTransport`;
  imported only behind `!isProduction()`; a unit test asserts production refuses the sandbox).
- `src/platform/netlify/jobs.ts` (background-function invoke, scheduled function) and
  `src/platform/azure/README.md` note (worker + Key Vault signer at cutover).
- `src/lib/crypto/jwt-sign.ts` (ES384/RS384 via node:crypto, `ieee-p1363` for ES).
- `src/app/.well-known/jwks.json/route.ts`; `src/app/(app)/settings/integrations/**`;
  `src/components/shell/DataSourceMenu.tsx`; `navigation.ts` (`dataSource` on `NavItem`);
  `AppShell.tsx` loads the data-source summary; patients pages (read-only notice, hidden actions).
- `src/auth/permissions.ts` (`canManageIntegrations`); `src/lib/audit.ts` (actions);
  `src/i18n/messages/{en,es,pt}/integrations.ts` + shell/patients keys.

### Tests
- Unit: mapper rules (each skip code, gender map, address rules, primary coverage selection, SYN
  guard), JWT claims and signature round trip, address guard (IPv4/IPv6 private, mapped, CGNAT,
  loopback, link-local, DNS answer with one private IP), URL validation, `next` link origin check,
  Retry-After cap, page/size limits, watermark overlap arithmetic.
- Integration (`pnpm test:integration`): RLS isolation for all four tables; trigger refusals
  (manual edit of synced column, forged insert, `fhir → manual`, wrong connection setting); upsert
  idempotency and no-regression; MRN+DOB link vs. `mrn_conflict`; run lease uniqueness and
  abandonment; payer mapping update; sync-run freeze trigger; audit rows contain no MRN, name,
  external id, or URL (string search over `audit_events`).
- E2E (Playwright, sandbox): admin creates sandbox connection, tests, activates, syncs; list shows
  synced patients; chart read-only; specialist sees status only; drop-down at 1024px.
- Log test: a full sandbox sync emits no resource content, token, or query string (capture logger).

### Risks
- Vendor variance (search support, token lifetimes, paging) — CapabilityStatement checks and
  ⚠️ VERIFY per vendor; Bulk Data in PI4.
- Netlify function time limits (⚠️ VERIFY: ~15 min background, ~30 s scheduled): per-page commits
  and idempotent upserts make an interrupted run safe to repeat from the old watermark.
- Initial load writes one audit event per patient (volume accepted; batched inserts).
- The trigger's session setting can be set by any code running as the app role: it stops mistakes,
  not a compromised app (separate DB roles remain an open project decision).
- One environment signing key for all practices: a key compromise affects every connection until
  rotated (JWKS carries current + next; rotation runbook before production).
