import { and, desc, eq, gte, sql } from "drizzle-orm";
import { canManageIntegrations } from "@/auth/permissions";
import { auditEvents, integrationConnections } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { en } from "@/i18n/messages/en";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import { requestAccessToken } from "@/integrations/fhir/auth";
import { discover, type DiscoveryResult } from "@/integrations/fhir/discovery";
import {
  FhirConnectError,
  isFhirConnectError,
  isSecurityTransportCode,
  type ConnectionOutcome,
} from "@/integrations/fhir/outcomes";
import { SigningKeyStoreError, type SigningKeyStore } from "@/integrations/fhir/keys";
import type { Transport } from "@/integrations/fhir/transport";
import { audit } from "@/lib/audit";
import type { JwtSigner } from "@/lib/crypto/jwt-sign";
import { hit } from "@/lib/rate-limit";
import { IntegrationConnectionError, type IntegrationActor } from "./connections";

// "Test connection" (docs/specs/patient-integrations.md PI2a): discovery plus one token request,
// never patient data. Administrator only. The network calls run with no database transaction open
// (a 30 s remote call must not hold a row lock or a pooled connection), so this is three steps:
// read the connection, talk to the EHR/PM, then record the result and audit it.

type IntegrationsT = Translator<Messages["integrations"]>;
const englishT: IntegrationsT = createTranslator(en.integrations, "en");

/** Runs a function in one tenant transaction (`withTenant` bound to the signed-in user). */
export type TxRunner = <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;

export interface TestConnectionDeps {
  /**
   * The transport for this connection. Chosen from `is_sandbox` alone, never from the host
   * (spec PI2b: the sandbox's in-process transport must not be reachable by naming its host).
   */
  transportFor(connection: { isSandbox: boolean }): Transport;
  keyStore: SigningKeyStore;
  /** The clock the rate-limit window is computed from (tests pin it so a window can't roll mid-test). */
  now?: () => Date;
}

export interface TestConnectionResult {
  outcome: ConnectionOutcome;
  /** Translated, PHI-free, and free of anything the remote server sent. */
  message: string;
}

/** "Submit requires a passing test in the last 24 h" (spec PI2a). A product rule, not a legal value. */
export const TEST_VALIDITY_MS = 24 * 60 * 60 * 1000;

const OUTCOME_MESSAGE_KEYS = {
  ok: "test.outcome.ok",
  unreachable: "test.outcome.unreachable",
  tls_failed: "test.outcome.tls_failed",
  not_fhir_r4: "test.outcome.not_fhir_r4",
  smart_config_invalid: "test.outcome.smart_config_invalid",
  auth_refused: "test.outcome.auth_refused",
  capability_missing: "test.outcome.capability_missing",
} as const satisfies Record<ConnectionOutcome, MessageKey<"integrations">>;

/** The translated sentence for an outcome (used by the action and the page). */
export function outcomeMessage(outcome: ConnectionOutcome, t: IntegrationsT = englishT): string {
  return t(OUTCOME_MESSAGE_KEYS[outcome]);
}

function refuse(t: IntegrationsT, key: MessageKey<"integrations">): never {
  throw new IntegrationConnectionError(t(key));
}

const targetColumns = {
  id: integrationConnections.id,
  status: integrationConnections.status,
  isSandbox: integrationConnections.isSandbox,
  hasSynced: integrationConnections.hasSynced,
  baseUrl: integrationConnections.baseUrl,
  clientId: integrationConnections.clientId,
  tokenEndpoint: integrationConnections.tokenEndpoint,
  tokenEndpointKey: integrationConnections.tokenEndpointKey,
  issuer: integrationConnections.issuer,
  keyRef: integrationConnections.keyRef,
};

async function loadTarget(tx: TenantTx, id: string, t: IntegrationsT) {
  const [row] = await tx
    .select(targetColumns)
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  if (!row) refuse(t, "error.notFound");
  if (row.status === "revoked") refuse(t, "error.revoked");
  return row;
}

type Target = Awaited<ReturnType<typeof loadTarget>>;

async function enforceRateLimits(
  run: TxRunner,
  actor: IntegrationActor,
  id: string,
  t: IntegrationsT,
  now: Date | undefined,
) {
  const checks = [
    ["integration_test_connection", `connection:${id}`],
    ["integration_test_practice", `practice:${actor.tenantId}`],
  ] as const;
  for (const [bucket, key] of checks) {
    const result = await hit(bucket, key, now);
    if (result.allowed) continue;
    await run((tx) =>
      audit(tx, {
        action: "security.rate_limited",
        actorUserId: actor.userId,
        tenantId: actor.tenantId,
        entityType: "integration_connection",
        entityId: id,
        reason: "connection_test",
        metadata: { bucket },
      }),
    );
    refuse(t, "test.error.rateLimited");
  }
}

async function signerFor(store: SigningKeyStore, target: Target, t: IntegrationsT): Promise<JwtSigner> {
  if (!target.keyRef) refuse(t, "test.error.noKey");
  try {
    return await store.signer(target.id, target.keyRef);
  } catch (error) {
    if (error instanceof SigningKeyStoreError) refuse(t, "test.error.keyUnavailable");
    throw error;
  }
}

interface Attempt {
  outcome: ConnectionOutcome;
  discovery?: DiscoveryResult;
  failure?: FhirConnectError;
}

