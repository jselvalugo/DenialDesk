import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import type { Role } from "@/auth/session";
import { integrationConnectionStatusEnum, integrationConnections } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { en } from "@/i18n/messages/en";
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
import { VENDOR_SANDBOX_HOSTS } from "@/integrations/fhir/vendor-sandboxes";
import { audit } from "@/lib/audit";

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

/** A refusal with a translated message and, when it belongs to one, the form field it concerns. */
export class IntegrationConnectionError extends Error {
  constructor(
    message: string,
    readonly field?: ConnectionField,
  ) {
    super(message);
    this.name = "IntegrationConnectionError";
  }
}

export type ConnectionField = "displayName" | "baseUrl" | "clientId" | "mrnIdentifierSystem";

export interface IntegrationActor {
  tenantId: string;
  userId: string;
  role: Role;
  /** `syntheticDataOnly()`: real EHR endpoints are refused, only the built-in sandbox is allowed. */
  syntheticOnly: boolean;
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
  if (syntheticOnly && !VENDOR_SANDBOX_HOSTS.includes(url.host))
    fail(t, "error.realEndpointRefused", "baseUrl");
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

function assertAdmin(actor: IntegrationActor, t: IntegrationsT) {
  if (!canManageIntegrations(actor.role)) fail(t, "error.notAdmin");
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
  await tx
    .update(integrationConnections)
    .set({ ...next, updatedBy: actor.userId, updatedAt: sql`now()` })
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

/**
 * Revokes a connection (spec "Connection lifecycle"): terminal, from any state. Releases its
 * registry entry (the database function only releases after this transition). Signing keys arrive
 * with PI2a; destroying them joins this step then.
 */
export async function revokeConnection(
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  t: IntegrationsT = englishT,
): Promise<void> {
  assertAdmin(actor, t);
  const current = await lockForChange(tx, id, expectedUpdatedAt, t);
  await tx
    .update(integrationConnections)
    .set({
      status: "revoked",
      revokedBy: actor.userId,
      revokedAt: sql`now()`,
      updatedBy: actor.userId,
      updatedAt: sql`now()`,
    })
    .where(eq(integrationConnections.id, id));
  let registryReleased = false;
  if (!current.isSandbox) {
    const released = await tx.execute<{ released: boolean }>(
      sql`select integration_registry_release(${id}::uuid) as released`,
    );
    registryReleased = released.rows[0]?.released === true;
  }
  await audit(tx, {
    action: "integration.connection_revoked",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    metadata: {
      previous_status: current.status,
      sandbox: current.isSandbox,
      registry_released: registryReleased,
      ...(current.isSandbox ? {} : endpointMetadata("", current)),
    },
  });
}
