# Threat model: patient integrations (FHIR R4 sync into the Patient Register)

Scope: provenance columns and trigger on `patients`; `integration_connections`,
`integration_endpoint_registry`, `integration_payer_mappings`, `integration_sync_runs`,
`integration_sync_issues`; SECURITY DEFINER functions (registry, run claim, due-run enqueue);
`src/integrations/fhir/` (transport, address guard, discovery, SMART Backend Services auth, search,
mappers, sandbox); `src/domain/integrations/`; JWKS routes; Settings › Integrations; operator
approval; the tab-bar drop-down; platform job adapters; Bulk Data (PI4).
Spec: `docs/specs/patient-integrations.md`. Design: ADR 0010. Revised 2026-09-28 after the
security and compliance reviews (decisions pending owner confirmation, OA-057).
Data: synced demographics and member ID — Restricted PHI; source sensitivity labels —
Restricted-Sensitive PHI; FHIR logical ids and payor keys — identifiers (Restricted PHI);
connections, registry, mappings — Confidential configuration; runs and issues — Internal; signing
keys and job secret — Secret.

## Data flow
Admin saves a draft (strict allow-list; URL, host, and identifier-system rules) → per-connection
key created (Key Vault in production) → test (discovery + token, no patient data) → Submit (step-up
MFA, residency attestation, registry claim) → operator verifies out of band and approves → active.
Run: Sync now or scheduler → `queued` run → signed job `{runId}` → `integration_claim_run` →
`withTenantAsSystem(tenant, run)` as `denialdesk_app` → issuer check → token → pages over TLS
through the address guard → synthetic guard (non-production) → zod → mapper (billing minimum) →
upsert/link under the sync trigger → per-patient audit (IDs) → page commit → counts → watermark.
Resources and tokens exist only in memory.

## STRIDE

