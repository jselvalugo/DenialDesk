import { and, desc, eq, inArray } from "drizzle-orm";
import { auditEvents, integrationConnections } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";

// "A passing Test connection in the last 24 h" (docs/specs/patient-integrations.md PI2a): the gate
// Submit and Resume-from-error both call. Its own module (rather than beside `testConnection`) so
// `connections.ts`, which those transitions live in, can use it without importing the network code.
// `test-connection.ts` re-exports everything here, so existing imports keep working.

/** "Submit requires a passing test in the last 24 h" (spec PI2a). A product rule, not a legal value. */
export const TEST_VALIDITY_MS = 24 * 60 * 60 * 1000;

/**
 * The connection fields (and the key) a recorded pass is tied to: every one of these is written into
 * the `connection_tested` metadata and compared by `hasRecentPassingTest`, so editing any of them, or
 * rotating the key, voids the pass. Exported so a test pins the coupling.
 */
// `token_endpoint_key` is redundant with `token_endpoint` by construction (0041: key = lower(url));
// it stays as a cheap belt-and-braces check.
export const PASS_BINDING_METADATA_KEYS = [
  "base_url",
  "client_id",
  "token_endpoint",
  "token_endpoint_key",
  "issuer",
  "kid",
] as const;

/**
 * Whether the connection has a passing test in the last 24 h **for its current configuration and
 * key** (what Submit requires, spec PI2a). The audit log is the record — there is no column for it.
 *
 * The **newest** test outcome must be a pass: the newest `integration.connection_tested` or
 * `integration.transport_refused` event for the connection has to be an `ok` test, inside the window,
 * whose recorded base URL, client ID, token endpoint, token endpoint key, issuer, and signing-key
 * `kid` all still match the connection and the key in use. So any later failed test, or refused
 * address/TLS/redirect, voids the pass (coordinator decision 2026-09-28, pending owner confirmation).
 * The tenant is checked explicitly as well as by row-level security. Callers: Submit and Resume from
 * `error` (`connections.ts`), each under the row lock, with the live signing key's `kid`.
 */
export async function hasRecentPassingTest(
  tx: TenantTx,
  tenantId: string,
  id: string,
  kid: string,
  now: Date = new Date(),
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - TEST_VALIDITY_MS);
  const [event] = await tx
    .select({
      action: auditEvents.action,
      metadata: auditEvents.metadata,
      occurredAt: auditEvents.occurredAt,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.entityType, "integration_connection"),
        eq(auditEvents.entityId, id),
        inArray(auditEvents.action, ["integration.connection_tested", "integration.transport_refused"]),
      ),
    )
    .orderBy(desc(auditEvents.id))
    .limit(1);
  if (!event?.metadata || event.action !== "integration.connection_tested") return false;
  if (event.metadata.outcome !== "ok" || event.occurredAt < cutoff || !kid) return false;

  const [row] = await tx
    .select({
      baseUrl: integrationConnections.baseUrl,
      clientId: integrationConnections.clientId,
      tokenEndpoint: integrationConnections.tokenEndpoint,
      tokenEndpointKey: integrationConnections.tokenEndpointKey,
      issuer: integrationConnections.issuer,
    })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.tenantId, tenantId), eq(integrationConnections.id, id)));
  if (!row?.tokenEndpoint || !row.tokenEndpointKey || !row.issuer) return false;
  const live: Record<(typeof PASS_BINDING_METADATA_KEYS)[number], string> = {
    base_url: row.baseUrl,
    client_id: row.clientId,
    token_endpoint: row.tokenEndpoint,
    token_endpoint_key: row.tokenEndpointKey,
    issuer: row.issuer,
    kid,
  };
  return PASS_BINDING_METADATA_KEYS.every((key) => event.metadata![key] === live[key]);
}
