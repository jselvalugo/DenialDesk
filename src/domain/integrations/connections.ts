import { createHash } from "node:crypto";
import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import type { Role } from "@/auth/session";
import {
  integrationConnectionStatusEnum,
  integrationConnections,
  integrationSyncRunStatusEnum,
} from "@/db/schema";
import { isUniqueViolation, type DatabaseError, type TenantTx } from "@/db/tenant";
import { isLocale, type Locale } from "@/i18n/config";
import { en } from "@/i18n/messages/en";
import { messages } from "@/i18n/messages";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import {
  checkMrnIdentifierSystem,
  identifierSystemHost,
  INVISIBLE_CHARS,
  MAX_IDENTIFIER_SYSTEM_LENGTH,
} from "@/integrations/fhir/identifier-rules";
import {
  checkBaseUrl,
  MAX_BASE_URL_LENGTH,
  SANDBOX_BASE_URL,
  SANDBOX_CLIENT_ID,
  SANDBOX_HOST,
  SANDBOX_MRN_SYSTEM,
} from "@/integrations/fhir/url-rules";
import { SigningKeyStoreError, type SigningKeyStore } from "@/integrations/fhir/keys";
import { VENDOR_SANDBOX_HOSTS } from "@/integrations/fhir/vendor-sandboxes";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { hit } from "@/lib/rate-limit";
import { hasRecentPassingTest } from "./passing-test";
import { isRevokeReasonCode } from "./revoke-reasons";

// EHR/PM connections as an administrator creates and edits them (docs/specs/patient-integrations.md
// PI1b; ADR 0010). Configuration only, never PHI. The database (drizzle/0039, 0040) enforces the
// same lifecycle and editability rules again as a second layer; these checks come first so the
// administrator gets a field-level message instead of a trigger error.

type IntegrationsT = Translator<Messages["integrations"]>;
type IntegrationsKey = MessageKey<"integrations">;
const englishT: IntegrationsT = createTranslator(en.integrations, "en");

export type ConnectionStatus = (typeof integrationConnectionStatusEnum.enumValues)[number];

/** Status labels (message keys) for the list, the detail page, and the tab-bar drop-down. */
export const CONNECTION_STATUS_LABEL_KEYS = {
  draft: "status.draft",
  pending_approval: "status.pending_approval",
  active: "status.active",
  paused: "status.paused",
  error: "status.error",
  revoked: "status.revoked",
} as const satisfies Record<ConnectionStatus, IntegrationsKey>;

/** Badge tone per status; the label always carries the meaning, never the color alone. */
export const CONNECTION_STATUS_TONE = {
  draft: "neutral",
  pending_approval: "info",
  active: "success",
  paused: "warning",
  error: "danger",
  revoked: "neutral",
} as const satisfies Record<ConnectionStatus, "neutral" | "info" | "success" | "warning" | "danger">;

/**
 * A refusal with a translated message and, when it belongs to one, the form field it concerns.
 * `stepUpRequired` marks the refusal that a fresh MFA verification fixes (R-7.2.2), so the page
 * can offer the way to do it rather than only saying no.
 */
export class IntegrationConnectionError extends Error {
  constructor(
    message: string,
    readonly field?: ConnectionField,
    readonly stepUpRequired = false,
  ) {
    super(message);
    this.name = "IntegrationConnectionError";
  }
}

export type ConnectionField =
  "displayName" | "baseUrl" | "clientId" | "mrnIdentifierSystem" | "reason" | "attestation";

/** Runs a function in one tenant transaction (`withTenant` bound to the signed-in user). */
export type TxRunner = <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;

export interface IntegrationActor {
  tenantId: string;
  userId: string;
  role: Role;
  /** `syntheticDataOnly()`: real EHR endpoints are refused, only the built-in sandbox is allowed. */
  syntheticOnly: boolean;
  /**
   * `hasRecentMfa(session.mfaVerifiedAt)`: MFA completed within the step-up window (R-7.2.2). Always
   * derived from the session on the server, never from the request. Absent means false, so an actor
   * built without it can't pass a step-up gate.
   */
  recentMfa?: boolean;
  /** When that verification happened (ISO), recorded with the actions it unlocked; from the session. */
  stepUpVerifiedAt?: string | null;
  /** The signed-in session's row ID (`AuthContext.sessionId`), recorded in audit events that carry it. */
  sessionId?: string | null;
}

/** SMART client IDs are opaque strings; visible ASCII without spaces covers every vendor we know. */
const CLIENT_ID = /^[\x21-\x7e]{1,255}$/;

/**
 * The only fields a client may set (spec PI1b: a strict allow-list). Status, token endpoint,
 * issuer, key reference, tenant, and approval fields never come from the client; `.strict()`
 * refuses any extra key rather than silently dropping it. Raw lengths are capped here too, before
 * the URL and identifier rules run.
 */
const endpointInputSchema = z
  .object({
    displayName: z.string().max(400),
    baseUrl: z.string().max(MAX_BASE_URL_LENGTH + 100),
    clientId: z.string().max(400),
    mrnIdentifierSystem: z.string().max(MAX_IDENTIFIER_SYSTEM_LENGTH + 100),
  })
  .strict();
const sandboxInputSchema = z.object({ displayName: z.string().max(400) }).strict();
/** Editing a connection whose endpoint is locked: the name, plus the endpoint fields only if the
 * form still sends them (a disabled input is omitted), so they can be compared, never re-validated. */
const lockedInputSchema = endpointInputSchema.partial().required({ displayName: true }).strict();

export interface EndpointInput {
  displayName: string;
  baseUrl: string;
  endpointKey: string;
  clientId: string;
  mrnIdentifierSystem: string;
}

