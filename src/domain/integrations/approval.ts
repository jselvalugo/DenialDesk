import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import type { OperatorContext } from "@/auth/operator";
import { isOperatorAccount } from "@/auth/operator-account";
import { systemDb } from "@/db/client";
import {
  integrationConnections,
  integrationEndpointRegistry,
  tenantAgreements,
  tenants,
  users,
} from "@/db/schema";
import { withTenantAsPlatform, type TenantTx } from "@/db/tenant";
import { agreementStatus } from "@/domain/platform/agreements";
import { PracticeError } from "@/domain/platform/errors";
import { audit, auditSystem } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";
import {
  isApprovalMethodCode,
  isContactRoleCode,
  isPopulationScope,
  isRejectReasonCode,
} from "./approval-codes";
import { normalizedUrlForAudit } from "./connections";

// The platform operator's side of a real EHR/PM connection (docs/specs/patient-integrations.md
// PI1c; ADR 0010; threat model S2 "confused deputy"). A real connection Submit put in
// `pending_approval` is verified with the practice's EHR administrator outside the app, then
// approved or rejected here.
//
// **Privilege.** Nothing here needs a GRANT, a role, or a SECURITY DEFINER function. The approval
// columns (`approved_by/_at`, `approval_method`, `population_scope`, `mrn_nine_digits_verified`)
// are not granted to `denialdesk_app` (drizzle/0039), so the writes run through
// `withTenantAsPlatform`: the connection owner's privileges with `app.tenant_id` set, the same path
// the operator's BAA and University-access writes use. The database still applies its rules to the
// owner: the lifecycle trigger (0039/0040/0042) requires a *fresh* approval stamp and a registry
// entry for `pending_approval → active`, and `integration_registry_release` (SECURITY DEFINER,
// tenant-checked against `app.tenant_id`, which the platform context sets) refuses to release
// unless the connection is already `draft` or `revoked`.
//
// Every statement names the practice and the connection explicitly: the tenant policy is defense in
// depth only in this context. Configuration only, never PHI. Operator console only: nothing under
// src/app/(app) may import this module.

/** Practices read at a time when building the queue (the pool holds 10 connections). */
const QUEUE_CONCURRENCY = 3;

/** Columns the operator sees: configuration only (no key reference, no exception text). */
const reviewColumns = {
  id: integrationConnections.id,
  tenantId: integrationConnections.tenantId,
  displayName: integrationConnections.displayName,
  isSandbox: integrationConnections.isSandbox,
  status: integrationConnections.status,
  baseUrl: integrationConnections.baseUrl,
  endpointKey: integrationConnections.endpointKey,
  tokenEndpoint: integrationConnections.tokenEndpoint,
  tokenEndpointKey: integrationConnections.tokenEndpointKey,
  issuer: integrationConnections.issuer,
  clientId: integrationConnections.clientId,
  mrnIdentifierSystem: integrationConnections.mrnIdentifierSystem,
  keyMode: integrationConnections.keyMode,
  populationScope: integrationConnections.populationScope,
  submittedAt: integrationConnections.submittedAt,
  attestedBy: integrationConnections.usResidencyAttestedBy,
  attestedAt: integrationConnections.usResidencyAttestedAt,
  updatedAt: integrationConnections.updatedAt,
};

/** One connection awaiting approval, as the console shows it. */
export interface PendingApproval {
  practiceId: string;
  practiceName: string;
  connectionId: string;
  displayName: string;
  baseUrl: string;
  tokenEndpoint: string | null;
  issuer: string | null;
  clientId: string;
  mrnIdentifierSystem: string;
  /** Null until a key is assigned to the connection (key modes are set at approval, PI2a). */
  keyMode: string | null;
  /** Null while awaiting approval: the operator sets it. */
  populationScope: string | null;
  /** Where the practice's EHR administrator fetches the public key: a path on this site. */
  jwksPath: string;
  submittedAt: Date | null;
  attestedAt: Date | null;
  /** ISO string of `updated_at`: the version the operator reviewed; Approve/Reject refuse a newer one. */
  updatedAt: string;
}

