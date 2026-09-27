# Threat model: patient integrations (FHIR R4 sync into the Patient Register)

Scope: `integration_connections`, `integration_payer_mappings`, `integration_sync_runs`,
`integration_sync_issues`, provenance columns and trigger on `patients`; `src/integrations/fhir/`
(transport, discovery, SMART Backend Services auth, search, mappers, synthetic sandbox);
`src/domain/integrations/`; the JWKS route; Settings › Integrations; the tab-bar data-source
drop-down; platform job adapters. Spec: `docs/specs/patient-integrations.md`. Design: ADR 0010.
Data: synced patient columns are **Restricted PHI**; FHIR logical ids and payor keys in patient rows
are treated as identifiers (Restricted PHI); connections and mappings are Confidential
configuration; runs and issues are Internal (counts, codes, DenialDesk IDs).

## Data flow
Admin saves connection (server action, origin-checked; URL validated; residency attested) → test:
discovery (`.well-known/smart-configuration`, `metadata`) → signed client assertion → token →
activate. Run (manual or scheduled, via platform job adapter, IDs only) → lease row → token →
`Patient?_lastUpdated=ge…` pages over TLS → zod-validated resources → mapper keeps billing minimum
→ `withTenant(connection.tenant_id)` + `app.sync_connection_id` → upsert/link (member ID encrypted)
→ per-patient audit (IDs) → page commit → run counts → watermark on success. Nothing but counts and
codes leaves the run; resources and tokens live only in memory.

## STRIDE

