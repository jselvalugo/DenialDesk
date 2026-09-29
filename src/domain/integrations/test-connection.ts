import { eq, sql } from "drizzle-orm";
import { canManageIntegrations } from "@/auth/permissions";
import { integrationConnections } from "@/db/schema";
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
import { VENDOR_SANDBOX_HOSTS } from "@/integrations/fhir/vendor-sandboxes";
import { audit } from "@/lib/audit";
import type { JwtSigner } from "@/lib/crypto/jwt-sign";
import { hit } from "@/lib/rate-limit";
import {
  assertEnvironmentAllowsHost,
  IntegrationConnectionError,
  type IntegrationActor,
  type TxRunner,
} from "./connections";

// The Submit gate lives in `passing-test.ts` (so `connections.ts` can call it); re-exported here.
export { hasRecentPassingTest, PASS_BINDING_METADATA_KEYS, TEST_VALIDITY_MS } from "./passing-test";

// "Test connection" (docs/specs/patient-integrations.md PI2a): discovery plus one token request,
// never patient data. Administrator only. The network calls run with no database transaction open
// (a 30 s remote call must not hold a row lock or a pooled connection), so this is three steps:
// read the connection, talk to the EHR/PM, then record the result and audit it.

type IntegrationsT = Translator<Messages["integrations"]>;
const englishT: IntegrationsT = createTranslator(en.integrations, "en");

// Defined in `connections.ts` (Submit runs through it too) and re-exported for existing importers.
export type { TxRunner };

export interface TestConnectionDeps {
  /**
   * The transport for this connection. Chosen from `is_sandbox` alone, never from the host
   * (spec PI2b: the sandbox's in-process transport must not be reachable by naming its host).
   * `null` means this environment has none for it (the built-in sandbox where real data is allowed).
   */
  transportFor(connection: { id: string; isSandbox: boolean }): Transport | null;
  /** Called per test, so a store that can't be built here (production with an env key) is a refusal, not a crash. */
  keyStore(): SigningKeyStore;
  /** The clock the rate-limit window is computed from (tests pin it so a window can't roll mid-test). */
  now?: () => Date;
}

export interface TestConnectionResult {
  outcome: ConnectionOutcome;
  /** Translated, PHI-free, and free of anything the remote server sent. */
  message: string;
}

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

/**
 * The signer, or a translated refusal: nothing configured, or a key that can't be used. Never key
 * detail. An environment key found where real data is allowed is a misconfiguration worth a security
 * event of its own (IDs only), not just a refusal.
 */
async function signerFor(
  run: TxRunner,
  actor: IntegrationActor,
  keyStore: () => SigningKeyStore,
  target: Target,
  t: IntegrationsT,
): Promise<JwtSigner> {
  try {
    return await keyStore().signer(target.id);
  } catch (error) {
    if (error instanceof SigningKeyStoreError) {
      if (error.code === "env_key_in_production") {
        await run((tx) =>
          audit(tx, {
            action: "security.env_signing_key_in_production",
            actorUserId: actor.userId,
            tenantId: actor.tenantId,
            entityType: "integration_connection",
            entityId: target.id,
            reason: "connection_test",
          }),
        );
      }
      refuse(
        t,
        error.code === "not_configured" ? "test.error.keyNotConfigured" : "test.error.keyUnavailable",
      );
    }
    throw error;
  }
}

interface Attempt {
  outcome: ConnectionOutcome;
  /** What discovery found, whenever it got that far (also on a later failure). */
  discovery?: DiscoveryResult;
  failure?: FhirConnectError;
}

/**
 * Discovery, then one token request. The access token is discarded unread: only success matters.
 * Past draft the token endpoint **and issuer** are pinned, and a missing pin counts as a change
 * (fail closed): a test may never adopt what the server now says.
 */
async function attempt(
  target: Target,
  signer: JwtSigner,
  transport: Transport,
  syntheticOnly: boolean,
): Promise<Attempt> {
  let discovery: DiscoveryResult | undefined;
  try {
    discovery = await discover(transport, target.baseUrl, { sandbox: target.isSandbox });
    if (!discovery.algs.includes(signer.alg)) throw new FhirConnectError("smart_config_invalid");
    // Where only synthetic data is allowed the token endpoint's host is held to the same reviewed
    // list as the base URL's: the assertion is never sent to a host nobody reviewed.
    if (
      syntheticOnly &&
      !target.isSandbox &&
      !VENDOR_SANDBOX_HOSTS.includes(new URL(discovery.tokenEndpoint).hostname)
    ) {
      throw new FhirConnectError("smart_config_invalid", undefined, "token_host_not_permitted");
    }
    if (target.status !== "draft") {
      if (target.tokenEndpoint !== discovery.tokenEndpoint) {
        throw new FhirConnectError("smart_config_invalid", undefined, "token_endpoint_changed");
      }
      if (target.issuer !== discovery.issuer) {
        throw new FhirConnectError("smart_config_invalid", undefined, "issuer_changed");
      }
    }
    await requestAccessToken({
      transport,
      // Exactly as advertised: `aud` and the POST URL are what the server compares (the pin and the
      // comparisons above use the normalized form).
      tokenEndpoint: discovery.tokenEndpointAdvertised,
      clientId: target.clientId,
      signer,
      scopes: discovery.scopes,
    });
    return { outcome: "ok", discovery };
  } catch (error) {
    if (!isFhirConnectError(error)) throw error;
    return { outcome: error.outcome, discovery, failure: error };
  }
}

