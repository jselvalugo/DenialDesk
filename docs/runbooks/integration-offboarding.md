# Runbook: offboarding an EHR/PM connection

When a practice stops using an EHR/PM connection (switching EHR, ending the integration, or a
suspected compromise), it is **revoked**. Revoking is permanent: the connection can't be reactivated,
and connecting again means creating a new connection. Spec: `docs/specs/patient-integrations.md`
("Connection lifecycle", PI1b-2); ADR 0010; threat model `docs/threat-models/patient-integrations.md`.

## Who
A practice administrator (`canManageIntegrations`) revokes in the app. The EHR/PM side is done by the
practice's EHR/PM administrator; DenialDesk staff never act on a practice's EHR/PM.

## In DenialDesk
1. Settings › Integrations › open the connection › **Revoke connection**; tick the confirmation and
   revoke. The page then shows the revoked time and the offboarding steps below.
2. What the app does on revoke (same transaction):
   - status → `revoked` with who and when (`revoked_by`, `revoked_at`), terminal (database trigger);
   - any queued or running sync run → `abandoned` (database trigger);
   - its entry in the cross-practice endpoint registry is released, so the practice (or, after
     verification, another one) can register that endpoint and client ID again;
   - audit event `integration.connection_revoked` with the previous status, the endpoint, client ID,
     MRN identifier system, and whether a registry entry was released (configuration only, no PHI).
3. From PI2a: the connection's signing key is destroyed as part of revoke. Until then no key exists.

## At the EHR/PM (the practice's EHR/PM administrator)
1. Remove or disable the DenialDesk client registration (the client ID shown on the connection page).
2. Remove any DenialDesk public key (JWKS URL) registered with the EHR/PM.
3. Record who at the practice confirmed the registration was removed, and when (keep it with the
   practice's own records; DenialDesk doesn't store it yet).

## What happens to synced patients
Patients already synced stay in DenialDesk as read-only records (`source = 'fhir'`): claims and
denials keep working, and demographics are corrected in the EHR/PM. Whether they later revert to
manual records or re-link to a new connection is an open owner decision (OA-048); until it is made,
nothing changes them automatically.

## Suspected compromise
Revoke first, then follow the integration key compromise runbook (added with PI2a): revoke at every
EHR that trusted the key, customer notice within 72 hours (R-3.4.2), and the FIPA 30-day clock
(R-3.4.1).