| # | Threat | Control | Residual risk / owner |
|---|---|---|---|
| S1 | Spoofing: non-admin creates, tests, activates, pauses, syncs, or maps payers | `canManageIntegrations` (admin) re-checked in every server action and page; other roles see status only | Low |
| S2 | Spoofing: attacker obtains DenialDesk's signing key and calls the EHR as a practice | Key never in the DB or repo; pre-prod key in a hosting secret, production key non-exportable in Key Vault (sign operation only); `kid` rotation with current + next in JWKS; assertions live ≤ 5 min with unique `jti` | **One key per environment**: compromise affects every connection until rotated. Rotation runbook + Key Vault before real data |
| S3 | Spoofing: malicious or look-alike FHIR server (typo, DNS hijack) | `https` only, TLS ≥ 1.2 with certificate validation, no redirects; token endpoint pinned at test time and a change moves the connection to `error`; admin sees host names before activating | A compromised real EHR endpoint is out of our control |
| S4 | Spoofing: forged cross-site post to "Sync now" or activate | Server actions only (Next.js origin check); no GET mutations | Low |
| T1 | Tampering: cross-tenant write through a colliding external id or MRN | Every write inside `withTenant(connection.tenant_id)` under FORCE RLS; unique key includes `tenant_id` and `source_connection_id`; composite FK `(tenant_id, source_connection_id)`; linking searches the connection's own tenant only | Low |
| T2 | Tampering: staff or buggy code edits synced demographics, or a manual row is forged as synced | Domain refusal + trigger requiring `app.sync_connection_id` = row's connection; `fhir → manual` refused; tested | The setting is settable by any app-role code: stops mistakes, not a compromised app (separate DB roles: open decision) |
| T3 | Tampering: sync overwrites practice-owned data (sync loop) | Sync writes only the mapped column list; tags and custom field values are never in its UPDATE; synced columns are not editable in DenialDesk, so there is nothing to overwrite | Low |
| T4 | Tampering: replayed or out-of-order responses regress a record | No-regression on `meta.lastUpdated`; same `versionId` = unchanged; TLS; each token request has a new `jti` | Low |
| T5 | Tampering: wrong-patient link (MRN reused, DenialDesk-generated MRN coincides with an EHR MRN) | Link only on MRN **and** birth date equal; mismatch → `mrn_conflict` for the admin, nothing merged; no fuzzy/name matching; link audited and visible on the chart | Two patients sharing MRN and DOB in one practice: very low; conflicts need a resolution path (OA-053) |
| T6 | Tampering: payor guessed onto the wrong payer → wrong deadlines or 837P | Payor mapped only by explicit admin mapping per `Organization/<id>`; unmapped → no payer, no deadline (payer catalog rule); ambiguous or dependent coverage → `needs_review` | Low |
| R1 | Repudiation: who connected, attested residency, synced, or linked | `integration.*` events with admin ID and attestation flag; per-patient `patient.synced_*`/`linked_to_source` with run and connection IDs; runs record `triggered_by` | Low |
| I1 | Disclosure: PHI, tokens, or query strings in logs, errors, audit, run rows | Transport and client log only host-free event names, status codes, counts; errors carry codes, never bodies or URLs; audit metadata IDs/counts/codes; `issue_codes` from a fixed vocabulary + `OperationOutcome.issue.code` (enum) only; `diagnostics` text never stored; log-capture test over a full sandbox sync; DB errors sanitized (ADR 0006) | Low |
| I2 | Disclosure: over-collection beyond the billing minimum | Mapper whitelists columns (telecom, race, ethnicity, contacts, clinical data dropped in memory); `_elements` requested when supported; scopes limited to Patient, Coverage, Organization read/search | The EHR may authorize the client for more patients than the practice's own (OA-051) |
| I3 | Disclosure: sensitive patients (EHR `R`/`V` labels) shown unmasked | `source_confidentiality` stored and shown as "Restricted in source" | **Blocking before real data** with patients P4 masking (R-3.5.1, R-4.5.1; OA-052) |
| I4 | Disclosure: PHI stored or processed outside the U.S. (§ 408.051(3)) via a non-U.S. EHR endpoint | Admin attestation (audited) on every real connection; DenialDesk's own processing stays in U.S. Azure (ADR 0002) | DenialDesk cannot verify the EHR's hosting: **attestation-level** (OA-045) |
| I5 | Disclosure: identifiers in URLs | No MRN, external id, or name in any DenialDesk URL; connection pages use connection UUIDs; outbound search URLs carry only `_lastUpdated`, `_count`, and FHIR logical ids to the EHR itself | Low |
| I6 | Disclosure: SSRF — base URL, token endpoint, or `next` link aimed at internal services (cloud metadata, DB, localhost) | `https` hostname only (no IP literals, userinfo, query); `lookup` hook rejects loopback, private, link-local (169.254/16, fe80::/10), CGNAT, unique-local, multicast, IPv4-mapped for **every** resolved address at connect time (defeats DNS rebinding); no redirects; `next` must be same origin as the base URL | Low |
| I7 | Disclosure: sandbox or vendor-sandbox data mistaken for real, or real data in pre-production | Pre-prod accepts only the in-process sandbox (`.invalid` host) or allow-listed sandbox hosts; production refuses the sandbox; synthetic-only environments skip non-`SYN` MRNs/member IDs and fail the run after the first; sandbox resources carry a synthetic `meta.tag`; preview banner (ADR 0003) | Vendor sandbox identifiers lack `SYN` (OA-049) |
| I8 | Disclosure: private key or token exposed through JWKS route or client bundle | JWKS route serializes public JWK fields only (unit test asserts no `d`/`p`/`q`); signing code is server-only | Low |
| D1 | DoS: huge or endless bundles, slow responses, decompression bombs | 10 MB response cap (counted after decompression), 500 pages per run, 20 s timeout, `_count=100`, streaming JSON size check before parse | Low |
| D2 | DoS: retries hammer the EHR or our functions; overlapping runs | 3 retries, exponential backoff, `Retry-After` capped at 60 s; one run per connection (lease index); "Sync now" once a minute; 3 failed runs → `error` | Low |
| D3 | DoS: EHR outage stops billing | Local copy (ADR 0010); claims/denials read DenialDesk rows only | Stale data during outages: accepted by the owner (read-only copy) |
| D4 | DoS: platform time limits kill a run midway | Per-page commits; idempotent upserts; watermark unchanged until success; stale lease → `abandoned` | Re-fetches on retry (cost only) |
| E1 | Elevation: malicious FHIR content (script in names, oversized strings, invalid dates) reaches the UI or DB | zod validation and existing `patients` CHECKs; React escaping; strings length-capped; invalid resources skipped with a code | Low |
| E2 | Elevation: a user edits the connection to point an active sync at another server | Base URL, client id, MRN system editable only in `draft` or after pausing; any change drops the connection back to `draft` and requires a new test; audited | Low |
| E3 | Deletion to hide history (R-9.2.1) | Source deletes/merges set `source_status`; no DELETE grants on the new tables; runs frozen once finished | Owner DB role (open decision) |

## Blocking before real data
- Key Vault signing key, rotation runbook, and JWKS rotation test (S2).
- Sensitivity masking for `R`/`V` source labels with patients P4 (I3).
- Owner answers on residency attestation (I4) and population scope (I2).
- Bulk Data path or confirmed `_lastUpdated` support at the practice's vendor (spec PI4).
