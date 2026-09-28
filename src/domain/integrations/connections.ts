import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { TenantTx } from "@/db/tenant";
import { integrationConnections } from "@/db/schema";
import { audit } from "@/lib/audit";
import { en } from "@/i18n/messages/en";
import type { Locale } from "@/i18n/config";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import { isRefusedMrnIdentifierSystem } from "@/integrations/fhir/identifier-rules";
import {
  SANDBOX_BASE_URL,
  SANDBOX_CLIENT_ID,
  validateBaseUrl,
  type UrlRuleError,
} from "@/integrations/fhir/url-rules";

// EHR/PM connection lifecycle (docs/specs/patient-integrations.md "PI1b"; ADR 0010). No network
// calls here (PI2a): only the draft/sandbox lifecycle the app role's column grants and
// drizzle/0039-0041's triggers allow.
//
// Status labels/tones and the revoke reason vocabulary live in `./connection-status` (no `@/db/*`
// or `@/lib/audit` import), so a client component can import them without pulling the database
// driver into the browser bundle; re-exported here so server code has one place to import from.
export {
  connectionStatusLabel,
  connectionStatusTone,
  REVOKE_REASON_CODES,
  REVOKE_REASON_LABEL_KEYS,
  type ConnectionStatus,
  type RevokeReasonCode,
} from "./connection-status";
import type { ConnectionStatus, RevokeReasonCode } from "./connection-status";

type SettingsKey = MessageKey<"settings">;
type SettingsT = Translator<Messages["settings"]>;
/** English translator used when a caller doesn't have the request's language (e.g. unit tests). */
const englishSettingsT: SettingsT = createTranslator(en.settings, "en");

export type ConnectionRow = typeof integrationConnections.$inferSelect;

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly field?: string,
    /** True when the only thing missing is a recent MFA verification (R-7.2.2): the caller should
     * offer to step up and retry, not just show the message as a plain validation error. */
    readonly stepUpRequired = false,
  ) {
    super(message);
    this.name = "ConnectionError";
  }
}

// ---------------------------------------------------------------------------------------------
// The strict client allow-list (spec "PI1b"): exactly these five fields. Status, token endpoint,
// issuer, key reference, tenant, and approval fields never come from the client.
// ---------------------------------------------------------------------------------------------

// C0/C1 controls plus the Unicode bidi/format control characters an attacker could use to make a
// connection name render misleadingly (security review PR #81, item 11).
const CONTROL_OR_FORMAT_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/;

export const connectionInputSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => !CONTROL_OR_FORMAT_CHARS.test(value)),
    baseUrl: z.string().trim().min(1).max(2048),
    clientId: z.string().trim().min(1).max(255),
    mrnIdentifierSystem: z.string().trim().min(1).max(255),
    usResidencyAttested: z.boolean(),
  })
  .strict();
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

const FIELD_ERROR_KEYS: Record<string, SettingsKey> = {
  displayName: "integrations.error.displayNameInvalid",
  baseUrl: "integrations.error.baseUrlRequired",
  clientId: "integrations.error.clientIdInvalid",
  mrnIdentifierSystem: "integrations.error.mrnSystemRequired",
  usResidencyAttested: "integrations.error.invalidField",
};

/** ZodErrors are mapped to field codes here and never logged or returned as-is (spec "PI1b"). */
export function parseConnectionInput(
  raw: unknown,
  t: SettingsT = englishSettingsT,
): { data: ConnectionInput } | { error: { message: string; field: string } } {
  const parsed = connectionInputSchema.safeParse(raw);
  if (parsed.success) return { data: parsed.data };
  const issue = parsed.error.issues[0]!;
  const field = String(issue.path[0] ?? "");
  return { error: { message: t(FIELD_ERROR_KEYS[field] ?? "integrations.error.invalidField"), field } };
}

const URL_ERROR_KEYS: Record<UrlRuleError, SettingsKey> = {
  invalid_url: "integrations.error.urlInvalid",
  not_https: "integrations.error.urlNotHttps",
  has_userinfo: "integrations.error.urlHasUserinfo",
  has_query: "integrations.error.urlHasQuery",
  has_fragment: "integrations.error.urlHasFragment",
  ip_literal: "integrations.error.urlIpLiteral",
  blocked_host: "integrations.error.urlBlockedHost",
  single_label: "integrations.error.urlSingleLabel",
  trailing_dot: "integrations.error.urlTrailingDot",
  port_not_allowed: "integrations.error.urlPortNotAllowed",
};

