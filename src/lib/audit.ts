import { auditEvents } from "@/db/schema";
import { systemDb } from "@/db/client";
import type { TenantTx } from "@/db/tenant";
import { requestContext } from "./request-context";

// Every PHI read or write emits an audit event: who, what, when, where, why (R-7.5.1).
// IP and user agent are filled from the request automatically. Metadata holds IDs, enum values,
// and — for integration connections only — Confidential configuration (normalized base URL, client
// ID, MRN identifier system; docs/specs/patient-integrations.md "Audit events"); never PHI. Audit
// rows are never forwarded to logs or analytics (`clientId` is on src/lib/log.ts's deny-list).

export type AuditAction =
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.locked_out"
  | "auth.mfa_enrolled"
  | "auth.mfa_failed"
  | "auth.logout"
  | "auth.session_expired"
  | "auth.session_revoked"
  | "auth.session_replaced"
  | "denial.queue_viewed"
  | "denial.viewed"
  | "denial.status_changed"
  | "denial.assigned"
  | "denial.note_added"
  | "denial.captured"
  | "claim.list_viewed"
  | "claim.viewed"
  | "claim.corrected"
  | "patient.member_id_revealed"
  | "patient.list_viewed"
  | "patient.searched"
  | "patient.viewed"
  | "patient.created"
  | "patient.updated"
  | "patient.sensitivity_changed"
  | "system.demo_seeded"
  | "system.admin_repaired"
  | "auth.password_changed"
  | "auth.step_up_verified"
  | "auth.step_up_failed"
  | "auth.step_up_refused"
  | "security.rate_limited"
  | "operator.console_viewed"
  | "operator.login_succeeded"
  | "operator.login_failed"
  | "operator.mfa_failed"
  | "operator.mfa_enrolled"
  | "operator.logout"
  | "operator.session_revoked"
  | "operator.credential_provisioned"
  | "operator.credential_rotated"
  | "operator.credential_refused"
  | "system.demo_retired"
  | "operator.practice_created"
  | "operator.practice_suspended"
  | "operator.practice_reactivated"
  | "operator.practice_viewed"
  | "operator.agreement_recorded"
  | "operator.agreement_downloaded"
  | "operator.agreement_voided"
  | "rcm.defaults_loaded"
  | "payer.catalog_loaded"
  | "rcm.file_imported"
  | "rcm.file_list_viewed"
  | "rcm.file_viewed"
  | "rcm.file_rejected"
  | "rcm.voucher_prepared"
  | "rcm.voucher_approved"
  | "rcm.voucher_exported"
  | "rcm.voucher_voided"
  | "rcm.voucher_superseded"
  | "rcm.deposits_imported"
  | "rcm.deposits_rejected"
  | "rcm.deposits_reversed"
  | "rcm.report_viewed"
  | "settings.custom_field_created"
  | "settings.custom_field_updated"
  | "settings.custom_field_deactivated"
  | "settings.custom_field_reactivated"
  | "insight.report_viewed"
  | "insight.report_exported"
  | "appeal.list_viewed"
  | "appeal.viewed"
  | "appeal.create_form_viewed"
  | "appeal.created"
  | "appeal.submission_recorded"
  | "appeal.decision_recorded"
  | "appeal.note_added"
  | "custom_field.value_revealed"
  | "custom_field.value_integrity_failed"
  | "custom_field.values_read"
  | "custom_field.values_updated"
  | "remittance.list_viewed"
  | "remittance.uploaded"
  | "remittance.upload_rejected"
  | "remittance.viewed"
  | "remittance.posted"
  | "remittance.voided"
  | "prompt_pay.list_viewed"
  | "prompt_pay.viewed"
  | "prompt_pay.response_recorded"
  | "prompt_pay.response_voided"
  | "university.lesson_completed"
  | "university.access_requested"
  | "operator.university_access_granted"
  | "operator.university_access_revoked"
  | "integration.connection_created"
  | "integration.connection_updated"
  | "integration.connection_submitted"
  | "integration.registry_conflict"
  | "integration.connection_withdrawn"
  | "integration.connection_paused"
  | "integration.connection_resumed"
  | "integration.connection_revoked"
  | "integration.connection_tested"
  | "integration.transport_refused"
  | "security.env_signing_key_in_production";

/**
 * Actions no longer written, which still appear in older audit rows (the log is append-only).
 * Kept so future audit viewers and exports can label them (e.g. accounting of disclosures).
 */
export const RETIRED_AUDIT_ACTIONS = {
  "auth.demo_login": "One-click demo sign-in (demo removed 2026-09-26)",
  "operator.demo_reset": "Demo practice reset by the operator (demo removed 2026-09-26)",
  "operator.setup_completed": "Operator account set up on the setup page (removed 2026-09-26)",
  "operator.setup_failed": "Operator setup page refusal (removed 2026-09-26)",
} as const;

export interface AuditEvent {
  action: AuditAction;
  actorUserId?: string | null;
  tenantId?: string | null;
  entityType?:
    | "denial"
    | "claim"
    | "patient"
    | "user"
    | "session"
    | "tenant"
    | "tenant_agreement"
    | "rcm_file"
    | "rcm_voucher"
    | "rcm_deposit_file"
    | "custom_field"
    | "appeal"
    | "custom_field_value"
    | "remittance"
    | "prompt_pay_response"
    | "university_lesson"
    | "university_access"
    | "integration_connection";
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