/** Discovery, then one token request. The access token is discarded unread: only success matters. */
async function attempt(target: Target, signer: JwtSigner, transport: Transport): Promise<Attempt> {
  let discovery: DiscoveryResult | undefined;
  try {
    discovery = await discover(transport, target.baseUrl, { sandbox: target.isSandbox });
    if (!discovery.algs.includes(signer.alg)) throw new FhirConnectError("smart_config_invalid");
    // Once out of draft, the token endpoint is pinned: a different one is a change to investigate,
    // not something a test may adopt (spec PI2b/PI3: token-endpoint change).
    if (
      target.status !== "draft" &&
      target.tokenEndpoint &&
      target.tokenEndpoint !== discovery.tokenEndpoint
    ) {
      throw new FhirConnectError("smart_config_invalid", undefined, "token_endpoint_changed");
    }
    await requestAccessToken({
      transport,
      tokenEndpoint: discovery.tokenEndpoint,
      clientId: target.clientId,
      signer,
      scopes: discovery.scopes,
    });
    return { outcome: "ok", discovery };
  } catch (error) {
    if (!isFhirConnectError(error)) throw error;
    return { outcome: error.outcome, failure: error };
  }
}

async function record(tx: TenantTx, actor: IntegrationActor, id: string, result: Attempt) {
  const [row] = await tx
    .select(targetColumns)
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id))
    .for("update");
  if (!row) return;

  // Only a still-draft connection that has never synced may adopt what discovery found; the same
  // fields are locked by the lifecycle trigger afterwards.
  const found = result.discovery;
  const pin =
    result.outcome === "ok" &&
    found !== undefined &&
    row.status === "draft" &&
    !row.hasSynced &&
    (row.tokenEndpoint !== found.tokenEndpoint ||
      row.tokenEndpointKey !== found.tokenEndpointKey ||
      row.issuer !== found.issuer);
  if (pin) {
    await tx
      .update(integrationConnections)
      .set({
        tokenEndpoint: found.tokenEndpoint,
        tokenEndpointKey: found.tokenEndpointKey,
        issuer: found.issuer,
        updatedBy: actor.userId,
        updatedAt: sql`now()`,
      })
      .where(eq(integrationConnections.id, id));
  }
  const tokenEndpoint = pin ? found.tokenEndpoint : row.tokenEndpoint;

  await audit(tx, {
    action: "integration.connection_tested",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    reason: "connection_test",
    // Configuration and codes only: never a response body, header, token, or remote error text.
    metadata: {
      outcome: result.outcome,
      sandbox: row.isSandbox,
      base_url: row.baseUrl,
      client_id: row.clientId,
      token_endpoint: tokenEndpoint ?? null,
      pinned: pin,
      ...(result.failure?.transportCode ? { transport_code: result.failure.transportCode } : {}),
      ...(result.failure?.detail ? { detail: result.failure.detail } : {}),
    },
  });

  // Address, TLS, and redirect refusals are security events of their own, IDs only: no URL, host, or
  // path (spec "Callers of the transport").
  const code = result.failure?.transportCode;
  if (code && isSecurityTransportCode(code)) {
    await audit(tx, {
      action: "integration.transport_refused",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "integration_connection",
      entityId: id,
      reason: "connection_test",
      metadata: { code },
    });
  }
}

/**
 * Tests a connection (admin only). Throws `IntegrationConnectionError` (translated) for refusals that
 * happen before any network call — not an admin, not found, revoked, rate-limited, no usable key —
 * and otherwise returns the collapsed outcome with its translated message. Every completed test is
 * audited (`integration.connection_tested`), pass or fail.
 */
export async function testConnection(
  run: TxRunner,
  actor: IntegrationActor,
  id: string,
  deps: TestConnectionDeps,
  t: IntegrationsT = englishT,
): Promise<TestConnectionResult> {
  if (!canManageIntegrations(actor.role)) refuse(t, "error.notAdmin");
  const target = await run((tx) => loadTarget(tx, id, t));
  await enforceRateLimits(run, actor, id, t, deps.now?.());
  const signer = await signerFor(deps.keyStore, target, t);
  const result = await attempt(target, signer, deps.transportFor(target));
  await run((tx) => record(tx, actor, id, result));
  return { outcome: result.outcome, message: outcomeMessage(result.outcome, t) };
}

/**
 * Whether the connection has a passing test in the last 24 h **for its current configuration**: the
 * newest `ok` `integration.connection_tested` audit event in the window must name the connection's
 * present base URL, client ID, and pinned token endpoint, so editing any of them invalidates it.
 * This is what Submit (spec PI2a) requires. The audit log is the record — there is no column for it.
 */
export async function hasRecentPassingTest(
  tx: TenantTx,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - TEST_VALIDITY_MS);
  const [event] = await tx
    .select({ metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, "integration.connection_tested"),
        eq(auditEvents.entityType, "integration_connection"),
        eq(auditEvents.entityId, id),
        sql`${auditEvents.metadata}->>'outcome' = 'ok'`,
        gte(auditEvents.occurredAt, cutoff),
      ),
    )
    .orderBy(desc(auditEvents.id))
    .limit(1);
  if (!event?.metadata) return false;
  const [row] = await tx
    .select({
      baseUrl: integrationConnections.baseUrl,
      clientId: integrationConnections.clientId,
      tokenEndpoint: integrationConnections.tokenEndpoint,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return (
    !!row &&
    !!row.tokenEndpoint &&
    event.metadata.base_url === row.baseUrl &&
    event.metadata.client_id === row.clientId &&
    event.metadata.token_endpoint === row.tokenEndpoint
  );
}
