/** Messages for EHR/PM integrations (docs/specs/patient-integrations.md). Flat keys, dotted for grouping. */
export const integrations = {
  "meta.title": "Integrations",
  "list.panelTitle": "EHR/PM connections",
  "list.panelDescription":
    "Connect your EHR or practice management system so the Patient Register syncs from it. Configuration only: no patient information appears here.",
  "list.newConnection": "New connection",
  "list.emptyTitle": "No EHR/PM connection yet",
  "list.emptyDescriptionAdmin":
    "Create a connection to sync the Patient Register from your EHR/PM. Until then, staff register patients by hand.",
  "list.emptyDescriptionReadOnly":
    "An administrator can connect your EHR/PM. Until then, staff register patients by hand.",
  "list.tableCaption": "EHR/PM connections",
  "list.name": "Name",
  "list.source": "Source",
  "list.lastSync": "Last successful sync",
  "list.created": "Created",
  "list.never": "Never",
  "source.sandbox": "Built-in test sandbox",
  "source.fhir": "EHR/PM (FHIR R4)",
  "target.patients": "Patient Register",
  "status.draft": "Draft",
  "status.pending_approval": "Awaiting approval",
  "status.active": "Active",
  "status.paused": "Paused",
  "status.error": "Needs attention",
  "status.revoked": "Revoked",
  "new.metaTitle": "New connection",
  "new.title": "New EHR/PM connection",
  "new.description":
    "A new connection starts as a draft. Saving it doesn't contact the EHR/PM or sync any patient.",
  "new.sandboxNotice":
    "This environment uses synthetic data only, so it connects to the built-in test sandbox, never to a real EHR/PM.",
  "new.create": "Create connection",
  "new.creating": "Creating…",
  "form.displayName": "Connection name",
  "form.displayNameHint": "Shown beside the Patients tab. Don't include patient information.",
  "form.baseUrl": "FHIR base URL",
  "form.baseUrlHint": "From your EHR/PM's FHIR documentation, for example https://fhir.example.com/r4.",
  "form.clientId": "Client ID",
  "form.clientIdHint": "The ID your EHR/PM administrator registered for DenialDesk.",
  "form.mrnSystem": "MRN identifier system",
  "form.mrnSystemHint":
    "The identifier system your EHR/PM uses for medical record numbers, as a URL or urn:oid. Never a Social Security, Medicare, driver's license, or passport system.",
  "form.endpointLockedHint":
    "The URL, client ID, and identifier system are fixed once a connection is submitted or has synced. To use another endpoint, revoke this connection and create a new one.",
  "form.save": "Save changes",
  "form.saving": "Saving…",
  "detail.metaTitle": "Connection",
  "detail.configurationTitle": "Configuration",
  "detail.configurationDescription": "What DenialDesk uses to reach your EHR/PM.",
  "detail.status": "Status",
  "detail.source": "Source",
  "detail.target": "Syncs to",
  "detail.tokenEndpoint": "Token endpoint",
  "detail.issuer": "Issuer",
  "detail.notDiscovered": "Found when the connection is tested",
  "detail.created": "Created",
  "detail.submitted": "Submitted",
  "detail.approved": "Approved",
  "detail.revokedAt": "Revoked",
  "detail.lastSync": "Last successful sync",
  "detail.editTitle": "Edit connection",
  "detail.editDescription": "Changes are recorded in the audit log.",
  "revoke.title": "Revoke connection",
  "revoke.description":
    "Revoking is permanent: DenialDesk stops using this connection, and it can't be reactivated. To connect again, create a new connection.",
  "revoke.reason": "Reason",
  "revoke.reasonHint": "Recorded in the audit log. Don't include patient information anywhere.",
  "revoke.reasonPlaceholder": "Choose a reason",
  "revoke.reason.no_longer_used": "We no longer use this connection",
  "revoke.reason.switching_systems": "We're switching EHR/PM systems",
  "revoke.reason.configured_in_error": "It was set up by mistake",
  "revoke.reason.security_concern": "Security concern",
  "revoke.reason.other": "Other",
  "revoke.confirm": "I understand that revoking this connection is permanent.",
  "revoke.submit": "Revoke connection",
  "revoke.pending": "Revoking…",
  "lifecycle.title": "Sync",
  "lifecycle.active":
    "Pausing stops DenialDesk from syncing patients from this connection. Nothing is deleted, and you can resume later.",
  "lifecycle.paused":
    "Sync is paused. Resuming restarts it, and needs you to verify your identity with your authenticator app first.",
  "lifecycle.error":
    "DenialDesk stopped syncing after an error. Once it's fixed with your EHR/PM administrator, resume. Resuming needs you to verify your identity with your authenticator app first, and a passing Test connection.",
  "lifecycle.pending_approval":
    "This connection is waiting for approval. Withdrawing it returns it to a draft you can edit and submit again.",
  "pause.submit": "Pause sync",
  "pause.pending": "Pausing…",
  "resume.submit": "Resume sync",
  "resume.pending": "Resuming…",
  "withdraw.submit": "Withdraw submission",
  "withdraw.pending": "Withdrawing…",
  "stepUp.link": "Verify your identity",
  "offboarding.title": "Offboarding steps",
  "offboarding.description": "Finish these with your EHR/PM administrator after revoking:",
  "offboarding.step1":
    "Remove or disable the DenialDesk client registration (client ID {clientId}) in the EHR/PM.",
  "offboarding.step2": "Remove any DenialDesk public key registered with the EHR/PM.",
  "offboarding.step3":
    "Patients already synced stay in DenialDesk as read-only records and are no longer updated: corrections made in the EHR/PM won't reach DenialDesk.",
  "offboarding.step4": "Note who at the practice confirmed the registration was removed, and when.",
  "offboarding.revokedNotice": "Revoked {date}. Finish the offboarding steps below if you haven't yet.",
  "error.saveFailed": "The connection couldn't be saved. Reload the page and try again.",
  "error.confirmRevoke": "Check the box to confirm you understand that revoking is permanent.",
  "error.revokeReasonRequired": "Choose why you're revoking this connection.",
  "error.stepUpRequired": "This needs a recent two-step verification. Verify your identity, then try again.",
  "error.invalidTransition": "This connection isn't in a state where that is possible. Reload the page.",
  "error.notAdmin": "Only an administrator can manage integrations.",
  "error.notFound": "Integration not found.",
  "error.stale": "This connection changed since you opened it. Reload the page and try again.",
  "error.revoked": "This connection is revoked and can no longer change.",
  "error.unexpectedField": "The form sent a field it shouldn't. Reload the page and try again.",
  "error.displayNameRequired": "Enter a name for this connection.",
  "error.displayNameTooLong": "Keep the name to 80 characters or fewer.",
  "error.displayNameInvalid": "The name can't contain control characters.",
  "error.clientIdRequired": "Enter the client ID the EHR/PM issued to DenialDesk.",
  "error.clientIdInvalid": "The client ID can only use visible characters without spaces, up to 255.",
  "error.url.invalid": "Enter the FHIR base URL, for example https://fhir.example.com/r4.",
  "error.url.too_long": "The URL is too long.",
  "error.url.not_https": "The URL must start with https://.",
  "error.url.credentials": "Remove the user name or password from the URL.",
  "error.url.query_or_fragment": "Remove the part after ? or # from the URL.",
  "error.url.ip_literal": "Use the server's host name, not an IP address.",
  "error.url.reserved_host":
    "This host name only works on a private network. Use the EHR/PM's public host name.",
  "error.url.single_label": "Use the full host name, including its domain (for example fhir.example.com).",
  "error.url.trailing_dot": "Remove the dot at the end of the host name.",
  "error.url.port_not_allowed": "This port isn't allowed. Use the standard HTTPS port (443).",
  "error.url.path_characters":
    "The URL path can only use letters, digits, and - . _ ~ /. Copy the base URL exactly as the EHR/PM documents it.",
  "error.url.sandbox": "To use the built-in test sandbox, choose it when you create the connection.",
  "error.realEndpointRefused":
    "This environment uses synthetic data only, so it can't connect to a real EHR/PM. Use the built-in test sandbox.",
  "error.sandboxRefused": "The built-in test sandbox isn't available in production.",
  "error.mrnSystem.invalid":
    "Enter the identifier system the EHR/PM uses for medical record numbers, as a URL or urn:oid.",
  "error.mrnSystem.too_long": "The identifier system is too long.",
  "error.mrnSystem.government_identifier":
    "That system is a Social Security, Medicare, driver's license, or passport number, not a medical record number.",
  "error.endpointLocked":
    "The URL, client ID, and identifier system can only change while the connection is a draft that has never synced.",
  "test.outcome.ok":
    "The test passed. DenialDesk reached the server, found its sign-in endpoint, and received an access token. No patient information was requested.",
  "test.outcome.unreachable":
    "DenialDesk couldn't reach the server. Check the base URL, and that the server is open to the internet and not blocked by a firewall. Try again in a few minutes.",
  "test.outcome.tls_failed":
    "The server's secure connection (TLS) couldn't be verified. Its certificate must be valid, issued by a public authority, and match the host name, and the server must support TLS 1.2 or later.",
  "test.outcome.not_fhir_r4":
    "The server didn't answer as FHIR R4 (version 4.0.1). Check that the base URL is the FHIR R4 endpoint.",
  "test.outcome.smart_config_invalid":
    "The server's SMART configuration is missing or unusable. DenialDesk needs SMART Backend Services with private key JWT signed with ES384 or RS384.",
  "test.outcome.auth_refused":
    "The server refused DenialDesk's credentials. Check the client ID, and that the EHR/PM administrator registered DenialDesk's public key for this client.",
  "test.outcome.capability_missing":
    "The server can't do what DenialDesk needs: search Patient by last-updated date, search Coverage by patient, and grant read access to Patient, Coverage, and Organization.",
  "test.error.rateLimited": "Too many connection tests. Wait a few minutes and try again.",
  "test.error.keyNotConfigured":
    "DenialDesk's signing key isn't configured in this environment, so connections can't be tested. Ask the platform operator to set it up.",
  "test.error.keyUnavailable":
    "DenialDesk's signing key isn't usable right now. Ask the platform operator to check it.",
  "test.error.sandboxUnavailable": "The built-in test sandbox can't be tested yet.",
  "test.error.failed": "The test couldn't be completed. Reload the page and try again.",
  "test.title": "Test connection",
  "test.description":
    "Checks that DenialDesk can reach the server, read its SMART configuration, and get an access token. No patient information is requested.",
  "test.submit": "Test connection",
  "test.pending": "Testing…",
  "test.resultOk": "Test passed",
  "test.resultFailed": "Test failed",
  "submit.title": "Submit connection",
  "submit.descriptionReal":
    "Submitting sends this connection to DenialDesk for approval. Nothing syncs until it's approved, and you can withdraw the submission until then. It needs a passing Test connection, your confirmation below, and a recent identity verification.",
  "submit.descriptionSandbox":
    "The built-in test sandbox holds synthetic data only, so it needs no approval: submitting activates it. It needs a passing Test connection and a recent identity verification.",
  "submit.attestation": "This EHR/PM endpoint stores and processes data only in the United States",
  "submit.attestationHint": "Recorded in the audit log with your name and the date.",
  "submit.stepUpNotice": "Submitting needs you to verify your identity with your authenticator app first.",
  "submit.blocked.noPassingTest":
    "Submit is unavailable: this connection has no passing Test connection from the last 24 hours. Run Test connection above. A failed test, or a change to the connection or to DenialDesk's signing key, needs a new pass.",
  "submit.blocked.sandbox":
    "Submit is unavailable: it needs a passing Test connection, and the built-in test sandbox can't be tested yet.",
  "submit.submit": "Submit for approval",
  "submit.submitSandbox": "Activate sandbox",
  "submit.pending": "Submitting…",
  "submit.awaitingTitle": "Awaiting DenialDesk approval",
  "submit.awaitingDescription":
    "DenialDesk reviews every real connection before it starts syncing. Nothing syncs until it's approved. To change the connection first, withdraw the submission.",
  "error.testRequired":
    "Test connection has to pass first. A pass counts for 24 hours, and only for the configuration and signing key it tested. Run it again, then submit.",
  "error.testRequiredToResume":
    "This connection stopped after an error. Run Test connection and get a pass before resuming.",
  "error.attestationRequired":
    "Confirm that the endpoint stores and processes data only in the United States.",
  "error.registryConflict": "This endpoint and client ID are already connected",
} as const;
