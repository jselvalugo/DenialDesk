// Vendor-hosted FHIR sandboxes a non-production environment may connect to
// (docs/specs/patient-integrations.md "Environment and population rules"). Empty on purpose: a
// vendor sandbox's identifiers lack the `SYN` prefix, and there is no prefixing on ingest, so none is
// usable until the owner decides how its synthetic origin is proven (OA-049). Adding a host here is a
// reviewed code change, never configuration.
export const VENDOR_SANDBOX_HOSTS: readonly string[] = [];