export interface ConnectionEnvironment {
  /** `syntheticDataOnly()` (src/lib/env.ts): only the sandbox may be created/activated here. */
  syntheticOnly: boolean;
}

interface Actor {
  tenantId: string;
  userId: string;
  /** A step-up-gated action (Submit's attestation, Resume, Revoke) needs this true (R-7.2.2). */
  recentMfa: boolean;
  /** Recorded with a fresh attestation (`usResidencyAttestationLocale`), never with a cleared one. */
  locale: Locale;
}

/** Bump when the attestation sentence's own wording changes (OA-057). */
export const ATTESTATION_TEXT_VERSION = "2026-09-28";

/**
 * Whether a submitted base URL + client ID names the built-in sandbox: the zod allow-list has no
 * separate "is this a real endpoint?" field, so this is decided from the values themselves — the
 * same identity the DB's `integration_connections_sandbox_is_builtin` CHECK pins them to.
 */
export function isSandboxRequest(input: Pick<ConnectionInput, "baseUrl" | "clientId">): boolean {
  return input.baseUrl.trim() === SANDBOX_BASE_URL && input.clientId.trim() === SANDBOX_CLIENT_ID;
}

/**
 * The environment gating matrix (spec "Environment and population rules"): a synthetic-data
 * environment (local, CI, every Netlify deploy) may only create/edit the sandbox; production off
 * Netlify may only create/edit a real endpoint. Pure, so it's unit-testable without a database.
 */
export function assertEnvironmentAllows(
  sandbox: boolean,
  env: ConnectionEnvironment,
  t: SettingsT = englishSettingsT,
): void {
  if (sandbox && !env.syntheticOnly) {
    throw new ConnectionError(t("integrations.error.sandboxRefused"), "baseUrl");
  }
  if (!sandbox && env.syntheticOnly) {
    throw new ConnectionError(t("integrations.error.realEndpointRefused"), "baseUrl");
  }
}

/** Old/new base URL and client ID only — never a query string, never a token or secret (spec: audit). */
function endpointAuditFields(prefix: "old" | "new", baseUrl: string, clientId: string) {
  return {
    [`${prefix}BaseUrl`]: baseUrl,
    [`${prefix}ClientId`]: clientId,
  } as Record<string, string>;
}

// ---------------------------------------------------------------------------------------------
// Raw-SQL writes with an explicit, granted column list (drizzle/0039's column grants). Drizzle's
// query builder names every column that has a schema-level `.default(...)` — including ones never
// passed to `.values()`/`.set()` — and PostgreSQL then requires the app role's privilege on each
// of those too; the app role only has it on the columns below. Same pattern as
// `requestUniversityAccess` (src/domain/university/access.ts).
// ---------------------------------------------------------------------------------------------

interface NewConnectionRow {
  tenantId: string;
  isSandbox: boolean;
  displayName: string;
  baseUrl: string;
  endpointKey: string;
  clientId: string;
  mrnIdentifierSystem: string;
  userId: string;
}

