# Runbook: offboarding a patient-integrations connection

Applies to a `patients` FHIR connection revoked from `/settings/integrations/[id]`
(`docs/specs/patient-integrations.md` "PI1b"). Revoke is immediate and irreversible in
DenialDesk; this runbook covers what to do at the EHR/PM side and afterward.

## What revoking does (and doesn't do)

- Stops any further sync from that connection immediately (the record moves to `revoked`,
  and drizzle/0039/0040's lifecycle trigger refuses any further transition out of it).
- Reopens hand registration of new patients on the Patients tab.
- Does **not** delete previously-synced patient data. Records already synced from this
  connection stay in DenialDesk as read-only, kept under the retention policy (§9.2 —
  see `docs/REQUIREMENTS.md`). They remain visible and usable for claims/denials work;
  they just can't be edited by hand or re-synced from a revoked connection.
- Does **not**, on its own, deregister DenialDesk at the practice's EHR/PM. The client
  registration lives at the EHR/PM vendor, outside DenialDesk's database, so revoking a
  connection record here has no effect there.

## Steps

1. **In DenialDesk**: an admin revokes the connection (`/settings/integrations/[id]`,
   confirm dialog, reason code). This requires a step-up MFA verification within the
   last 5 minutes (R-7.2.2).
2. **At the EHR/PM**: ask the practice's EHR administrator to remove or disable the
   DenialDesk client registration (SMART Backend Services client) so the credentials
   DenialDesk held can't be reused by anyone else. DenialDesk does not hold or manage
   this registration — deregistering it is entirely the EHR/PM administrator's action.
3. **If the reason was "Security concern"**: this is routed to the incident-response
   process (see the relevant runbook/on-call rotation for incident handling — outside
   this document's scope). Additionally:
   - Ask the EHR/PM administrator to check their own access log for DenialDesk client
     activity **after** the revoked-at time shown on the connection record. Any activity
     after that time is unexpected and should be escalated immediately.
   - Consider whether the practice's credentials (client ID, any shared secret) need to
     be rotated at the EHR/PM regardless of what the access log shows.
4. **If the reason was "Switching EHR/PM systems"**: revoking the old connection does not
   create the new one. Create a brand-new connection (`/settings/integrations/new`) for
   the new EHR/PM; a revoked connection's endpoint fields can never be reused or edited
   back into service (drizzle/0039's `integration_connections_lifecycle` trigger refuses
   any transition out of `revoked`).
5. **Synced data**: no action needed. Patients synced before the revoke stay read-only
   in DenialDesk. If a practice later reconnects (a new connection, possibly to the same
   EHR/PM), PI2b's sync engine re-links by MRN/identifier rather than duplicating records
   (see `docs/specs/patient-integrations.md`).

## Who can do this

Only a practice admin (`canManageIntegrations`) can revoke a connection, and only an
admin sees the offboarding panel on the connection record page — a non-admin sees only
the connection's name and status (security review PR #81, item 9).

## Related

- `docs/specs/patient-integrations.md` — PI1b spec section, connection lifecycle.
- `docs/threat-models/patient-integrations.md` — threat model for this feature.
- `docs/REQUIREMENTS.md` §9.2 — retention policy for synced records.