function fail(t: IntegrationsT, key: IntegrationsKey, field?: ConnectionField): never {
  throw new IntegrationConnectionError(t(key), field);
}

/** Maps a ZodError to a field-level refusal. The ZodError itself is never logged or returned. */
function parseOrFail<T>(schema: z.ZodType<T>, raw: unknown, t: IntegrationsT): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path[0];
  if (issue?.code === "unrecognized_keys" || typeof field !== "string") fail(t, "error.unexpectedField");
  // Missing or not a string (FormData.get returns null for an absent input) reads as "required";
  // only an over-long string reads as "too long".
  const tooLong = issue?.code === "too_big";
  const known: Record<string, [IntegrationsKey, IntegrationsKey, ConnectionField]> = {
    displayName: ["error.displayNameTooLong", "error.displayNameRequired", "displayName"],
    baseUrl: ["error.url.too_long", "error.url.invalid", "baseUrl"],
    clientId: ["error.clientIdInvalid", "error.clientIdRequired", "clientId"],
    mrnIdentifierSystem: ["error.mrnSystem.too_long", "error.mrnSystem.invalid", "mrnIdentifierSystem"],
  };
  const entry = known[field];
  if (!entry) fail(t, "error.unexpectedField");
  fail(t, tooLong ? entry[0] : entry[1], entry[2]);
}

function checkDisplayName(raw: string, t: IntegrationsT): string {
  const name = raw.trim();
  if (name.length === 0) fail(t, "error.displayNameRequired", "displayName");
  if (name.length > 80) fail(t, "error.displayNameTooLong", "displayName");
  // Control, zero-width, and bidi characters never belong in a name shown in the tab bar and the
  // operator's approval queue (security review L-4).
  if (INVISIBLE_CHARS.test(name)) fail(t, "error.displayNameInvalid", "displayName");
  return name;
}

/**
 * Validates a real (non-sandbox) endpoint's fields and the environment rule
 * (spec "Environment and population rules"): where only synthetic data is allowed, a real EHR host
 * is refused at save — only a reviewed vendor-sandbox host (none yet, OA-049) gets through.
 */
export function parseEndpointInput(
  raw: unknown,
  syntheticOnly: boolean,
  t: IntegrationsT = englishT,
): EndpointInput {
  const input = parseOrFail(endpointInputSchema, raw, t);
  const displayName = checkDisplayName(input.displayName, t);
  const url = checkBaseUrl(input.baseUrl);
  if (!url.ok) fail(t, `error.url.${url.code}`, "baseUrl");
  // Any URL on the sandbox host, not only the sandbox's exact base URL (security review L-1): a real
  // connection must never look like the sandbox, whatever PI2b keys its transport choice on.
  if (url.host === SANDBOX_HOST) fail(t, "error.url.sandbox", "baseUrl");
  assertEnvironmentAllowsHost(url.host, syntheticOnly, t, "baseUrl");
  const clientId = input.clientId.trim();
  if (clientId.length === 0) fail(t, "error.clientIdRequired", "clientId");
  if (!CLIENT_ID.test(clientId)) fail(t, "error.clientIdInvalid", "clientId");
  const system = checkMrnIdentifierSystem(input.mrnIdentifierSystem);
  if (!system.ok) fail(t, `error.mrnSystem.${system.code}`, "mrnIdentifierSystem");
  // Any identifier system on the sandbox host, in any spelling (security re-check).
  if (identifierSystemHost(system.system) === SANDBOX_HOST) {
    fail(t, "error.mrnSystem.invalid", "mrnIdentifierSystem");
  }
  return {
    displayName,
    baseUrl: url.baseUrl,
    endpointKey: url.endpointKey,
    clientId,
    mrnIdentifierSystem: system.system,
  };
}

/**
 * The environment rule (spec "Environment and population rules"), checked at save and again before
 * every network call (Test connection): where only synthetic data is allowed, the only hosts that may
 * be dialed are the reviewed vendor sandboxes (`VENDOR_SANDBOX_HOSTS`, empty, OA-049); the built-in
 * sandbox is in-process and never dialed. `syntheticOnly` always comes from the server's environment.
 */
export function assertEnvironmentAllowsHost(
  host: string,
  syntheticOnly: boolean,
  t: IntegrationsT = englishT,
  field?: ConnectionField,
): void {
  if (syntheticOnly && !VENDOR_SANDBOX_HOSTS.includes(host)) fail(t, "error.realEndpointRefused", field);
}

function assertAdmin(actor: IntegrationActor, t: IntegrationsT) {
  if (!canManageIntegrations(actor.role)) fail(t, "error.notAdmin");
}

/**
 * Step-up gate (R-7.2.2): refuses unless the actor's session completed MFA within the last five
 * minutes. Resume uses it now; Submit (PI2a-2) and payer mapping (PI2b) call the same helper, so the
 * rule and its message live in one place. The refusal carries `stepUpRequired` so the page can link
 * to `/step-up`.
 */
export function requireStepUp(actor: IntegrationActor, t: IntegrationsT = englishT): void {
  if (actor.recentMfa !== true) {
    throw new IntegrationConnectionError(t("error.stepUpRequired"), undefined, true);
  }
}

/**
 * The environment rule (spec "Environment and population rules") for a lifecycle change: where only
 * synthetic data is allowed only the sandbox may be worked with, and in production only a real
 * endpoint. Pure, so it is unit-tested without a database.
 */
export function assertEnvironmentAllows(
  isSandbox: boolean,
  actor: Pick<IntegrationActor, "syntheticOnly">,
  t: IntegrationsT = englishT,
): void {
  const refusal = environmentRefusalKey(isSandbox, actor);
  if (refusal) fail(t, refusal);
}

