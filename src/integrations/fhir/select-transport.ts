import { syntheticDataOnly } from "@/lib/env";
import type { SigningKeyStore } from "./keys";
import { SandboxTransport } from "./sandbox/transport";
import { HttpsTransport, type Transport } from "./transport";

/**
 * The transport for a connection (docs/specs/patient-integrations.md PI2b): **chosen from `is_sandbox`
 * alone, never from the host**, so naming the sandbox's host can't reach the in-process server and a
 * real connection can never be answered by it. The built-in sandbox exists only where
 * `syntheticDataOnly()`; anywhere else the answer is `null` (no transport), so `SYN` patients can never
 * land in a production tenant (compliance review #13, security review L-1). A real connection always
 * gets the guarded `HttpsTransport`; whether it may be dialed at all is the environment rule, applied
 * by the callers (Test connection, the sync run) before this is asked.
 *
 * The sandbox verifies client assertions against the public half of the key the store signs with, so
 * it needs the store; it never sees a private key.
 */
export function transportForConnection(
  connection: { id: string; isSandbox: boolean },
  keyStore: () => SigningKeyStore,
  synthetic: () => boolean = syntheticDataOnly,
): Transport | null {
  if (connection.isSandbox) {
    if (!synthetic()) return null;
    return new SandboxTransport({ publicKeys: () => keyStore().publicJwks(connection.id), synthetic });
  }
  return new HttpsTransport();
}