/**
 * Where the connection's public signing key is published (spec "Keys"): pre-production, the one
 * shared key's document; where real data is allowed, one document per connection (Azure cutover).
 */
export function jwksPathFor(connectionId: string, synthetic: boolean = syntheticDataOnly()): string {
  return synthetic ? "/.well-known/jwks.json" : `/.well-known/jwks/${connectionId}.json`;
}

/**
 * Refuses anyone who is not the platform operator, by the one rule the console uses
 * (`isOperatorAccount`, docs/specs/operator-login.md): the account's email, as the database has it
 * (never the context's copy), is the configured operator email AND it belongs to no practice. A
 * practice administrator is refused (a membership), and so is any other account without one (not the
 * operator's email). A disabled account (`users.disabled_at` set) is refused as well: a session that
 * outlives the account's disabling must not keep deciding connections. `requireOperator` already
 * applies the first rule to every console request; repeating it here means the domain refuses a
 * hand-built context too. Fails closed on an unknown user.
 */
async function assertOperator(operator: OperatorContext): Promise<void> {
  const [user] = await systemDb()
    .select({ id: users.id, email: users.email, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, operator.userId))
    .limit(1);
  if (!user || user.disabledAt !== null || !(await isOperatorAccount(user))) {
    throw new PracticeError("errors.integrationNotOperator");
  }
}

/**
 * Records that the operator opened the approval queue (no target: the count of connections shown) or
 * one connection's review page (the practice and connection IDs). Configuration only, not PHI. Every
 * event carries the operator's `session_id`, as the decisions do (R-7.5.1: who, and from which
 * session), so a viewing can be tied to the session that made it.
 */
export async function auditIntegrationViewed(
  operator: OperatorContext,
  target: { tenantId: string; connectionId: string } | { count: number },
): Promise<void> {
  await auditSystem({
    action: "operator.integration_viewed",
    actorUserId: operator.userId,
    ...("count" in target
      ? { metadata: { count: target.count, session_id: operator.sessionId } }
      : {
          tenantId: target.tenantId,
          entityType: "integration_connection" as const,
          entityId: target.connectionId,
          metadata: { session_id: operator.sessionId },
        }),
  });
}

/**
 * The practice's Business Associate Agreements as Approve judges them, read through the decision's
 * own transaction with a shared row lock (`FOR SHARE`): an operator voiding one concurrently
 * (`voidAgreement` UPDATEs the row) waits for this decision to commit, or, if it committed first, is
 * seen here, so a void can't be missed between the check and the approval. Only `kind = 'baa'`
 * counts (as on the practices list), whatever other agreement kinds are added later.
 */
async function baaAgreements(tx: TenantTx, tenantId: string) {
  return tx
    .select({
      status: tenantAgreements.status,
      effectiveDate: tenantAgreements.effectiveDate,
      expiresOn: tenantAgreements.expiresOn,
    })
    .from(tenantAgreements)
    .where(and(eq(tenantAgreements.tenantId, tenantId), eq(tenantAgreements.kind, "baa")))
    .orderBy(desc(tenantAgreements.createdAt))
    .for("share");
}

async function pendingIn(tx: TenantTx, tenantId: string) {
  return tx
    .select(reviewColumns)
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.tenantId, tenantId),
        eq(integrationConnections.status, "pending_approval"),
        eq(integrationConnections.isSandbox, false),
      ),
    )
    .orderBy(asc(integrationConnections.submittedAt), asc(integrationConnections.id));
}

