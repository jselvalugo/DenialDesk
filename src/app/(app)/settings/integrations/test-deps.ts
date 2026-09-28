import type { TestConnectionDeps } from "@/domain/integrations/test-connection";
import { getSigningKeyStore } from "@/integrations/fhir/keys";
import { HttpsTransport } from "@/integrations/fhir/transport";

/**
 * What Test connection runs on in this environment. The transport is chosen from `is_sandbox` alone,
 * never the host: a real connection always gets the guarded `HttpsTransport`; the built-in sandbox has
 * no transport until PI2b builds its in-process one, so it can't be tested yet (and is never dialed
 * over the network). The key store is built per test, so a production process with an environment
 * signing key set refuses the test instead of crashing the page.
 */
export function connectionTestDeps(): TestConnectionDeps {
  return {
    transportFor: (connection) => (connection.isSandbox ? null : new HttpsTransport()),
    keyStore: () => getSigningKeyStore(),
  };
}
