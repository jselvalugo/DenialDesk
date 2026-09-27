# ADR 0010: Patient data is a read-only copy synced from the practice's EHR/PM over FHIR R4

Status: Proposed (2026-09-27, architect; design approved by owner in chat 2026-09-27, spec
`docs/specs/patient-integrations.md`; threat model `docs/threat-models/patient-integrations.md`)

## Context
The owner wants the Patient Register to "sync data, not hold any of the data", connected per table
from a drop-down beside the Patients tab, following medical integration practice. Asked to clarify,
the owner chose a **synced read-only copy**: the EHR/PM is the system of record; DenialDesk keeps an
encrypted copy of the billing minimum and keeps billing when the EHR is down. First connector:
HL7 FHIR R4 / US Core only; Patients table only.

Constraints: PHI minimum necessary (R-5.1.2), tenant isolation (R-7.2.4), audit (R-7.5.1), U.S.
residency (§ 408.051(3)), no real PHI outside production (ADR 0003, R-15.1), claims reference
patients and are retained 10 years (R-9.2.1), 837P needs demographics and member ID at submission.

## Options considered
1. **Link-only, live fetch** (store only a FHIR reference; fetch demographics on every view/claim).
   Rejected: billing, deadlines, 837P, and reports stop when the EHR or the token is down (R-7.9.2);
   every page view becomes an outbound PHI call; lists and search would need the EHR's search API.
2. **Hybrid** (cache some fields, fetch the rest live). Rejected: two sources of truth, same outage
   exposure for the fetched part, more code paths.
3. **HL7 v2 ADT feed.** Rejected by the owner for now: needs an interface engine/VPN, push delivery
   into DenialDesk, and message parsing; FHIR is the ONC-certified API every certified EHR offers.
4. **Keep manual entry** (optionally as a "connector"). Rejected by the owner: contradicts "not hold".
5. **Synced read-only copy over FHIR R4 (chosen).**

## Decision
- `patients` gains provenance (`source`, connection, FHIR logical id, version, last updated, synced
  at, source status). Synced demographic columns change only through the sync: a domain refusal
  plus a DB trigger that requires a transaction-local `app.sync_connection_id` matching the row.
  Practice-owned data (sensitivity tags, custom field values) stays editable. Rows are never deleted.
- Only the billing minimum is mapped (MRN, name, birth date, administrative sex, address, primary
  coverage member ID and payor). The member ID stays field-encrypted (R-7.3.3). Payors map to the
  practice's payers only by an explicit administrator mapping; never guessed.
- Matching is deterministic: FHIR logical id, then MRN **and** birth date equal to an existing manual
  patient (linked, audited); anything else is a new row or a reported conflict. No fuzzy matching.
- Connections are tenant-scoped rows (`integration_connections`, one non-draft connection per target
  table) holding no secrets. Authentication is SMART App Launch v2 Backend Services
  (`client_credentials` + `private_key_jwt`, ES384 default); DenialDesk publishes a JWKS. The private
  key is one per environment: a hosting secret in pre-production, a non-exportable Azure Key Vault
  key used through its sign operation in production (U.S. region, ADR 0002).
- Transport is `node:https` with a DNS-answer address guard (SSRF), TLS ≥ 1.2, no redirects, size,
  page, time, and retry limits. JWT signing uses `node:crypto`. **No new runtime dependency** in
  pre-production; the Azure Key Vault SDK (`@azure/keyvault-keys`, `@azure/identity`) is added at
  cutover under R-15.7 review.
- Sync is a platform-neutral job (`src/domain/integrations/sync.ts`) run by a thin adapter:
  Netlify background/scheduled functions now, an Azure worker later (ADR 0003). One run per
  connection at a time (lease row), page-by-page commits, idempotent upserts, watermark advanced
  only on success with a 5-minute overlap.
- Pre-production connects only to a built-in, in-process **synthetic FHIR sandbox** (base URL on the
  reserved `.invalid` TLD) or owner-allow-listed vendor sandboxes; production refuses the sandbox.
- The data-source drop-down is an optional `dataSource` slot on a navigation item, so other tables
  can opt in later without a shell redesign.
- Paged `_lastUpdated` search is used first; because US Core does not require population search,
  FHIR Bulk Data `Group/$export` is planned before the first real practice (spec PI4).

## Consequences
- DenialDesk still stores PHI (a copy), so every existing control applies; "not hold" is met as
  "not the system of record, minimum copy". Stated plainly to the owner.
- Errors in the EHR are fixed in the EHR; DenialDesk shows them until the next sync.
- New outbound integration surface (SSRF, credential, residency risks) — see the threat model.
- Vendor behavior varies; each vendor's search, paging, and token rules are ⚠️ VERIFY at onboarding.
- Manual registration continues only for practices without a connection (owner question on retiring it).
- Initial loads produce one audit event per patient.