function toPending(
  practice: { id: string; name: string },
  row: Awaited<ReturnType<typeof pendingIn>>[number],
): PendingApproval {
  return {
    practiceId: practice.id,
    practiceName: practice.name,
    connectionId: row.id,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    tokenEndpoint: row.tokenEndpoint,
    issuer: row.issuer,
    clientId: row.clientId,
    mrnIdentifierSystem: row.mrnIdentifierSystem,
    keyMode: row.keyMode,
    populationScope: row.populationScope,
    jwksPath: jwksPathFor(row.id),
    submittedAt: row.submittedAt,
    attestedAt: row.attestedAt,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One customer practice's connections awaiting approval (the practice page), oldest submission first. */
export async function listPendingForPractice(
  tenantId: string,
  operator: OperatorContext,
): Promise<PendingApproval[]> {
  await assertOperator(operator);
  const [practice] = await systemDb()
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.kind, "customer")))
    .limit(1);
  if (!practice) return [];
  const rows = await withTenantAsPlatform({ tenantId, userId: operator.userId }, (tx) =>
    pendingIn(tx, tenantId),
  );
  return rows.map((row) => toPending(practice, row));
}

/**
 * Every customer practice's connections awaiting approval, oldest submission first (the console's
 * queue). Each practice is read in its own platform transaction with that practice's tenant set,
 * because the tenant policy is enforced for the connection owner unless it bypasses row-level
 * security. ⚠️ One transaction per practice: fine for the first customers; replace with an
 * operator-visible queue record when the count of practices grows (spec PI1c open item).
 */
export async function listPendingApprovals(operator: OperatorContext): Promise<PendingApproval[]> {
  await assertOperator(operator);
  const practices = await systemDb()
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.kind, "customer"))
    .orderBy(asc(tenants.createdAt), asc(tenants.id));
  // A few practices at a time: the connection pool is small (10), and the same pool serves every
  // other request, so an unbounded fan-out over all practices could starve them.
  const perPractice: PendingApproval[][] = [];
  for (let start = 0; start < practices.length; start += QUEUE_CONCURRENCY) {
    perPractice.push(
      ...(await Promise.all(
        practices.slice(start, start + QUEUE_CONCURRENCY).map(async (practice) => {
          const rows = await withTenantAsPlatform({ tenantId: practice.id, userId: operator.userId }, (tx) =>
            pendingIn(tx, practice.id),
          );
          return rows.map((row) => toPending(practice, row));
        }),
      )),
    );
  }
  return perPractice
    .flat()
    .sort(
      (a, b) =>
        (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0) ||
        a.connectionId.localeCompare(b.connectionId),
    );
}

/** One connection awaiting approval, or null when it isn't (any more) that practice's pending connection. */
export async function getPendingApproval(
  tenantId: string,
  connectionId: string,
  operator: OperatorContext,
): Promise<PendingApproval | null> {
  const all = await listPendingForPractice(tenantId, operator);
  return all.find((item) => item.connectionId === connectionId) ?? null;
}

export interface ApproveInput {
  tenantId: string;
  connectionId: string;
  /** The `updated_at` (ISO) of the version the operator reviewed. */
  expectedUpdatedAt: string;
  /** One of `APPROVAL_METHOD_CODES`: how the connection was verified with the practice's EHR administrator. */
  methodCode: string;
  /** The date of that verification (YYYY-MM-DD); not in the future. */
  verifiedOn: string;
  /** One of `CONTACT_ROLE_CODES`: the contact's role at the practice (never a name). */
  contactRole: string;
  /** `group_export` or `verified_filter`: the population the sync is limited to. */
  populationScope: string;
  /** Optional: the operator verified that the practice's MRNs are nine digits ("MRNs contain a nine-digit number (verified)"). */
  mrnNineDigitsVerified: boolean;
  /** The operator verified, outside the app, that the practice owns this client ID. Required. */
  clientIdOwnershipVerified: boolean;
}

/** A real calendar date in YYYY-MM-DD form. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Locks the practice's connection for a decision and checks it is still the version the operator
 * reviewed. The practice is named in the WHERE clause (never trusting the connection ID alone), so a
 * connection ID from another practice is "not found", not decided.
 */
async function lockPending(tx: TenantTx, tenantId: string, connectionId: string, expectedUpdatedAt: string) {
  const [current] = await tx
    .select(reviewColumns)
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.tenantId, tenantId)))
    .for("update");
  if (!current || current.isSandbox) throw new PracticeError("errors.integrationNotFound");
  if (current.status !== "pending_approval") throw new PracticeError("errors.integrationNotPending");
  // Anything that touched the row since the page loaded (a rename, a withdraw and resubmit) means the
  // configuration on screen is not what would be approved: review it again.
  if (current.updatedAt.toISOString() !== expectedUpdatedAt)
    throw new PracticeError("errors.integrationStale");
  return current;
}

