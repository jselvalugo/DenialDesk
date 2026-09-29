# Runbook: offboarding an EHR/PM connection

When a practice stops using an EHR/PM connection (switching EHR, ending the integration, or a
suspected compromise), it is **revoked**. Revoking is permanent: the connection can't be reactivated,
and connecting again means creating a new connection. Spec: `docs/specs/patient-integrations.md`
("Connection lifecycle", PI1b-2); ADR 0010; threat model `docs/threat-models/patient-integrations.md`.

## Who
A practice administrator (`canManageIntegrations`) revokes in the app. The EHR/PM side is done by the
practice's EHR/PM administrator; DenialDesk staff never act on a practice's EHR/PM.

## In DenialDesk
0. Not ready to give the connection up? **Pause** (active connections) stops new sync runs
   without deleting anything, and **Resume** undoes it. A run already in progress is stopped
   too: the database abandons it, and the sync checks the connection is still active before each page,
   so it stops at its next page (patients already saved stay).
   Resume needs a verification within the last 5 minutes: signing in counts, so it only asks for a
   fresh authenticator code once the sign-in is older than that. A connection still **awaiting
   approval** can be **withdrawn** back to a draft (its registry claim and its residency
   attestation are cleared, so it is attested afresh when submitted again). Revoking is the
   permanent step.
1. Settings › Integrations › open the connection › **Revoke connection**; choose the reason (a fixed
   list: no longer used, switching systems, set up by mistake, security concern, other; never patient
   information), tick the confirmation, and revoke. Revoking needs no fresh verification on purpose,
   so it works as an emergency stop. The page then shows the revoked time and the offboarding steps
   below.
2. What the app does on revoke (same transaction):
   - status → `revoked` with who and when (`revoked_by`, `revoked_at`), terminal (database trigger);
   - any queued or running sync run → `abandoned` (database trigger);
   - its entry in the cross-practice endpoint registry is released, so that endpoint and client ID
     can be submitted again (by this practice or another; any new connection still needs its own
     Submit and, for a real endpoint, operator approval, PI1c);
   - audit event `integration.connection_revoked` with the reason code (also its "why" column and the
     connection's `status_reason`), the previous status, the endpoint, client ID, MRN identifier
     system, and whether a registry entry was released (configuration only, no PHI).
3. Signing keys: revoke does **not** destroy a key today. Per-connection keys (Key Vault, destroyed on revoke) are
   not built yet; pre-production connections (synthetic data only) sign with one shared key that revoke leaves in
   place, and that key is rotated under the key runbook, not per connection. A real connection can't sync at all
   until PI4 (the sync refuses it with `population_scope_unenforced`), so no real connection has a key in use. Destroying a
   connection's key joins this step when per-connection keys ship.

## At the EHR/PM (the practice's EHR/PM administrator)
1. Remove or disable the DenialDesk client registration (the client ID shown on the connection page).
2. Remove any DenialDesk public key (JWKS URL) registered with the EHR/PM.
3. Record who at the practice confirmed the registration was removed, and when. DenialDesk doesn't
   store this confirmation yet (planned: an audited "offboarding confirmed by/at" record, spec
   PI1b follow-ups); keep it with the practice's own records meanwhile.

## What happens to synced patients
Patients already synced stay in DenialDesk as read-only records (`source = 'fhir'`) and are **no
longer updated**: claims and denials keep working, but a correction made in the EHR/PM no longer
reaches DenialDesk, and DenialDesk refuses manual edits to a synced patient. Whether they later
revert to manual records or re-link to a new connection — and how an amendment request is honored
for them meanwhile (45 CFR 164.504(e)(2)(ii)(F), the business associate's duty to make PHI available
for amendment) — is an open owner and counsel decision (OA-048). Until it is made, nothing changes
them automatically; escalate any amendment request for such a patient to the DenialDesk owner.

## Suspected compromise
1. Revoke first (above).
2. Open an incident under the incident response plan (R-3.4.1, R-3.4.2); the notification duties and
   their clocks are the ones those requirements and counsel set, not restated here.
3. Preserve evidence: nothing is deleted (connections, sync runs, and audit events are never
   deleted); export the `integration.*` and `operator.integration_approved|rejected|viewed` audit events (the
   approval evidence: who verified it, how, when, and the operator's session) and the connection's sync
   runs for the window.
4. If the practice administrator's own account is suspected, suspend it. Operator approval (PI1c) can
   reject a connection still awaiting approval (back to draft, endpoint claim released); revoking a
   live connection is an administrator action today, so ask the practice's other administrator, or
   the DenialDesk owner (who holds the operator account), to have a practice administrator revoke it; an
   operator-side revoke is not built yet (spec PI1c open item, OA-071).
5. Follow the integration key compromise runbook once it exists (PI2a): revoke at every EHR that
   trusted the key.