/** The common part of every `connection_tested` row: configuration and codes only, never remote text. */
function testedMetadata(target: Target, kid: string | null) {
  return {
    sandbox: target.isSandbox,
    base_url: target.baseUrl,
    client_id: target.clientId,
    ...(kid ? { kid } : {}),
  };
}

async function record(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  tested: Target,
  kid: string,
  attempted: Attempt,
): Promise<ConnectionOutcome> {
  const [row] = await tx
    .select(targetColumns)
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id))
    .for("update");
  if (!row) return attempted.outcome;

  const found = attempted.discovery;
  let outcome = attempted.outcome;
  let failure = attempted.failure;

  // The connection may have changed while we were talking to the server (a draft edited, a state
  // moved on). A pass only counts for the configuration that was actually tested and that still
  // matches under the lock; otherwise record a failure instead of a pass.
  if (outcome === "ok" && found) {
    const changed: FhirConnectError["detail"] | null =
      row.baseUrl !== tested.baseUrl || row.clientId !== tested.clientId || row.status !== tested.status
        ? "config_changed"
        : row.status !== "draft" && row.tokenEndpoint !== found.tokenEndpoint
          ? "token_endpoint_changed"
          : row.status !== "draft" && row.issuer !== found.issuer
            ? "issuer_changed"
            : null;
    if (changed) {
      outcome = "smart_config_invalid";
      failure = new FhirConnectError("smart_config_invalid", undefined, changed);
    }
  }

  // Only a still-draft connection that has never synced may adopt what discovery found; the same
  // fields are locked by the lifecycle trigger afterwards.
  const pin =
    outcome === "ok" &&
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

  await audit(tx, {
    action: "integration.connection_tested",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    reason: "connection_test",
    // Configuration and codes only: never a response body, header, token, or remote error text.
    // The endpoint recorded is the one that was actually tested (`found`), not whatever the row says
    // now; the Submit gate compares every PASS_BINDING_METADATA_KEYS field to the live connection.
    metadata: {
      outcome,
      ...testedMetadata(tested, kid),
      token_endpoint: found?.tokenEndpoint ?? null,
      token_endpoint_key: found?.tokenEndpointKey ?? null,
      issuer: found?.issuer ?? null,
      pinned: pin,
      ...(pin ? { previous_token_endpoint: row.tokenEndpoint, previous_issuer: row.issuer } : {}),
      ...(failure?.transportCode ? { transport_code: failure.transportCode } : {}),
      ...(failure?.detail ? { detail: failure.detail } : {}),
    },
  });

  // Address, TLS, and redirect refusals are security events of their own, IDs only: no URL, host, or
  // path (spec "Callers of the transport").
  const code = failure?.transportCode;
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
  return outcome;
}

/**
 * An unexpected error after the rate limit was spent and before a result was recorded still leaves
 * a `connection_tested` row (`unreachable`, detail `internal_error`), so the audit log shows every
 * attempt and, for the Submit gate, the newest test is not a stale pass. Best effort: if even this
 * write fails, the original error is the one to surface.
 */
async function recordInternalError(
  run: TxRunner,
  actor: IntegrationActor,
  id: string,
  target: Target,
  kid: string,
) {
  try {
    await run((tx) =>
      audit(tx, {
        action: "integration.connection_tested",
        actorUserId: actor.userId,
        tenantId: actor.tenantId,
        entityType: "integration_connection",
        entityId: id,
        reason: "connection_test",
        metadata: {
          outcome: "unreachable",
          ...testedMetadata(target, kid),
          token_endpoint: null,
          pinned: false,
          detail: "internal_error",
        },
      }),
    );
  } catch {
    // Nothing more to do here.
  }
}

/**
 * Tests a connection (admin only). Throws `IntegrationConnectionError` (translated) for refusals that
 * happen before any network call — not an admin, not found, revoked, an environment that doesn't
 * allow the host, no usable key, rate-limited — and otherwise returns the collapsed outcome with its
 * translated message. Every completed test is audited (`integration.connection_tested`), pass or
 * fail, and so is an unexpected error after the rate limit was spent.
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
  // The environment rule again, before any network call: the shared pre-production signing key must
  // never be presented to a real practice EHR. The built-in sandbox is in-process, never dialed.
  if (!target.isSandbox) {
    assertEnvironmentAllowsHost(new URL(target.baseUrl).hostname, actor.syntheticOnly, t);
  } else if (!actor.syntheticOnly) {
    // The built-in sandbox is synthetic data only: never tested where real data is allowed.
    refuse(t, "error.sandboxRefused");
  }
  // Refusals that dial nothing come before the rate limit, so they don't spend it.
  const transport = deps.transportFor(target);
  if (!transport) refuse(t, "test.error.sandboxUnavailable");
  const signer = await signerFor(run, actor, deps.keyStore, target, t);
  await enforceRateLimits(run, actor, id, t, deps.now?.());

  let attempted: Attempt;
  try {
    attempted = await attempt(target, signer, transport, actor.syntheticOnly);
  } catch (error) {
    await recordInternalError(run, actor, id, target, signer.kid);
    // A key store that fails while signing (a vault outage, say) is the same refusal as one that
    // can't be read up front; anything else is a bug and is rethrown.
    if (error instanceof SigningKeyStoreError) refuse(t, "test.error.keyUnavailable");
    throw error;
  }
  let outcome: ConnectionOutcome;
  try {
    // `record` may turn a pass into a failure (the connection changed while we talked to the server).
    outcome = await run((tx) => record(tx, actor, id, target, signer.kid, attempted));
  } catch (error) {
    await recordInternalError(run, actor, id, target, signer.kid);
    throw error;
  }
  return { outcome, message: outcomeMessage(outcome, t) };
}