/**
 * What the practice's own audit metadata records of the configuration under decision: the normalized
 * values only (scheme, host, path; never a query string), like the practice's own events.
 */
function configurationMetadata(current: {
  baseUrl: string;
  clientId: string;
  mrnIdentifierSystem: string;
  tokenEndpoint: string | null;
  issuer: string | null;
  keyMode: string | null;
}) {
  return {
    base_url: current.baseUrl,
    client_id: current.clientId,
    mrn_identifier_system: current.mrnIdentifierSystem,
    token_endpoint: normalizedUrlForAudit(current.tokenEndpoint),
    issuer: normalizedUrlForAudit(current.issuer),
    key_mode: current.keyMode,
  };
}

/**
 * Approve (`pending_approval` → `active`). Records how the connection was verified with the
 * practice's EHR administrator (method code, date, and the contact's role, in the audit event: the
 * connection row has one `approval_method` column), that the operator verified **outside the app**
 * that the practice owns the `client_id` (required: pre-production signs every connection with one
 * shared key, so the key alone doesn't tie a client registration to a practice), the population
 * scope, and optionally that MRNs are nine digits.
 *
 * **Refusals, in order** (the first that applies wins; nothing is written by any of them):
 *  1. Before the transaction (pure checks, no lock): not the operator (`assertOperator`: the
 *     configured email, no membership, account not disabled); not a real environment (where
 *     `syntheticDataOnly()` a real connection is never made live); a method, contact role, or scope
 *     outside the fixed vocabularies; a scope other than `group_export` (a verified filter can't be
 *     recorded yet: security review M2, spec PI1c); a verification date that is malformed or in the
 *     future by the Florida date; no client ID ownership confirmation.
 *  2. In one platform transaction: the practice is read `FOR SHARE` (unknown practice; suspended
 *     practice: suspension is a stop the operator set and activating would start a sync in it; the
 *     shared lock makes a suspension that lands meanwhile wait for this decision); the connection is
 *     locked `FOR UPDATE` under **that practice** (missing, a sandbox, not `pending_approval`, or
 *     changed since the page loaded: `updated_at`); then the verification date against the Florida
 *     date of `submitted_at` (this check needs the locked row, so it comes after the lock, not with
 *     the pure checks above); then the Business Associate Agreement (`baaAgreements`: read through
 *     this transaction `FOR SHARE`, `kind = 'baa'`, so a concurrent void is waited for and can't be
 *     missed); then the registry entry Submit claimed must still match this connection's endpoint,
 *     token endpoint, and client ID.
 *  3. One UPDATE writes the status and a fresh approval stamp (`approved_at` from the database clock;
 *     the 0040 trigger refuses an unchanged one and one with no registry entry), and
 *     `operator.integration_approved` is audited in the same transaction: if the audit write fails,
 *     the whole decision rolls back (the row stays pending, the stamps unchanged, the registry claim
 *     kept; `integration-approval.test.ts`).
 *
 * The date, the contact's role, and the ownership confirmation have no column: the audit event is
 * their record (spec PI1c, OA-070).
 */
