/** Messages for EHR/PM integrations (docs/specs/patient-integrations.md). Flat keys, dotted for grouping. */
export const integrations = {
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
} as const;