async function insertConnectionRow(tx: TenantTx, row: NewConnectionRow): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    insert into integration_connections
      (tenant_id, target_table, kind, is_sandbox, display_name, base_url, endpoint_key, client_id,
       mrn_identifier_system, created_by, updated_by)
    values (
      ${row.tenantId}::uuid, 'patients', 'fhir_r4', ${row.isSandbox}, ${row.displayName}, ${row.baseUrl},
      ${row.endpointKey}, ${row.clientId}, ${row.mrnIdentifierSystem}, ${row.userId}::uuid, ${row.userId}::uuid
    )
    returning id
  `);
  return result.rows[0]!.id;
}

type ConnectionSetValue = string | boolean | Date | null;

/**
 * Exactly the columns drizzle/0039/0042's `GRANT UPDATE (...)` names for `denialdesk_app` — the
 * only ones this raw SQL is ever allowed to set. A column left out of this union is a compile-time
 * error here rather than a runtime permission failure from Postgres (security/correctness review
 * PR #81, item 20): the union is the type-level mirror of the grant list, kept in the same order.
 */
type GrantedConnectionColumn =
  | "display_name"
  | "base_url"
  | "endpoint_key"
  | "token_endpoint"
  | "token_endpoint_key"
  | "issuer"
  | "client_id"
  | "mrn_identifier_system"
  | "us_residency_attested_by"
  | "us_residency_attested_at"
  | "us_residency_attestation_version"
  | "us_residency_attestation_locale"
  | "status"
  | "status_reason"
  | "submitted_by"
  | "submitted_at"
  | "revoked_by"
  | "revoked_at"
  | "has_synced"
  | "patient_watermark"
  | "coverage_watermark"
  | "last_success_at"
  | "bulk_group_id"
  | "updated_by"
  | "updated_at";

function setClause(fields: Partial<Record<GrantedConnectionColumn, ConnectionSetValue>>) {
  return sql.join(
    Object.entries(fields).map(([column, value]) => sql`${sql.raw(column)} = ${value}`),
    sql`, `,
  );
}

/** Every write below always touches `updated_by`/`updated_at`; callers pass only what else changed. */
async function updateConnectionRow(
  tx: TenantTx,
  connectionId: string,
  actorUserId: string,
  fields: Partial<Record<GrantedConnectionColumn, ConnectionSetValue>>,
): Promise<void> {
  const set = setClause({ ...fields, updated_by: actorUserId, updated_at: new Date() });
  await tx.execute(sql`update integration_connections set ${set} where id = ${connectionId}::uuid`);
}

/**
 * Creates a draft connection. A real (non-sandbox) endpoint needs the environment to allow real
 * endpoints, a checked residency attestation, and a step-up-fresh MFA verification (the
 * attestation is audited here, as part of `connection_created`); the sandbox needs none of these
 * but is refused outside a synthetic-data environment (spec "Environment and population rules").
 */
export async function createConnection(
  tx: TenantTx,
  actor: Actor,
  input: ConnectionInput,
  env: ConnectionEnvironment,
  allowedPortsRaw: string | undefined,
  t: SettingsT = englishSettingsT,
): Promise<{ id: string; isSandbox: boolean }> {
  const sandbox = isSandboxRequest(input);
  assertEnvironmentAllows(sandbox, env, t);

  let baseUrl = SANDBOX_BASE_URL;
  let endpointKey = SANDBOX_BASE_URL;
  let clientId = SANDBOX_CLIENT_ID;
  if (!sandbox) {
    const validated = validateBaseUrl(input.baseUrl, allowedPortsRaw);
    if (!validated.ok) throw new ConnectionError(t(URL_ERROR_KEYS[validated.error]), "baseUrl");
    baseUrl = validated.normalized;
    endpointKey = validated.endpointKey;
    clientId = input.clientId.trim();
  }

  if (isRefusedMrnIdentifierSystem(input.mrnIdentifierSystem)) {
    throw new ConnectionError(t("integrations.error.mrnSystemRefused"), "mrnIdentifierSystem");
  }

  if (!sandbox) {
    if (!input.usResidencyAttested) {
      throw new ConnectionError(t("integrations.error.attestationRequired"), "usResidencyAttested");
    }
    if (!actor.recentMfa) {
      throw new ConnectionError(t("integrations.error.stepUpRequired"), undefined, true);
    }
  }

  const id = await insertConnectionRow(tx, {
    tenantId: actor.tenantId,
    isSandbox: sandbox,
    displayName: input.displayName,
    baseUrl,
    endpointKey,
    clientId,
    mrnIdentifierSystem: input.mrnIdentifierSystem.trim(),
    userId: actor.userId,
  });

  // The attestation columns aren't in the app role's INSERT grant (0039): recorded as a follow-up
  // UPDATE in the same transaction.
  if (!sandbox) {
    await updateConnectionRow(tx, id, actor.userId, {
      us_residency_attested_by: actor.userId,
      us_residency_attested_at: new Date(),
      us_residency_attestation_version: ATTESTATION_TEXT_VERSION,
      us_residency_attestation_locale: actor.locale,
    });
  }

  await audit(tx, {
    action: "integration.connection_created",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: id,
    metadata: { isSandbox: sandbox, attested: !sandbox, ...endpointAuditFields("new", baseUrl, clientId) },
  });

  return { id, isSandbox: sandbox };
}

async function lockConnection(tx: TenantTx, connectionId: string): Promise<ConnectionRow | null> {
  const [row] = await tx
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, connectionId))
    .for("update")
    .limit(1);
  return row ?? null;
}

/**
 * True when another Patients connection for this tenant is already live (outside draft/revoked).
 * The DB's own partial unique index (`integration_connections_one_active`, drizzle/0039) is the
 * real backstop — a race between two concurrent activations still ends in a unique-violation the
 * action layer maps to a friendly message (`failure()`, settings/integrations/actions.ts) — but
 * checking here first turns the common case into a clear, specific error instead (security review
 * PR #81, item 4).
 */
async function anotherLiveConnectionExists(tx: TenantTx, connectionId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.targetTable, "patients"),
        ne(integrationConnections.id, connectionId),
        sql`status not in ('draft', 'revoked')`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Edits a connection. Display name always changes (spec "Editability"); the endpoint set (base
 * URL, client ID, MRN identifier system) only while still draft — enforced here first (a clear
 * error) and again by the DB trigger (defense in depth). The connection's sandbox/real identity
 * can't change (matches `is_sandbox cannot change`, drizzle/0039).
 *
 * The residency attestation is cleared (never silently kept) whenever the endpoint changes or the
 * box is unticked, unless the admin re-attests in this same request with a recent step-up
 * (security/compliance review PR #81, item 5): an attestation is about a specific endpoint, so a
 * different one — or withdrawing consent — must not leave a stale "attested" mark on file.
 */
export async function updateConnection(
  tx: TenantTx,
  actor: Actor,
  connectionId: string,
  input: ConnectionInput,
  env: ConnectionEnvironment,
  allowedPortsRaw: string | undefined,
  t: SettingsT = englishSettingsT,
): Promise<void> {
  const current = await lockConnection(tx, connectionId);
  if (!current) throw new ConnectionError(t("integrations.error.notFound"));
  if (current.status === "revoked") throw new ConnectionError(t("integrations.error.editLockedNotDraft"));

  const sandbox = isSandboxRequest(input);
  if (sandbox !== current.isSandbox) {
    throw new ConnectionError(t("integrations.error.cannotChangeConnectionType"), "baseUrl");
  }
  assertEnvironmentAllows(sandbox, env, t);

  const draft = current.status === "draft";
  let baseUrl = current.baseUrl;
  let endpointKey = current.endpointKey;
  let clientId = current.clientId;
  let mrnIdentifierSystem = current.mrnIdentifierSystem;

  if (draft) {
    if (!sandbox) {
      const validated = validateBaseUrl(input.baseUrl, allowedPortsRaw);
      if (!validated.ok) throw new ConnectionError(t(URL_ERROR_KEYS[validated.error]), "baseUrl");
      baseUrl = validated.normalized;
      endpointKey = validated.endpointKey;
      clientId = input.clientId.trim();
    }
    if (isRefusedMrnIdentifierSystem(input.mrnIdentifierSystem)) {
      throw new ConnectionError(t("integrations.error.mrnSystemRefused"), "mrnIdentifierSystem");
    }
    mrnIdentifierSystem = input.mrnIdentifierSystem.trim();
  } else {
    // Outside draft, only the display name may change (spec "Editability"); the DB trigger locks
    // the rest regardless, but this gives a clearer, field-specific error first.
    const endpointUnchanged =
      input.baseUrl.trim() === current.baseUrl &&
      input.clientId.trim() === current.clientId &&
      input.mrnIdentifierSystem.trim() === current.mrnIdentifierSystem;
    if (!endpointUnchanged) {
      throw new ConnectionError(t("integrations.error.editLockedNotDraft"), "baseUrl");
    }
  }

  const endpointChanged =
    baseUrl !== current.baseUrl || endpointKey !== current.endpointKey || clientId !== current.clientId;

  let attestationChange: "none" | "set" | "clear" = "none";
  if (!sandbox) {
    const wantsAttested = input.usResidencyAttested;
    const currentlyAttested = current.usResidencyAttestedAt !== null;
    if (endpointChanged) {
      attestationChange = wantsAttested ? "set" : "clear";
    } else if (wantsAttested && !currentlyAttested) {
      attestationChange = "set";
    } else if (!wantsAttested && currentlyAttested) {
      attestationChange = "clear";
    }
  }
  if (attestationChange === "set" && !actor.recentMfa) {
    throw new ConnectionError(t("integrations.error.stepUpRequired"), undefined, true);
  }

  await updateConnectionRow(tx, connectionId, actor.userId, {
    display_name: input.displayName,
    ...(draft
      ? {
          base_url: baseUrl,
          endpoint_key: endpointKey,
          client_id: clientId,
          mrn_identifier_system: mrnIdentifierSystem,
        }
      : {}),
    ...(attestationChange === "set"
      ? {
          us_residency_attested_by: actor.userId,
          us_residency_attested_at: new Date(),
          us_residency_attestation_version: ATTESTATION_TEXT_VERSION,
          us_residency_attestation_locale: actor.locale,
        }
      : {}),
    ...(attestationChange === "clear"
      ? {
          us_residency_attested_by: null,
          us_residency_attested_at: null,
          us_residency_attestation_version: null,
          us_residency_attestation_locale: null,
        }
      : {}),
  });

  await audit(tx, {
    action: "integration.connection_updated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: connectionId,
    metadata: {
      ...endpointAuditFields("old", current.baseUrl, current.clientId),
      ...endpointAuditFields("new", baseUrl, clientId),
      attested: attestationChange === "set",
      attestationCleared: attestationChange === "clear",
    },
  });
}

/** Releases the connection's registry claim, if any (no-op for a sandbox, which is never registered). */
async function releaseRegistry(tx: TenantTx, connectionId: string): Promise<void> {
  await tx.execute(sql`select integration_registry_release(${connectionId}::uuid)`);
}

/** pending_approval -> draft (spec "Connection lifecycle"). Unreachable in PI1b's own UI (Submit
 * for a real connection is disabled until PI2a's test-connection exists), kept for when it isn't. */
export async function withdrawConnection(
  tx: TenantTx,
  actor: Actor,
  connectionId: string,
  env: ConnectionEnvironment,
  t: SettingsT = englishSettingsT,
): Promise<void> {
  const current = await lockConnection(tx, connectionId);
  if (!current) throw new ConnectionError(t("integrations.error.notFound"));
  if (current.status !== "pending_approval") {
    throw new ConnectionError(t("integrations.error.invalidTransition"));
  }
  assertEnvironmentAllows(current.isSandbox, env, t);
  await updateConnectionRow(tx, connectionId, actor.userId, { status: "draft" });
  if (!current.isSandbox) await releaseRegistry(tx, connectionId);
  await audit(tx, {
    action: "integration.connection_updated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: connectionId,
    metadata: { transition: "withdrawn" },
  });
}

export async function pauseConnection(
  tx: TenantTx,
  actor: Actor,
  connectionId: string,
  env: ConnectionEnvironment,
  t: SettingsT = englishSettingsT,
): Promise<void> {
  const current = await lockConnection(tx, connectionId);
  if (!current) throw new ConnectionError(t("integrations.error.notFound"));
  if (current.status !== "active") throw new ConnectionError(t("integrations.error.invalidTransition"));
  assertEnvironmentAllows(current.isSandbox, env, t);
  await updateConnectionRow(tx, connectionId, actor.userId, { status: "paused" });
  await audit(tx, {
    action: "integration.connection_paused",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: connectionId,
  });
}

/**
 * Resume requires a step-up-fresh MFA verification within the last 5 minutes (spec "PI1b").
 * Allowed from `paused` or `error` (drizzle/0039's lifecycle trigger allows both `-> active`).
 */
export async function resumeConnection(
  tx: TenantTx,
  actor: Actor,
  connectionId: string,
  env: ConnectionEnvironment,
  t: SettingsT = englishSettingsT,
): Promise<void> {
  const current = await lockConnection(tx, connectionId);
  if (!current) throw new ConnectionError(t("integrations.error.notFound"));
  if (current.status !== "paused" && current.status !== "error") {
    throw new ConnectionError(t("integrations.error.invalidTransition"));
  }
  assertEnvironmentAllows(current.isSandbox, env, t);
  if (!actor.recentMfa) throw new ConnectionError(t("integrations.error.stepUpRequired"), undefined, true);
  await updateConnectionRow(tx, connectionId, actor.userId, { status: "active" });
  await audit(tx, {
    action: "integration.connection_resumed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: connectionId,
  });
}

/**
 * Any non-revoked status -> revoked (terminal). Requires a step-up-fresh MFA verification and a
 * reason code (fixed vocabulary, matches `status_reason`'s CHECK). Releases the connection's
 * registry claim, if any.
 */
export async function revokeConnection(
  tx: TenantTx,
  actor: Actor,
  connectionId: string,
  reasonCode: RevokeReasonCode,
  env: ConnectionEnvironment,
  t: SettingsT = englishSettingsT,
): Promise<void> {
  const current = await lockConnection(tx, connectionId);
  if (!current) throw new ConnectionError(t("integrations.error.notFound"));
  if (current.status === "revoked") throw new ConnectionError(t("integrations.error.invalidTransition"));
  assertEnvironmentAllows(current.isSandbox, env, t);
  if (!actor.recentMfa) throw new ConnectionError(t("integrations.error.stepUpRequired"), undefined, true);
  await updateConnectionRow(tx, connectionId, actor.userId, {
    status: "revoked",
    status_reason: reasonCode,
    revoked_by: actor.userId,
    revoked_at: new Date(),
  });
  if (!current.isSandbox) await releaseRegistry(tx, connectionId);
  await audit(tx, {
    action: "integration.connection_revoked",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: connectionId,
    reason: reasonCode,
    metadata: { reasonCode },
  });
}

/**
 * draft -> active for the built-in sandbox only, with no operator approval (spec "PI1b": the CHECK
 * `integration_connections_approved_when_live` is satisfied because `is_sandbox` is true, and the
 * lifecycle trigger allows `draft -> active` only when `is_sandbox`). Treated as this connection's
 * Submit-equivalent in the lifecycle (spec "Connection lifecycle": "Submit: passing test..., ...,
 * MFA step-up"; correctness review PR #81, item 6) — it skips the test-connection and the
 * attestation because the sandbox is synthetic, not because it skips step-up too.
 */
export async function activateSandboxConnection(
  tx: TenantTx,
  actor: Actor,
  connectionId: string,
  env: ConnectionEnvironment,
  t: SettingsT = englishSettingsT,
): Promise<void> {
  assertEnvironmentAllows(true, env, t);
  const current = await lockConnection(tx, connectionId);
  if (!current) throw new ConnectionError(t("integrations.error.notFound"));
  if (!current.isSandbox || current.status !== "draft") {
    throw new ConnectionError(t("integrations.error.invalidTransition"));
  }
  if (await anotherLiveConnectionExists(tx, connectionId)) {
    throw new ConnectionError(t("integrations.error.anotherConnectionLive"));
  }
  if (!actor.recentMfa) throw new ConnectionError(t("integrations.error.stepUpRequired"), undefined, true);
  await updateConnectionRow(tx, connectionId, actor.userId, { status: "active" });
  await audit(tx, {
    action: "integration.connection_activated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: connectionId,
    metadata: { isSandbox: true },
  });
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** Every Patients connection this practice has ever had (revoked ones kept, never deleted). */
export async function listConnections(tx: TenantTx): Promise<ConnectionRow[]> {
  return tx
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.targetTable, "patients"))
    .orderBy(desc(integrationConnections.createdAt));
}

export async function getConnection(tx: TenantTx, id: string): Promise<ConnectionRow | null> {
  const [row] = await tx
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Just the name, for a spot that only ever shows "Synced from {name}" (the patient chart) and has
 * no business reading a connection's base URL, client ID, or attestation/approval history to
 * render it (security/correctness review PR #81, item 18: narrower than `getConnection`'s full
 * row for a read that doesn't need it).
 */
export async function getConnectionDisplayName(tx: TenantTx, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ displayName: integrationConnections.displayName })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id))
    .limit(1);
  return row?.displayName ?? null;
}

export interface PatientsConnectionSummary {
  id: string;
  displayName: string;
  status: ConnectionStatus;
  isSandbox: boolean;
  lastSuccessAt: Date | null;
  hasSynced: boolean;
}

/**
 * The one connection most relevant to the Patients table right now: whichever isn't draft/revoked
 * (at most one can exist, drizzle/0039's partial unique index), else the most recently touched
 * draft or revoked row, else none. Used by the tab-bar drop-down (AppShell, one query) and the
 * Patients pages. Read-only; the register-open check itself stays `assertPatientsRegisterOpen`
 * (src/domain/patients/queries.ts), which locks rows `FOR SHARE` for correctness under a race.
 */
export async function getPatientsConnectionSummary(tx: TenantTx): Promise<PatientsConnectionSummary | null> {
  const [row] = await tx
    .select({
      id: integrationConnections.id,
      displayName: integrationConnections.displayName,
      status: integrationConnections.status,
      isSandbox: integrationConnections.isSandbox,
      lastSuccessAt: integrationConnections.lastSuccessAt,
      hasSynced: integrationConnections.hasSynced,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.targetTable, "patients"))
    .orderBy(
      sql`(${integrationConnections.status} not in ('draft', 'revoked')) desc`,
      desc(integrationConnections.updatedAt),
    )
    .limit(1);
  return row ?? null;
}

/** Mirrors `assertPatientsRegisterOpen`'s blocking rule, for read-only UI decisions (hide/show). */
export function blocksPatientsRegister(summary: PatientsConnectionSummary | null): boolean {
  return summary !== null && summary.status !== "draft" && summary.status !== "revoked";
}