export async function approveConnection(
  input: ApproveInput,
  operator: OperatorContext,
  options: {
    /** For tests: the clock the "not in the future" date check uses. */
    now?: Date;
    /** `syntheticDataOnly()`; always the server's environment, never a request value. */
    syntheticOnly?: boolean;
  } = {},
) {
  const now = options.now ?? new Date();
  await assertOperator(operator);
  // The environment rule, as for the practice's own transitions: where only synthetic data is allowed
  // a real endpoint is never made live (approval only ever concerns a real connection).
  if (options.syntheticOnly ?? syntheticDataOnly())
    throw new PracticeError("errors.integrationRealEndpointRefused");
  if (
    !isApprovalMethodCode(input.methodCode) ||
    !isContactRoleCode(input.contactRole) ||
    !isPopulationScope(input.populationScope)
  ) {
    throw new PracticeError("errors.approvalFormInvalid");
  }
  // A verified filter is a claim with nowhere to record the filter itself (the connection has one
  // `population_scope` code and no filter column), so it can't be approved yet: only a Group export.
  if (input.populationScope !== "group_export") throw new PracticeError("errors.approvalScopeUnsupported");
  if (!isIsoDate(input.verifiedOn) || input.verifiedOn > todayIn(undefined, now)) {
    throw new PracticeError("errors.approvalDateInvalid");
  }
  if (input.clientIdOwnershipVerified !== true) throw new PracticeError("errors.approvalOwnershipRequired");
  const { methodCode, contactRole, populationScope } = input;

  return withTenantAsPlatform({ tenantId: input.tenantId, userId: operator.userId }, async (tx) => {
    const [practice] = await tx
      .select({ suspendedAt: tenants.suspendedAt })
      .from(tenants)
      .where(and(eq(tenants.id, input.tenantId), eq(tenants.kind, "customer")))
      .limit(1)
      // A shared row lock until this decision commits: a suspension that lands meanwhile waits for it
      // rather than racing the check below.
      .for("share");
    if (!practice) throw new PracticeError("errors.practiceNotFound");
    if (practice.suspendedAt) throw new PracticeError("errors.integrationPracticeSuspended");

    const current = await lockPending(tx, input.tenantId, input.connectionId, input.expectedUpdatedAt);

    // The verification happens after the practice submitted: not before the Florida date of the
    // submission (the same calendar the "not in the future" check uses).
    if (current.submittedAt) {
      const submittedOn = todayIn(undefined, current.submittedAt);
      if (input.verifiedOn < submittedOn) {
        throw new PracticeError("errors.approvalDateBeforeSubmission", { date: submittedOn });
      }
    }

    // A real connection carries PHI: the practice needs a Business Associate Agreement in force
    // (docs/specs/practice-agreements.md), as for the rest of the platform.
    const baa = agreementStatus(await baaAgreements(tx, input.tenantId), todayIn(undefined, now));
    if (baa !== "active" && baa !== "expiring") throw new PracticeError("errors.approvalBaaRequired");

    // Submit claimed the registry for exactly this configuration. The lifecycle trigger requires an
    // entry to exist; this also requires it to be this connection's endpoint, token endpoint, and
    // client ID, so what the operator verified is what holds the claim.
    const [claim] = await tx
      .select({
        endpointKey: integrationEndpointRegistry.endpointKey,
        clientId: integrationEndpointRegistry.clientId,
        tokenEndpointKey: integrationEndpointRegistry.tokenEndpointKey,
      })
      .from(integrationEndpointRegistry)
      .where(eq(integrationEndpointRegistry.connectionId, input.connectionId));
    if (
      !claim ||
      current.tokenEndpointKey === null ||
      claim.endpointKey !== current.endpointKey ||
      claim.clientId !== current.clientId ||
      claim.tokenEndpointKey !== current.tokenEndpointKey
    ) {
      throw new PracticeError("errors.integrationNotClaimed");
    }

    const updated = await tx
      .update(integrationConnections)
      .set({
        status: "active",
        statusReason: null,
        approvedBy: operator.userId,
        approvedAt: sql`now()`,
        approvalMethod: methodCode,
        populationScope,
        mrnNineDigitsVerified: input.mrnNineDigitsVerified === true,
        updatedBy: operator.userId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.tenantId, input.tenantId),
          eq(integrationConnections.status, "pending_approval"),
        ),
      )
      .returning({ id: integrationConnections.id });
    if (updated.length !== 1) throw new PracticeError("errors.integrationNotPending");

    await audit(tx, {
      action: "operator.integration_approved",
      actorUserId: operator.userId,
      tenantId: input.tenantId,
      entityType: "integration_connection",
      entityId: input.connectionId,
      reason: methodCode,
      metadata: {
        previous_status: "pending_approval",
        status: "active",
        approval_method: methodCode,
        verified_on: input.verifiedOn,
        contact_role: contactRole,
        population_scope: populationScope,
        mrn_nine_digits_verified: input.mrnNineDigitsVerified === true,
        client_id_ownership_verified: true,
        registry_verified: true,
        session_id: operator.sessionId,
        ...configurationMetadata(current),
      },
    });
    return { connectionId: input.connectionId };
  });
}

