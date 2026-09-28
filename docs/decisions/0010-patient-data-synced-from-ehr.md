# ADR 0010: Patient data is a read-only copy synced from the practice's EHR/PM over FHIR R4

Status: Proposed (2026-09-27, architect; design approved by owner in chat 2026-09-27; revised
2026-09-28 after security/compliance review, coordinator decisions pending owner confirmation
OA-057). Spec `docs/specs/patient-integrations.md`; threat model
`docs/threat-models/patient-integrations.md`.

## Context
The owner wants the Patient Register to "sync data, not hold any of the data", connected per table
from a drop-down beside the Patients tab. Clarified: a **synced read-only copy** — the EHR/PM is the
system of record; DenialDesk keeps an encrypted copy of the billing minimum and keeps billing when
the EHR is down. First connector HL7 FHIR R4 / US Core; Patients table only. Constraints: minimum
necessary (R-5.1.2), tenant isolation (R-7.2.4), audit (R-7.5.1), U.S. residency (§ 408.051(3)),
synthetic data outside production (ADR 0003, R-15.1), claims reference patients (§9.2 retention).

## Options considered
1. **Link-only, live fetch.** Rejected: billing, deadlines, and 837P stop when the EHR is down
   (R-7.9.2); every page view is an outbound PHI call.
2. **Hybrid cache + live fetch.** Rejected: two sources of truth, same outage exposure.
3. **HL7 v2 ADT.** Rejected by the owner for now: interface engine/VPN, push delivery, parsing.
   FHIR + Backend Services is the API of products certified to 45 CFR 170.315(g)(10) (PM-only
   systems often are not; ⚠️ VERIFY per vendor).
4. **Manual entry.** Rejected by the owner: contradicts "not hold".
5. **Synced read-only copy over FHIR R4 (chosen).**

## Decision
- **Provenance and read-only.** `patients` gains source, connection, FHIR id, version, and source
  status. Synced columns change only through a sync run: domain refusal plus a trigger requiring a
  `running` run of the row's connection in the current tenant. Tags and custom fields stay
  practice-owned. Nothing is deleted.
- **Minimum necessary.** Billing fields only; member ID field-encrypted; payors mapped only by an
  explicit admin mapping; SSN/MBI/DL identifier systems refused as MRN; any unrecognized or
  sensitivity security label marks the patient restricted. Production accepts only a
  practice-scoped population (Group export or an operator-verified filter).
- **Deterministic matching**: FHIR id, then MRN **and** birth date; otherwise new row or conflict.
- **Trust in the endpoint (confused deputy).** Every real connection needs **platform-operator
  approval** after out-of-band verification with the practice's EHR administrator, and a global
  **registry** (definer-only) makes (normalized endpoint, client ID) unique across practices. Once a
  connection has synced data its endpoint, token endpoint, issuer, and MRN system are immutable.
- **Keys.** SMART v2 Backend Services (`private_key_jwt`, ES384 or RS384). **One key per
  connection** by default — a non-exportable Azure Key Vault key, published at
  `/.well-known/jwks/<connection-uuid>.json`; a shared key only as a documented per-vendor
  exception. Pre-production: one distinct shared key in a functions-only hosting secret. Production
  refuses env keys. Annual rotation (R-7.3.4).
- **Transport.** `node:https`, explicit TLS ≥ 1.2, no redirects, no env proxies, deny-by-default
  address guard (`node:net` BlockList from the IANA special-purpose registries, embedded IPv4
  decoded) on every resolved address, and request/run budgets. No new runtime dependency before
  cutover; the Key Vault SDK arrives then under R-15.7 review.
- **Jobs.** Platform-neutral sync job run by thin adapters (Netlify now, Azure worker later).
  Payload is a signed `runId`; a definer function claims only `queued` runs and returns the tenant;
  all reads/writes run as `denialdesk_app` in `withTenantAsSystem`, audited as a fixed
  per-environment service principal (never `withTenantAsPlatform` or `systemDb`).
- **Environments.** Built-in in-process synthetic sandbox (`.invalid` host) only when
  `syntheticDataOnly()`; real endpoints only when `!syntheticDataOnly() && !onNetlify()`; vendor
  sandboxes only from reviewed code; raw `SYN` guard before any transform.
- **UI.** An optional `dataSource` slot on a navigation item, so other tables can opt in later.
- **Scale.** Paged `_lastUpdated` search where advertised; Bulk Data before the first real practice.

## Consequences
- DenialDesk still stores PHI (a copy): "not hold" means "not the system of record, minimum copy".
- Onboarding needs the operator and the practice's EHR administrator; changing EHR endpoints means a
  new connection (OA-048).
- New outbound surface (SSRF, credentials, confused deputy, residency) — see the threat model.
- Per-connection Key Vault keys add cost and a key per practice to rotate and destroy on revoke.
- Vendor behavior (search, scopes, key registration, POST search) is ⚠️ VERIFY per vendor.
- One audit event per patient on initial load.
