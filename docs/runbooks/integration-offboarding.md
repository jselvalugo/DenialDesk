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
   without deleting anything, and **Resume** undoes it. Stopping a run that is already in progress
   is part of the sync engine (PI2b); until then a run that started before the Pause finishes.
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
3. From PI2a: the connection's signing key is destroyed as part of revoke. Until then no key exists.

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
them automatically; escalate any amendment request for such a patient to the owner.

## Suspected compromise
1. Revoke first (above).
2. Open an incident under the incident response plan (R-3.4.1, R-3.4.2); the notification duties and
   their clocks are the ones those requirements and counsel set, not restated here.
3. Preserve evidence: nothing is deleted (connections, sync runs, and audit events are never
   deleted); export the `integration.*` audit events and the connection's sync runs for the window.
4. If the practice administrator's own account is suspected, suspend it; from PI1c the platform
   operator can revoke the connection instead.
5. Follow the integration key compromise runbook once it exists (PI2a): revoke at every EHR that
   trusted the key.