export interface RejectInput {
  tenantId: string;
  connectionId: string;
  /** The `updated_at` (ISO) of the version the operator reviewed. */
  expectedUpdatedAt: string;
  /** One of `REJECT_REASON_CODES`. */
  reasonCode: string;
}

/**
 * Reject (`pending_approval` → `draft`, registry claim released), with a reason code from a fixed
 * vocabulary (kept as the connection's `status_reason` and the audit event's `reason`; no free text).
 *
 * The order is the database's: the status change first, because `integration_registry_release`
 * refuses unless the connection is already `draft` (or `revoked`); then the release; then a second
 * UPDATE clears what belonged to the rejected submission, exactly as Withdraw does: the U.S.-residency
 * attestation (the endpoint is editable again, and a different endpoint must be attested afresh; the
 * 0042 trigger refuses a Submit that carries a stale one) and the discovered token endpoint, its
 * registry key, and the issuer. The lifecycle trigger refuses to change them in the statement that
 * leaves `pending_approval`, and allows it once the row is a draft. The submission stamp stays as the
 * record that it was submitted. Audited `operator.integration_rejected`.
 */
export async function rejectConnection(input: RejectInput, operator: OperatorContext) {
  await assertOperator(operator);
  if (!isRejectReasonCode(input.reasonCode)) throw new PracticeError("errors.rejectReasonRequired");
  const reasonCode = input.reasonCode;

  return withTenantAsPlatform({ tenantId: input.tenantId, userId: operator.userId }, async (tx) => {
    const [practice] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, input.tenantId), eq(tenants.kind, "customer")))
      .limit(1);
    if (!practice) throw new PracticeError("errors.practiceNotFound");

    const current = await lockPending(tx, input.tenantId, input.connectionId, input.expectedUpdatedAt);
    const moved = await tx
      .update(integrationConnections)
      .set({
        status: "draft",
        statusReason: reasonCode,
        updatedBy: operator.userId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.tenantId, input.tenantId),
          eq(integrationConnections.status, "pending_approval"),
        ),
      )
      .returning({ id: integrationConnections.id });
    if (moved.length !== 1) throw new PracticeError("errors.integrationNotPending");

    // After the status change: the function refuses to release while still pending. It also checks
    // the connection belongs to `app.tenant_id`, which the platform context set to this practice.
    const released = await tx.execute<{ released: boolean }>(
      sql`select integration_registry_release(${input.connectionId}::uuid) as released`,
    );
    const registryReleased = released.rows[0]?.released === true;

    await tx
      .update(integrationConnections)
      .set({
        usResidencyAttestedBy: null,
        usResidencyAttestedAt: null,
        tokenEndpoint: null,
        tokenEndpointKey: null,
        issuer: null,
        updatedBy: operator.userId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.tenantId, input.tenantId),
        ),
      );

    await audit(tx, {
      action: "operator.integration_rejected",
      actorUserId: operator.userId,
      tenantId: input.tenantId,
      entityType: "integration_connection",
      entityId: input.connectionId,
      reason: reasonCode,
      metadata: {
        previous_status: "pending_approval",
        status: "draft",
        reason_code: reasonCode,
        registry_released: registryReleased,
        attestation_cleared: true,
        discovery_cleared: true,
        session_id: operator.sessionId,
        previous_attested_by: current.attestedBy ?? null,
        previous_attested_at: current.attestedAt?.toISOString() ?? null,
        ...configurationMetadata(current),
      },
    });
    return { connectionId: input.connectionId, registryReleased };
  });
}