| # | Threat | Control | Residual risk / owner |
|---|---|---|---|
| S1 | Non-admin configures, submits, syncs, maps payers | `canManageIntegrations` re-checked in every action and page; others see status only | Low |
| S2 | **Confused deputy**: a practice registers another practice's (or organization's) EHR base URL and client ID and DenialDesk pulls that population into the wrong tenant | (a) Every real connection needs **operator approval** after out-of-band verification of base URL, token endpoint, and client ID with the practice's EHR administrator; the app role cannot approve (column grants + trigger). (b) Global **registry** unique on (normalized endpoint, client ID) across practices, definer-only. (c) **Per-connection keys** with a per-connection JWKS URL, so a client registered at the EHR trusts only that connection's key | Shared key only as a documented per-vendor exception (weakens c; a and b still hold). Operator verification is a manual, single-person control. A refused Submit ("This endpoint and client ID are already connected") reveals that some practice holds the pair, with no identity: bounded by the Test connection and Submit (`integration_submit`) rate limits and audited (`integration.registry_conflict`); accept or reject in OA-065 (c); an operator-side alert that records the holder outside the tenant's log is an open PI1c item (needs an operator-only record written from Submit, so a SECURITY DEFINER function or a grant: R-15.9 owner sign-off; spec PI1c). Operator approval itself is built (PI1c): the operator confirms, outside the app, that the practice owns the `client_id`, and the decision is audited `operator.integration_approved|rejected`; it writes as the connection owner via `withTenantAsPlatform`, so the approval columns stay ungranted to the app role |
| S3 | Signing key stolen; attacker calls EHRs as DenialDesk | Production keys non-exportable in Key Vault (sign only), one per connection; production refuses an env key; pre-production key distinct, functions-only secret, synthetic sandboxes only; `iat`/`exp` ≤ 5 min, unique `jti`, alg allow-list; annual rotation (R-7.3.4); compromise runbook: revoke at each EHR, notify customers within 72 h (R-3.4.2), FIPA 30-day clock (R-3.4.1) | Blast radius of a shared-key exception is every connection using it. **Pre-production shared key (coordinator decision pending owner confirmation, OA-065; M2):** one `INTEGRATION_SIGNING_KEY` signs every pre-production connection, so a leak of it (a Netlify functions secret) lets its holder authenticate as DenialDesk at every EHR that registered its public key, and the key alone doesn't tie a client ID to a practice. Accepted pre-production exception, production control deferred (R-7.3.4/R-7.3.5): register it only with vendor sandbox tenants holding synthetic data, never a live practice EHR (Test connection refuses any host outside the reviewed `vendor-sandboxes.ts` where only synthetic data is allowed); production refuses the variable at use and at boot; the operator verifies `client_id` ownership outside the app at approval (PI1c); rotating the secret and re-registering it is the recovery |
| S4 | Malicious or look-alike FHIR server (typo, DNS hijack, endpoint swap) | TLS ≥ 1.2 with validation, explicit TLS options, no redirects; token endpoint pinned; issuer recorded and checked before any upsert; base URL, token endpoint, issuer, MRN system immutable once data is synced; operator verification | A compromised real EHR is outside our control |
| S5 | Forged or replayed job invocation; forged `runId` | HMAC-signed payload with timestamp window; payload is `runId` only; claim function accepts only a `queued` run and returns its tenant; tests for unsigned, stale, forged, and already-claimed calls | Low |
| S6 | Cross-site post to Sync now / Submit / Revoke | Server actions only (origin check); no GET mutations; step-up MFA on Submit, resume, attestation, payer mapping | Low |
| T1 | Cross-tenant write via external id or MRN collision | Writes only in `withTenantAsSystem` as `denialdesk_app` under FORCE RLS; `tenant_id` on every table, tenant in every unique key, composite `(tenant_id, x)` FKs everywhere; linking searches the run's tenant only | Low |
| T2 | Staff or buggy code edits synced demographics, or forges a synced row | Domain refusal + trigger requiring `app.sync_run_id` to be a `running` run of the row's connection in the current tenant; `fhir → manual` refused | App-role code could still open a run and set the settings (separate DB roles: open decision) |
| T3 | Sync overwrites practice-owned data; sync alters claims | Sync writes only mapped columns; never tags, custom fields, claims, or claim versions; 837P snapshots patient data into the claim version (R-3.10.3) | Low |
| T4 | Replayed or out-of-order responses; skewed server clocks | No regression on `meta.lastUpdated`; same `versionId` = unchanged; server timestamps clamped to our clock + 5 min; watermark never ahead of our clock | Low |
| T5 | Wrong-patient link | Link only on MRN **and** birth date; mismatch → `mrn_conflict`, nothing merged; no fuzzy matching; audited | Resolution path open (OA-053) |
| T6 | Payor guessed → wrong deadlines or 837P | Organization payor only; explicit admin mapping (step-up); otherwise no payer and no deadline | Low |
| T7 | Tampered sync-run history | Rows frozen once finished; issues append-only; no DELETE grants | Owner DB role (open decision) |
| R1 | Who connected, attested, approved, synced, linked, revoked | `integration.*` with old/new base URL, token endpoint host + path, client ID; `operator.integration_approved|rejected` with verification method; sync audits by a fixed service-principal UUID with `triggeredBy`, reason `ehr_sync`, runtime "where"; per-patient events; run-level `sync_completed` records receipt of unchanged/skipped resources | Low |
| I1 | PHI, tokens, URLs in logs, errors, audit, run rows | Codes only; URL paths redacted from errors; ZodErrors mapped to codes, never logged; `diagnostics` never stored; IssueType codes validated; log-capture test; DB errors sanitized (ADR 0006) | Low |
| I2 | Over-collection: fields beyond the billing minimum | Mapper allow-list; `_elements` when supported; scopes Patient/Coverage/Organization read-search only; granted-scope check | Low |
| I3 | Over-collection: patients outside the practice (minimum necessary, R-5.1.2) | Production accepts only a practice-scoped population, recorded at approval. **Only a Group export is approvable today**: Approve refuses an operator-verified filter until the filter itself can be recorded (structured value, no grant to the app role) and the sync applies exactly that recorded filter (spec PI1c, security review M2) | **Blocking before real data** (OA-050, OA-051) |
| I4 | Sensitive patients shown unmasked (HIV, SUD/Part 2, behavioral, minors) | `R`/`V`, ActCode sensitivity codes, and any unrecognized label mark the patient restricted; minors suggested for the tag | **Blocking before real data** with patients P4 masking (R-3.5.1, R-4.5.1; OA-052) |
| I5 | Identifier misuse: SSN, MBI, DL as MRN | Identifier systems for SSN/MBI/Medicare/DL/passport refused; SSN- and MBI-shaped values skipped (9 digits allowed only if operator-verified) | Lists ⚠️ VERIFY |
| I6 | PHI processed outside the U.S. (§ 408.051(3)) | Audited admin attestation (U.S. only; stricter than the statute's continental U.S., territories, Canada); DenialDesk runs in U.S. Azure (ADR 0002) | Attestation-level; vendor screening R-3.3.6 and offshore access R-3.3.3 (OA-045) |
| I7 | Identifiers in URLs | None in DenialDesk URLs; POST `_search` for Coverage where supported, else GET to the practice's own EHR (documented) | ⚠️ VERIFY POST support per vendor |
| I8 | **SSRF** via base URL, token endpoint, `next`, Bulk status/output URLs | Deny by default: `BlockList` from IANA special-purpose registries (IPv4 + IPv6) and `168.63.129.16` (Azure WireServer); IPv6 must be inside `2000::/3` and outside the special-purpose ranges within it (mapped, compatible, translated, NAT64, 6to4 and Teredo are all refused outright; embedded IPv4 is still decoded as defense in depth); checked on every resolved address at connect (no rebinding) **and on IP-literal hosts before connecting** (Node never calls `lookup` for those); WHATWG host normalization (`2130706433`, `0x7f.1`); URLs with credentials refused; `localhost`, `.local`, `.internal`, `.home.arpa`, single-label, trailing dot refused; ports from config; env proxies ignored; no redirects; same-origin `next` (enforced in the sync loop, PI2b) | Egress NSG allow-listing at the Azure cutover; `NODE_EXTRA_CA_CERTS` must be unset in production (it adds process-wide trust anchors) — verify at the Azure cutover |
| I9 | Sandbox data taken as real, or real data in pre-production | Sandbox only when `syntheticDataOnly()`; real endpoints only when `!syntheticDataOnly() && !onNetlify()`; vendor sandboxes only from reviewed code; `_count=1` first page; raw `SYN` guard before any transform, failure rolls back the page and fails the run; no prefixing | Vendor sandboxes blocked in practice (OA-049) |
| I10 | Private key via JWKS or bundle | JWKS public-field allow-list (test asserts no `d`, `p`, `q`, `dp`, `dq`, `qi`); server-only signing | Low |
| I11 | Bulk Data token leak to storage hosts (PI4) | Bearer token only to the FHIR origin; `requiresAccessToken=true` files must be on it; other output hosts per vendor in reviewed code, guard applied; export deleted after download | Low |
| D1 | Huge or endless responses, slowloris, decompression bombs | 5 s DNS, 30 s total per request, 10 MB after decompression, 1,000 entries per Bundle; run budgets 12 min / 5,000 requests / 500 MB; repeated `next` → `paging_loop` | Low |
| D2 | Retry storms, overlapping runs, test-connection abuse (port scan / oracle) | 3 retries, backoff, `Retry-After` ≤ 60 s; one run per connection; Sync now once a minute; test and JWKS rate-limit buckets; test outcomes collapsed to a few codes | Low |
| D3 | EHR outage stops billing | Local copy (ADR 0010) | Stale data during outages: accepted |
| D4 | Platform time limits kill a run | Page commits, idempotent upserts, watermark only on success, `abandoned` leases | Re-fetch cost only |
| E1 | Malicious content reaches UI or DB | zod `.strict()`, length caps, CHECKs, React escaping; bad records skipped | Low |
| E2 | Client-settable status, tenant, key, or approval fields | Strict allow-list of five fields; lifecycle trigger; approval columns not granted to the app role | Low |
| E3 | Deletion to hide history | `source_status` instead of deletes; `revoked` terminal; no DELETE grants; retention per §9.2 | Owner DB role (open decision) |

## Blocking before real data
- Practice-scoped population (I3): Bulk Data Group export (the only scope Approve accepts today); an operator-verified filter only once it can be recorded and applied.
- Sensitivity masking for restricted-in-source patients (I4), and the Part 2 program question.
- Key Vault per-connection keys, rotation and compromise runbooks, JWKS rotation test (S3).
- Owner/counsel answers: residency and vendor screening (I6), customer BAA covers the EHR pull
  (OA-045), OA-057 decisions including single-person operator approval and any `shared_vendor_exception`.
- Egress NSG and SIEM alerts (R-7.5.3) at the Azure cutover.
- `x-azure-clientip` is trusted off Netlify (`src/lib/request-context.ts`); at the Azure cutover the origin must be reachable only through Front Door (`X-Azure-FDID` check or Private Link), or a client can forge it and dodge the sign-in, MFA, and JWKS rate limits (PR #87 review).