/**
 * The message key `assertEnvironmentAllows` would refuse with, or null when the environment allows
 * the connection. Shared with the connection page so the Submit panel shows the reason instead of a
 * button the server would refuse.
 */
export function environmentRefusalKey(
  isSandbox: boolean,
  actor: Pick<IntegrationActor, "syntheticOnly">,
): IntegrationsKey | null {
  if (isSandbox && !actor.syntheticOnly) return "error.sandboxRefused";
  if (!isSandbox && actor.syntheticOnly) return "error.realEndpointRefused";
  return null;
}

/**
 * Whether another connection for this table is already submitted or live (any status but `draft` or
 * `revoked`): the database allows only one per practice and table (`integration_connections_one_active`),
 * and Submit is what would take a second one out of `draft`.
 */
export async function hasAnotherLiveConnection(
  tx: TenantTx,
  tenantId: string,
  targetTable: string,
  id: string,
): Promise<boolean> {
  const [other] = await tx
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.tenantId, tenantId),
        eq(integrationConnections.targetTable, targetTable),
        ne(integrationConnections.id, id),
        notInArray(integrationConnections.status, ["draft", "revoked"]),
      ),
    )
    .limit(1);
  return other !== undefined;
}

/** Columns safe to show an administrator: configuration only (no key reference or exception text). */
const detailColumns = {
  id: integrationConnections.id,
  targetTable: integrationConnections.targetTable,
  isSandbox: integrationConnections.isSandbox,
  displayName: integrationConnections.displayName,
  baseUrl: integrationConnections.baseUrl,
  clientId: integrationConnections.clientId,
  mrnIdentifierSystem: integrationConnections.mrnIdentifierSystem,
  tokenEndpoint: integrationConnections.tokenEndpoint,
  issuer: integrationConnections.issuer,
  status: integrationConnections.status,
  statusReason: integrationConnections.statusReason,
  hasSynced: integrationConnections.hasSynced,
  submittedAt: integrationConnections.submittedAt,
  approvedAt: integrationConnections.approvedAt,
  revokedAt: integrationConnections.revokedAt,
  lastSuccessAt: integrationConnections.lastSuccessAt,
  createdAt: integrationConnections.createdAt,
  updatedAt: integrationConnections.updatedAt,
};

/** The practice's connections, newest first (RLS scopes them to the tenant). */
export async function listConnections(tx: TenantTx) {
  return tx
    .select({
      id: integrationConnections.id,
      displayName: integrationConnections.displayName,
      targetTable: integrationConnections.targetTable,
      isSandbox: integrationConnections.isSandbox,
      status: integrationConnections.status,
      lastSuccessAt: integrationConnections.lastSuccessAt,
      createdAt: integrationConnections.createdAt,
    })
    .from(integrationConnections)
    .orderBy(desc(integrationConnections.createdAt), desc(integrationConnections.id));
}

export async function getConnection(tx: TenantTx, id: string) {
  const [row] = await tx
    .select(detailColumns)
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return row ?? null;
}

/** Whether the endpoint set (URL, client ID, identifier system) may still change (spec "Editability"). */
export function endpointEditable(connection: {
  status: string;
  hasSynced: boolean;
  isSandbox: boolean;
}): boolean {
  return connection.status === "draft" && !connection.hasSynced && !connection.isSandbox;
}

/**
 * Configuration values recorded in audit metadata (spec "Audit events"): the normalized URL (never a
 * query string; the path is limited to unreserved characters), the client ID, and the MRN
 * identifier system — the setting the SSN/MBI refusal protects (compliance review #6b).
 */
function endpointMetadata(
  prefix: "" | "old_",
  values: { baseUrl: string; clientId: string; mrnIdentifierSystem: string },
) {
  return {
    [`${prefix}base_url`]: values.baseUrl,
    [`${prefix}client_id`]: values.clientId,
    [`${prefix}mrn_identifier_system`]: values.mrnIdentifierSystem,
  };
}

/**
 * A URL as recorded in audit metadata: scheme, host, and path only (never a query string, fragment,
 * or credentials), like the endpoint values `endpointMetadata` records. Null when there is none or
 * it isn't a URL (an issuer needn't be one), so nothing unparsed is copied into the log.
 */
export function normalizedUrlForAudit(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 512);
  } catch {
    return null;
  }
}

/**
 * Inserts a draft connection. The app role holds INSERT on a fixed column list only (drizzle/0039:
 * approval, key, and sync columns stay out of its reach), and Drizzle's `.insert()` names every
 * column (unset ones as DEFAULT), which PostgreSQL checks against the grant — so this is raw SQL
 * naming exactly the granted columns (same approach as `requestUniversityAccess`).
 */
