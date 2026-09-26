import { auditEvents } from "@/db/schema";
import { systemDb } from "@/db/client";
import type { TenantTx } from "@/db/tenant";
import { requestContext } from "./request-context";

// Every PHI read or write emits an audit event: who, what, when, where, why (R-7.5.1).
// IP and user agent are filled from the request automatically. Metadata holds IDs and enum
// values only, never PHI.

export type AuditAction =
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.locked_out"
  | "auth.mfa_enrolled"
  | "auth.mfa_failed"
  | "auth.logout"
  | "auth.session_expired"
  | "denial.queue_viewed"
  | "denial.viewed"
  | "denial.status_changed"
  | "denial.assigned"
  | "denial.note_added"
  | "patient.member_id_revealed"
  | "system.demo_seeded"
  | "auth.demo_login"
  | "auth.password_changed"
  | "security.rate_limited"
  | "operator.console_viewed"
  | "operator.practice_created"
  | "operator.practice_suspended"
  | "operator.practice_reactivated"
  | "operator.demo_reset"
  | "rcm.defaults_loaded"
  | "rcm.file_imported"
  | "rcm.file_viewed"
  | "rcm.file_rejected";

export interface AuditEvent {
  action: AuditAction;
  actorUserId?: string | null;
  tenantId?: string | null;
  entityType?: "denial" | "claim" | "patient" | "user" | "session" | "tenant" | "rcm_file";
  entityId?: string | null;
  reason?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

async function row(event: AuditEvent) {
  const context = await requestContext();
  return {
    action: event.action,
    actorUserId: event.actorUserId ?? null,
    tenantId: event.tenantId ?? null,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    reason: event.reason ?? null,
    ipAddress: event.ipAddress ?? context.ip,
    userAgent: context.userAgent,
    metadata: event.metadata ?? null,
  };
}

/** Records an event inside a tenant transaction, so it commits or rolls back with the change. */
export async function audit(tx: TenantTx, event: AuditEvent): Promise<void> {
  await tx.insert(auditEvents).values(await row(event));
}

/** Records an event outside tenant context (authentication). */
export async function auditSystem(event: AuditEvent): Promise<void> {
  await systemDb()
    .insert(auditEvents)
    .values(await row(event));
}
