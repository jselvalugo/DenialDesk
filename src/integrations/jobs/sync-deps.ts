import type { SyncDeps } from "@/domain/integrations/sync";
import { getSigningKeyStore } from "@/integrations/fhir/keys";
import { transportForConnection } from "@/integrations/fhir/select-transport";

/**
 * What a background run executes on: the same wiring Sync now uses inline (`connectionTestDeps` in the
 * Settings pages). The transport is chosen from `is_sandbox` alone, never the host; the key store is built
 * per call so a production process with an environment signing key set refuses instead of crashing.
 */
export function productionSyncDeps(): SyncDeps {
  return {
    transportFor: (connection) => transportForConnection(connection, () => getSigningKeyStore()),
    keyStore: () => getSigningKeyStore(),
  };
}