async function insertDraft(
  tx: TenantTx,
  actor: IntegrationActor,
  values: Omit<EndpointInput, "endpointKey"> & { endpointKey: string; isSandbox: boolean },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    insert into integration_connections
      (tenant_id, target_table, kind, is_sandbox, display_name, base_url, endpoint_key, client_id,
       mrn_identifier_system, created_by, updated_by)
    values (${actor.tenantId}::uuid, 'patients', 'fhir_r4', ${values.isSandbox}, ${values.displayName},
       ${values.baseUrl}, ${values.endpointKey}, ${values.clientId}, ${values.mrnIdentifierSystem},
       ${actor.userId}::uuid, ${actor.userId}::uuid)
    returning id
  `);
  return result.rows[0]!.id;
}

/** New draft connection to a real EHR/PM endpoint (spec PI1b). */
export async function createConnection(
  tx: TenantTx,
  actor: IntegrationActor,
  raw: unknown,
  t: IntegrationsT = englishT,
): Promise<{ id: string }> {
  assertAdmin(actor, t);
  const input = parseEndpointInput(raw, actor.syntheticOnly, t);
  const id = await insertDraft(tx, actor, { ...input, isSandbox: false });
  await audit(tx, {
    action: "integration.connection_created",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    metadata: { target_table: "patients", sandbox: false, ...endpointMetadata("", input) },
  });
  return { id };
}

/**
 * New draft connection to the built-in synthetic sandbox (spec "Synthetic sandbox"). Its endpoint is
 * fixed (the database CHECK pins it), so only the name comes from the client. Refused in production.
 */
export async function createSandboxConnection(
  tx: TenantTx,
  actor: IntegrationActor,
  raw: unknown,
  t: IntegrationsT = englishT,
): Promise<{ id: string }> {
  assertAdmin(actor, t);
  if (!actor.syntheticOnly) fail(t, "error.sandboxRefused");
  const input = parseOrFail(sandboxInputSchema, raw, t);
  const displayName = checkDisplayName(input.displayName, t);
  const id = await insertDraft(tx, actor, {
    displayName,
    baseUrl: SANDBOX_BASE_URL,
    endpointKey: SANDBOX_BASE_URL,
    clientId: SANDBOX_CLIENT_ID,
    mrnIdentifierSystem: SANDBOX_MRN_SYSTEM,
    isSandbox: true,
  });
  await audit(tx, {
    action: "integration.connection_created",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    metadata: { target_table: "patients", sandbox: true },
  });
  return { id };
}

/** The first endpoint field the form sent with a value different from the stored one, if any. */
function lockedFieldChanged(
  input: { baseUrl?: string; clientId?: string; mrnIdentifierSystem?: string },
  current: { baseUrl: string; clientId: string; mrnIdentifierSystem: string },
): ConnectionField | null {
  if (input.baseUrl !== undefined) {
    const url = checkBaseUrl(input.baseUrl);
    const sent = url.ok ? url.baseUrl : input.baseUrl.trim();
    if (sent !== current.baseUrl) return "baseUrl";
  }
  if (input.clientId !== undefined && input.clientId.trim() !== current.clientId) return "clientId";
  if (
    input.mrnIdentifierSystem !== undefined &&
    input.mrnIdentifierSystem.trim() !== current.mrnIdentifierSystem
  ) {
    return "mrnIdentifierSystem";
  }
  return null;
}

/**
 * Locks the row and checks it is still the version the administrator opened (stale-edit check).
 * `updated_at` is always written by the database clock (`now()`), never the app server's.
 */
async function lockForChange(tx: TenantTx, id: string, expectedUpdatedAt: string, t: IntegrationsT) {
  const [current] = await tx
    .select(detailColumns)
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id))
    .for("update");
  if (!current) fail(t, "error.notFound");
  if (current.status === "revoked") fail(t, "error.revoked");
  if (current.updatedAt.toISOString() !== expectedUpdatedAt) fail(t, "error.stale");
  return current;
}

/**
 * Edits a connection. The name can change in any state but revoked; the endpoint set only while
 * the connection is a draft that has never synced (and never for the sandbox, whose endpoint is
 * fixed). A locked field sent unchanged is fine; a changed one is refused.
 */
export async function updateConnection(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  raw: unknown,
  t: IntegrationsT = englishT,
): Promise<void> {
  assertAdmin(actor, t);
  const current = await lockForChange(tx, id, expectedUpdatedAt, t);
  let next: Pick<EndpointInput, "displayName"> & Partial<EndpointInput>;
  if (current.isSandbox) {
    next = { displayName: checkDisplayName(parseOrFail(sandboxInputSchema, raw, t).displayName, t) };
  } else if (endpointEditable(current)) {
    next = parseEndpointInput(raw, actor.syntheticOnly, t);
  } else {
    // Locked: only the name may change. The stored endpoint isn't re-validated against today's
    // rules (an allowed port or the refusal list may have changed since it was saved); a sent
    // endpoint field is only compared, and a change is refused on that field.
    const input = parseOrFail(lockedInputSchema, raw, t);
    const displayName = checkDisplayName(input.displayName, t);
    const changedField = lockedFieldChanged(input, current);
    if (changedField) fail(t, "error.endpointLocked", changedField);
    next = { displayName };
  }
  const changed = (Object.keys(next) as (keyof EndpointInput)[]).filter(
    (key) => key !== "endpointKey" && next[key] !== current[key as keyof typeof current],
  );
  if (changed.length === 0) return;
  // What Test connection pinned (token endpoint, its key, issuer) and any residency attestation
  // belong to the endpoint and client that were tested: a new base URL or client ID starts over.
  const startsOver = changed.includes("baseUrl") || changed.includes("clientId");
  await tx
    .update(integrationConnections)
    .set({
      ...next,
      ...(startsOver
        ? {
            tokenEndpoint: null,
            tokenEndpointKey: null,
            issuer: null,
            usResidencyAttestedBy: null,
            usResidencyAttestedAt: null,
          }
        : {}),
      updatedBy: actor.userId,
      updatedAt: sql`now()`,
    })
    .where(eq(integrationConnections.id, id));
  const endpointFieldsChanged = changed.some((key) => key !== "displayName");
  await audit(tx, {
    action: "integration.connection_updated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    metadata: {
      fields: changed.join(","),
      ...(startsOver ? { discovery_cleared: true } : {}),
      ...(endpointFieldsChanged
        ? {
            ...endpointMetadata("old_", current),
            ...endpointMetadata("", {
              baseUrl: next.baseUrl!,
              clientId: next.clientId!,
              mrnIdentifierSystem: next.mrnIdentifierSystem!,
            }),
          }
        : {}),
    },
  });
}

/** What a lifecycle UPDATE changes: only granted columns (status, status_reason, revoked_*, updated_*). */
interface StatusChange {
  status: ConnectionStatus;
  /** Set (or cleared with null) together with the status; left alone when undefined. */
  statusReason?: string | null;
  /** Stamps who revoked and when (the CHECKs require both for `revoked`). */
  revoked?: boolean;
}

async function writeStatus(tx: TenantTx, actor: IntegrationActor, id: string, change: StatusChange) {
  await tx
    .update(integrationConnections)
    .set({
      status: change.status,
      ...(change.statusReason !== undefined ? { statusReason: change.statusReason } : {}),
      ...(change.revoked ? { revokedBy: actor.userId, revokedAt: sql`now()` } : {}),
      updatedBy: actor.userId,
      updatedAt: sql`now()`,
    })
    .where(eq(integrationConnections.id, id));
}

/**
 * Releases the registry entry through the SECURITY DEFINER function, which itself refuses unless the
 * connection is already draft or revoked and belongs to the caller's practice. A sandbox is never
 * registered. Returns whether an entry was released.
 */
async function releaseRegistry(tx: TenantTx, id: string, isSandbox: boolean): Promise<boolean> {
  if (isSandbox) return false;
  const released = await tx.execute<{ released: boolean }>(
    sql`select integration_registry_release(${id}::uuid) as released`,
  );
  return released.rows[0]?.released === true;
}

/**
 * Revokes a connection (spec "Connection lifecycle"): terminal, from any state, with a reason code
 * from a fixed vocabulary (compliance review #6a) that becomes the audit event's "why" and the
 * connection's `status_reason`. Releases its registry entry (the database function only releases
 * after this transition). No environment check and no step-up, on purpose: revoking is the safe
 * direction and the emergency stop (a suspected key compromise), so it has to work in any
 * environment and without a fresh code at hand. Signing keys arrive with PI2a; destroying them
 * joins this step then.
 */
export async function revokeConnection(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  reasonCode: unknown,
  t: IntegrationsT = englishT,
): Promise<void> {
  assertAdmin(actor, t);
  if (!isRevokeReasonCode(reasonCode)) fail(t, "error.revokeReasonRequired", "reason");
  const current = await lockForChange(tx, id, expectedUpdatedAt, t);
  await writeStatus(tx, actor, id, { status: "revoked", statusReason: reasonCode, revoked: true });
  const registryReleased = await releaseRegistry(tx, id, current.isSandbox);
  await audit(tx, {
    action: "integration.connection_revoked",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    reason: reasonCode,
    metadata: {
      reason_code: reasonCode,
      previous_status: current.status,
      previous_status_reason: current.statusReason,
      sandbox: current.isSandbox,
      registry_released: registryReleased,
      ...(current.isSandbox ? {} : endpointMetadata("", current)),
    },
  });
}

/** Locks the row for a lifecycle change and checks the states it may leave and the environment rule. */
async function lockForTransition(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  from: readonly ConnectionStatus[],
  t: IntegrationsT,
) {
  assertAdmin(actor, t);
  const current = await lockForChange(tx, id, expectedUpdatedAt, t);
  if (!from.includes(current.status)) fail(t, "error.invalidTransition");
  assertEnvironmentAllows(current.isSandbox, actor, t);
  return current;
}

/** Pause (`active` → `paused`): sync stops until an administrator resumes it. */
export async function pauseConnection(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  t: IntegrationsT = englishT,
): Promise<void> {
  const current = await lockForTransition(tx, actor, id, expectedUpdatedAt, ["active"], t);
  await writeStatus(tx, actor, id, { status: "paused" });
  await audit(tx, {
    action: "integration.connection_paused",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    metadata: { previous_status: current.status, sandbox: current.isSandbox },
  });
}

/**
 * What the two transitions that need a passing Test connection (Submit, and Resume from `error`)
 * need to find the live signing key: the store (the `kid` a pass is bound to comes from it) and,
 * for tests, the clock. Same shape as the Test connection deps, so the actions pass the same object.
 */
export interface SigningDeps {
  keyStore(): SigningKeyStore;
  now?: () => Date;
}

/**
 * The live signing key's `kid`, resolved **before** any transaction or row lock is opened and from
 * public material only (`SigningKeyStore.kid`, never a signer). `kid` is null, with the translated
 * reason, when no key is usable. The pass-binding comparison under the lock still catches a rotation
 * that happens between this call and the transaction: the recorded pass carries the old `kid`.
 */
export interface ResolvedSigningKid {
  kid: string | null;
  /** Why there is no `kid`: a message key, never key detail. */
  refusal: IntegrationsKey | null;
  now?: () => Date;
}

/** Resolves the key in use for a connection; a store that can't say is a refusal, not an error. */
export async function resolveSigningKid(deps: SigningDeps, id: string): Promise<ResolvedSigningKid> {
  try {
    return { kid: await deps.keyStore().kid(id), refusal: null, now: deps.now };
  } catch (error) {
    if (error instanceof SigningKeyStoreError) {
      return {
        kid: null,
        refusal:
          error.code === "not_configured" ? "test.error.keyNotConfigured" : "test.error.keyUnavailable",
        now: deps.now,
      };
    }
    throw error;
  }
}

/**
 * Whether a passing Test connection is on record right now (the Submit panel's enabled state). The
 * same check Submit itself makes under the row lock, so the page and the action agree; no usable
 * key means no pass can count, so it is `false` rather than an error.
 */
export async function hasPassingTestNow(
  tx: TenantTx,
  tenantId: string,
  id: string,
  signing: ResolvedSigningKid,
): Promise<boolean> {
  if (!signing.kid) return false;
  return hasRecentPassingTest(tx, tenantId, id, signing.kid, signing.now?.());
}

/**
 * Why the Submit panel shows a disabled button instead of an enabled one, as a message key, or null
 * when nothing known now would make the server refuse (the step-up and the attestation are asked for
 * in the panel itself). The same rules Submit applies, in the same order: the environment, another
 * live connection, a usable signing key, a passing test.
 */
export async function submitBlockedReason(
  tx: TenantTx,
  actor: Pick<IntegrationActor, "tenantId" | "syntheticOnly">,
  connection: { id: string; targetTable: string; isSandbox: boolean },
  signing: ResolvedSigningKid,
): Promise<IntegrationsKey | null> {
  const environment = environmentRefusalKey(connection.isSandbox, actor);
  if (environment) return environment;
  if (await hasAnotherLiveConnection(tx, actor.tenantId, connection.targetTable, connection.id)) {
    return "error.anotherConnectionLive";
  }
  // No usable signing key: Submit refuses with the key's own reason (`requirePassingTest`), not with
  // "no passing test", which would send the administrator to a Test connection that can't pass.
  if (!signing.kid) return signing.refusal ?? "test.error.keyUnavailable";
  if (!(await hasPassingTestNow(tx, actor.tenantId, connection.id, signing))) {
    return connection.isSandbox ? "submit.blocked.sandbox" : "submit.blocked.noPassingTest";
  }
  return null;
}

/**
 * The gate shared by Submit and Resume from `error`: a passing Test connection in the last 24 h,
 * for this configuration and the live signing key (`hasRecentPassingTest`). Called under the row
 * lock, in the transaction that then changes the status, so a concurrent test can't land between
 * the check and the move. `afterLastChange` (Resume) also requires the pass to be newer than the
 * connection's last change. Returns the `kid` the pass was checked against, for the audit record.
 */
async function requirePassingTest(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  signing: ResolvedSigningKid | undefined,
  refusal: IntegrationsKey,
  t: IntegrationsT,
  afterLastChange = false,
): Promise<string> {
  // No way to identify the key means no pass can be verified: fail closed.
  if (!signing) fail(t, refusal);
  if (!signing.kid) fail(t, signing.refusal ?? "test.error.keyUnavailable");
  const passed = await hasRecentPassingTest(tx, actor.tenantId, id, signing.kid, signing.now?.(), {
    afterLastChange,
  });
  if (!passed) fail(t, refusal);
  return signing.kid;
}

/**
 * Resume (`paused` or `error` → `active`), gated by a step-up (R-7.2.2): restarting the sync of a
 * practice's patients deserves a fresh proof of the authenticator. Clears the reason a connection
 * went to `error` with, since it is no longer in that state.
 *
 * Resume from `error` also needs a passing Test connection (spec PI2a): the error usually means the
 * endpoint, the key, or the registration changed, and resuming blindly restarts the failure. Resume
 * from `paused` doesn't: nothing is known to be wrong. The pass must be **newer than the move into
 * `error`** (the connection's `updated_at`), so one recorded while it was still `active` can't clear
 * the error. `signing` is the live key's `kid`, resolved by the caller before this transaction
 * (`resolveSigningKid`); without it an `error` connection can't be resumed (fail closed).
 */
export async function resumeConnection(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  t: IntegrationsT = englishT,
  signing?: ResolvedSigningKid,
): Promise<void> {
  const current = await lockForTransition(tx, actor, id, expectedUpdatedAt, ["paused", "error"], t);
  requireStepUp(actor, t);
  const testKid =
    current.status === "error"
      ? await requirePassingTest(tx, actor, id, signing, "error.testRequiredToResume", t, true)
      : null;
  await writeStatus(tx, actor, id, { status: "active", statusReason: null });
  await audit(tx, {
    action: "integration.connection_resumed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    metadata: {
      previous_status: current.status,
      previous_status_reason: current.statusReason,
      sandbox: current.isSandbox,
      step_up_verified_at: actor.stepUpVerifiedAt ?? null,
      ...(testKid ? { test_kid: testKid } : {}),
    },
  });
}

/**
 * Version of the U.S.-residency attestation wording an administrator agrees to on Submit. The text
 * itself is the message `submit.attestation` (English is canonical: "This EHR/PM endpoint stores and
 * processes data only in the United States"; Spanish and Portuguese are translations of it). There is
 * no column for it, so the audit record carries the version and the language shown. Change the
 * wording, bump this number; a unit test pins the English text to it.
 */
export const US_RESIDENCY_ATTESTATION_VERSION = 1;

export interface SubmitInput {
  /** The attestation checkbox, as the server read it. Only `true` counts; a real connection needs it. */
  attested: boolean;
  /**
   * The language the attestation was shown in (the form carries it; the action refuses a form whose
   * language no longer matches the request's). Recorded with the attestation, with a hash of the
   * exact text in that language.
   */
  locale: Locale;
}

/** SHA-256 (hex) of the attestation text exactly as shown in `locale`, recorded in the audit event. */
export function attestationTextSha256(locale: Locale): string {
  return createHash("sha256").update(messages[locale].integrations["submit.attestation"]).digest("hex");
}

/** A refused registry claim: carries what the audit event records, so the caller can write it after the rollback. */
class RegistryConflictError extends IntegrationConnectionError {
  constructor(
    message: string,
    readonly endpoint: { baseUrl: string; clientId: string; mrnIdentifierSystem: string },
  ) {
    super(message);
    this.name = "RegistryConflictError";
  }
}

/**
 * A light per-practice limit on Submit attempts (bucket `integration_submit`, alongside the Test
 * connection buckets): every attempt counts, so Submit can't be used to probe the endpoint registry
 * faster than Test connection can be used to probe hosts. A refusal is audited (`security.rate_limited`,
 * IDs and the bucket only) in its own transaction, since nothing else is written.
 */
async function enforceSubmitRateLimit(
  run: TxRunner,
  actor: IntegrationActor,
  id: string,
  now: Date | undefined,
  t: IntegrationsT,
) {
  const result = await hit("integration_submit", `practice:${actor.tenantId}`, now);
  if (result.allowed) return;
  await run((tx) =>
    audit(tx, {
      action: "security.rate_limited",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "integration_connection",
      entityId: id,
      reason: "connection_submit",
      metadata: { bucket: "integration_submit" },
    }),
  );
  fail(t, "error.submitRateLimited");
}

/**
 * Submit (spec PI2a; `draft` → `pending_approval` for a real connection, → `active` for the built-in
 * sandbox). Administrator only. Before the transaction: the rate limit, and the live signing key's
 * `kid` from public material (never under the lock). Then, in one transaction:
 *
 * 1. lock the row `FOR UPDATE`, refuse another practice's (not found), a stale page, a status other
 *    than `draft`, and the wrong environment;
 * 2. `requireStepUp` (R-7.2.2);
 * 3. a passing Test connection in the last 24 h for this configuration and the live signing key
 *    (`hasRecentPassingTest`), for the sandbox too: the spec exempts only the attestation from it;
 * 4. real only: the U.S.-residency attestation (§ 408.051(3); stricter: U.S. only);
 * 5. one UPDATE writes the status **and** both fresh stamps (`submitted_*`, `us_residency_attested_*`);
 *    the 0042 trigger refuses a Submit whose stamps are carried over from an earlier one;
 * 6. real only: claim the endpoint registry (SECURITY DEFINER `integration_registry_claim`, which
 *    itself requires the row to be `pending_approval`, hence after the UPDATE). A conflict, another
 *    practice holding this endpoint and client ID, rolls everything back and is refused without
 *    naming anyone; `integration.registry_conflict` is audited in a second transaction, since the
 *    first one's audit would roll back with it.
 *
 * Audited `integration.connection_submitted` (configuration only, never patient information).
 * Takes a `run` rather than a transaction for that reason, like Test connection.
 */
export async function submitConnection(
  run: TxRunner,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  input: SubmitInput,
  signing: SigningDeps,
  t: IntegrationsT = englishT,
): Promise<{ status: "pending_approval" | "active" }> {
  assertAdmin(actor, t);
  // A language the app doesn't have can't have been shown the attestation.
  if (!isLocale(input.locale)) fail(t, "error.localeChanged");
  const locale = input.locale;
  await enforceSubmitRateLimit(run, actor, id, signing.now?.(), t);
  // The key in use, from public material, before any transaction or lock (a key that changes in
  // between is caught by the pass binding under the lock).
  const resolved = await resolveSigningKid(signing, id);
  try {
    return await run(async (tx) => {
      const current = await lockForTransition(tx, actor, id, expectedUpdatedAt, ["draft"], t);
      // One connection outside draft/revoked per practice and table: refuse in words here (the
      // unique index is the backstop, and is mapped to the same refusal below for a race).
      if (await hasAnotherLiveConnection(tx, actor.tenantId, current.targetTable, id)) {
        fail(t, "error.anotherConnectionLive");
      }
      requireStepUp(actor, t);
      const testKid = await requirePassingTest(tx, actor, id, resolved, "error.testRequired", t);
      const sandbox = current.isSandbox;
      if (!sandbox && input.attested !== true) fail(t, "error.attestationRequired", "attestation");
      const next = sandbox ? "active" : "pending_approval";

      // The stamps are the database's clock (`now()`), in the same statement as the status change.
      await tx
        .update(integrationConnections)
        .set({
          status: next,
          statusReason: null,
          submittedBy: actor.userId,
          submittedAt: sql`now()`,
          ...(sandbox ? {} : { usResidencyAttestedBy: actor.userId, usResidencyAttestedAt: sql`now()` }),
          updatedBy: actor.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(integrationConnections.id, id));

      if (!sandbox) {
        const claim = await tx.execute<{ claimed: boolean }>(
          sql`select integration_registry_claim(${id}::uuid) as claimed`,
        );
        // The function also returns false for a connection it can't find in this practice, one that
        // isn't `pending_approval`, and one with no pinned token endpoint key. Every one of those is
        // unreachable here: the row is locked and ours, the UPDATE above just made it
        // `pending_approval`, and the passing-test gate above requires a pinned token endpoint key.
        // That is the only reason a false is reported as a conflict (another practice's claim) and
        // not as an unknown failure; if a check above is ever relaxed, revisit this.
        if (claim.rows[0]?.claimed !== true) {
          throw new RegistryConflictError(t("error.registryConflict"), current);
        }
      }

      await audit(tx, {
        action: "integration.connection_submitted",
        actorUserId: actor.userId,
        tenantId: actor.tenantId,
        entityType: "integration_connection",
        entityId: id,
        reason: "connection_submit",
        metadata: {
          previous_status: current.status,
          status: next,
          sandbox,
          step_up_verified_at: actor.stepUpVerifiedAt ?? null,
          test_kid: testKid,
          ...(sandbox
            ? {}
            : {
                ...endpointMetadata("", current),
                token_endpoint: normalizedUrlForAudit(current.tokenEndpoint),
                issuer: normalizedUrlForAudit(current.issuer),
                registry_claimed: true,
                us_residency_attested: true,
                attestation_version: US_RESIDENCY_ATTESTATION_VERSION,
                attestation_locale: locale,
                attestation_text_sha256: attestationTextSha256(locale),
              }),
        },
      });
      return { status: next };
    });
  } catch (error) {
    // Two drafts racing to leave `draft` in one practice: the loser hits the unique index.
    if (
      isUniqueViolation(error) &&
      (error as DatabaseError).constraint === "integration_connections_one_active"
    ) {
      throw new IntegrationConnectionError(t("error.anotherConnectionLive"));
    }
    if (error instanceof RegistryConflictError) {
      // The submission was rolled back with its transaction; this records that it was tried. If the
      // record can't be written the administrator must still see the conflict, not a database error:
      // log the failure (IDs only) and rethrow the conflict either way.
      try {
        await run((tx) =>
          audit(tx, {
            action: "integration.registry_conflict",
            actorUserId: actor.userId,
            tenantId: actor.tenantId,
            entityType: "integration_connection",
            entityId: id,
            reason: "connection_submit",
            metadata: { sandbox: false, ...endpointMetadata("", error.endpoint) },
          }),
        );
      } catch {
        log.error("integration.registry_conflict_audit_failed", {
          tenantId: actor.tenantId,
          connectionId: id,
        });
      }
    }
    throw error;
  }
}

/**
 * Withdraw (`pending_approval` → `draft`): the administrator takes a submitted connection back
 * before the operator approves it, releasing its registry claim so it can be corrected and
 * submitted again. The endpoint set is editable again afterwards (a draft that never synced), so
 * everything that belonged to the old submission is cleared too: the U.S.-residency attestation (a
 * different endpoint must be attested afresh, and Submit refuses a stale one, drizzle/0042) and the
 * token endpoint, its registry key, and the issuer that discovery recorded for the old endpoint
 * (the next Test connection finds them again). The submission stamp
 * (`submitted_by/_at`) stays as the record that it was submitted once; the page shows it only
 * while the connection is not a draft.
 */
export async function withdrawConnection(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  t: IntegrationsT = englishT,
): Promise<void> {
  const current = await lockForTransition(tx, actor, id, expectedUpdatedAt, ["pending_approval"], t);
  // What is about to be cleared, for the audit record (the row is locked, so this is what is cleared).
  const [previous] = await tx
    .select({
      attestedBy: integrationConnections.usResidencyAttestedBy,
      attestedAt: integrationConnections.usResidencyAttestedAt,
      tokenEndpoint: integrationConnections.tokenEndpoint,
      issuer: integrationConnections.issuer,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  await writeStatus(tx, actor, id, { status: "draft" });
  // After the status change: the database function refuses to release while still pending.
  const registryReleased = await releaseRegistry(tx, id, current.isSandbox);
  // A separate statement, and only now: the lifecycle trigger refuses to change the attestation or
  // the discovered endpoint fields in the statement that leaves pending_approval, and allows it
  // once the row is a draft. All of these columns are in the app role's UPDATE grant (0039).
  await tx
    .update(integrationConnections)
    .set({
      usResidencyAttestedBy: null,
      usResidencyAttestedAt: null,
      tokenEndpoint: null,
      tokenEndpointKey: null,
      issuer: null,
      updatedBy: actor.userId,
      updatedAt: sql`now()`,
    })
    .where(eq(integrationConnections.id, id));
  await audit(tx, {
    action: "integration.connection_withdrawn",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    metadata: {
      previous_status: current.status,
      registry_released: registryReleased,
      attestation_cleared: true,
      discovery_cleared: true,
      previous_attested_by: previous?.attestedBy ?? null,
      previous_attested_at: previous?.attestedAt?.toISOString() ?? null,
      previous_token_endpoint: normalizedUrlForAudit(previous?.tokenEndpoint),
      previous_issuer: normalizedUrlForAudit(previous?.issuer),
      ...endpointMetadata("", current),
    },
  });
}

export type SyncRunStatus = (typeof integrationSyncRunStatusEnum.enumValues)[number];

/**
 * What the tab-bar data-source drop-down shows (specs/erp-shell.md "Data-source drop-down"). Dates
 * are ISO strings: this crosses to the browser. Configuration only — never PHI or patient counts.
 */
export interface DataSourceSummary {
  /** Null when sent to a role that can't open the connection page (the layout strips it). */
  connectionId: string | null;
  displayName: string;
  status: ConnectionStatus;
  lastSuccessAt: string | null;
  /** The latest sync run's status, if any run exists. */
  lastRunStatus: SyncRunStatus | null;
}

/**
 * The connection that is (or was) the table's source, in one indexed query: the live one if any
 * (at most one outside draft/revoked, partial unique index), else the most recently revoked one that
 * had been submitted or had synced. A draft, or a draft revoked before it was ever submitted, was
 * never a source, so the table reads "Manual". Null: manual.
 */
export async function connectionSummary(tx: TenantTx, table: "patients"): Promise<DataSourceSummary | null> {
  const result = await tx.execute<{
    id: string;
    display_name: string;
    status: ConnectionStatus;
    last_success_at: string | Date | null;
    last_run_status: SyncRunStatus | null;
  }>(sql`
    select c.id, c.display_name, c.status, c.last_success_at, run.status as last_run_status
    from integration_connections c
    left join lateral (
      select r.status from integration_sync_runs r
      where r.tenant_id = c.tenant_id and r.connection_id = c.id
      order by r.queued_at desc
      limit 1
    ) run on true
    where c.target_table = ${table}
      and (c.status not in ('draft', 'revoked')
           or (c.status = 'revoked' and (c.has_synced or c.submitted_at is not null)))
    order by (c.status = 'revoked'), coalesce(c.revoked_at, c.updated_at) desc, c.id desc
    limit 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    connectionId: row.id,
    displayName: row.display_name,
    status: row.status,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastRunStatus: row.last_run_status,
  };
}
