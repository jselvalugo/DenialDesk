import type { TestConnectionDeps } from "@/domain/integrations/test-connection";
import { getSigningKeyStore } from "@/integrations/fhir/keys";
import { transportForConnection } from "@/integrations/fhir/select-transport";

/**
 * What Test connection and Sync now run on in this environment. The transport is chosen from
 * `is_sandbox` alone, never the host: a real connection always gets the guarded `HttpsTransport`; the
 * built-in sandbox gets the in-process synthetic server, and only where only synthetic data is allowed
 * (elsewhere it gets none, and is never dialed over the network). The key store is built per call, so a
 * production process with an environment signing key set refuses instead of crashing the page.
 */
export function connectionTestDeps(): TestConnectionDeps {
  return {
    transportFor: (connection) => transportForConnection(connection, () => getSigningKeyStore()),
    keyStore: () => getSigningKeyStore(),
  };
}
