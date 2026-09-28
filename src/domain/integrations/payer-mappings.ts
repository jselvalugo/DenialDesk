import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { canManageIntegrations } from "@/auth/permissions";
import { integrationConnections, integrationPayerMappings, patients, payers } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { en } from "@/i18n/messages/en";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import { INVISIBLE_CHARS } from "@/integrations/fhir/identifier-rules";
import { audit } from "@/lib/audit";
import { IntegrationConnectionError, requireStepUp, type IntegrationActor } from "./connections";

// Payer mapping (docs/specs/patient-integrations.md PI2b, "Payer mapping page"; threat model T6).
// The EHR/PM reports each patient's coverage with a payor key (`Organization/<id>`). DenialDesk never
// guesses which of the practice's payers that is (CLAUDE.md #9: don't invent payer rules): a synced
// patient's coverage gets a payer only through the explicit mapping an administrator saves here, and
// until then the patient has no payer and no deadline. One row per (connection, payor key), set to a
// payer of this practice or left unmapped.
//
// **Privileges.** `integration_payer_mappings` grants SELECT, INSERT, UPDATE to `denialdesk_app` on
// every column (drizzle/0039) and has tenant row-level security, so every statement here runs through
// `withTenant` as the practice; nothing needs a GRANT. The read of `patients` is a grouped count of
// `coverage_payor_key` per connection (patients grants SELECT to the app role).
//
// **What a save does not do.** It does not update the patients that carry the key. A synced patient's
// `primary_payer_id` and `coverage_status` are read-only outside a running sync run (trigger
// `patients_synced_readonly`, drizzle/0039), and the run's own context (`withTenantAsSystem`) belongs
// to the sync engine. The save records the decision and how many patients it concerns
// (`affected_patient_count`, in the audit event); the sync applies a mapping to a patient's coverage.
//
// **Data.** A payor key is Restricted PHI where it sits on a patient row (spec "Classification"), so
// the page that shows keys is audited (`integration.payer_mappings_viewed`, IDs and counts only) and no
// key, name, or patient identifier is ever written to an audit event or a log: an event names the
// mapping row's own ID.

type IntegrationsT = Translator<Messages["integrations"]>;
type IntegrationsKey = MessageKey<"integrations">;
const englishT: IntegrationsT = createTranslator(en.integrations, "en");

/** The most insurers one page lists and one save accepts. A practice has a handful; this is a bound. */
export const MAX_PAYER_MAPPING_ROWS = 500;
/** A payor key is a FHIR reference (`Organization/<id>`, id ≤ 64 characters); this is a generous cap. */
const MAX_PAYOR_KEY_LENGTH = 256;
/** `updated_at` as the page round-trips it (ISO), or empty for an insurer with no decision yet. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One insurer the connection has reported, and what the administrator decided for it. */
export interface PayerMappingRow {
  payorKey: string;
  /** The insurer's name in the EHR/PM when the sync recorded one (the page never writes it). */
  payorName: string | null;
  /** The practice payer it maps to; null = not mapped (no decision, or an explicit "not mapped"). */
  payerId: string | null;
  /** The mapping row's ID; null until a decision is saved. */
  mappingId: string | null;
  /** The mapping's `updated_at` (ISO) as read, or "": the version a save is checked against. */
  version: string;
  /** How many of this connection's synced patients carry the key. Counts only. */
  patientCount: number;
}

export interface PayerMappingList {
  rows: PayerMappingRow[];
  /** More insurers exist than `MAX_PAYER_MAPPING_ROWS`. */
  truncated: boolean;
}

/**
 * The insurers of one connection: every payor key a synced patient carries (with how many patients)
 * plus every key that already has a mapping row (a decision survives patients moving away), sorted by
 * key. Scoped to the practice by row-level security and to the connection by the WHERE clause.
 */
export async function listPayerMappings(tx: TenantTx, connectionId: string): Promise<PayerMappingList> {
  const mappings = await tx
    .select({
      id: integrationPayerMappings.id,
      payorKey: integrationPayerMappings.payorKey,
      payorName: integrationPayerMappings.payorName,
      payerId: integrationPayerMappings.payerId,
      updatedAt: integrationPayerMappings.updatedAt,
    })
    .from(integrationPayerMappings)
    .where(eq(integrationPayerMappings.connectionId, connectionId))
    .orderBy(asc(integrationPayerMappings.payorKey))
    .limit(MAX_PAYER_MAPPING_ROWS + 1);
  const counts = await tx
    .select({
      payorKey: patients.coveragePayorKey,
      count: sql<number>`count(*)::int`,
    })
    .from(patients)
    .where(and(eq(patients.sourceConnectionId, connectionId), isNotNull(patients.coveragePayorKey)))
    .groupBy(patients.coveragePayorKey)
    .orderBy(asc(patients.coveragePayorKey))
    .limit(MAX_PAYER_MAPPING_ROWS + 1);

  const byKey = new Map<string, PayerMappingRow>();
  for (const mapping of mappings) {
    byKey.set(mapping.payorKey, {
      payorKey: mapping.payorKey,
      payorName: mapping.payorName,
      payerId: mapping.payerId,
      mappingId: mapping.id,
      version: mapping.updatedAt.toISOString(),
      patientCount: 0,
    });
  }
  for (const { payorKey, count } of counts) {
    if (payorKey === null) continue;
    const existing = byKey.get(payorKey);
    if (existing) existing.patientCount = count;
    else {
      byKey.set(payorKey, {
        payorKey,
        payorName: null,
        payerId: null,
        mappingId: null,
        version: "",
        patientCount: count,
      });
    }
  }
  const all = [...byKey.values()].sort((a, b) =>
    a.payorKey < b.payorKey ? -1 : a.payorKey > b.payorKey ? 1 : 0,
  );
  return { rows: all.slice(0, MAX_PAYER_MAPPING_ROWS), truncated: all.length > MAX_PAYER_MAPPING_ROWS };
}

/** The practice's payers to map to, alphabetical (names are public reference data, not PHI). */
export async function listMappablePayers(tx: TenantTx): Promise<Array<{ id: string; name: string }>> {
  return tx
    .select({ id: payers.id, name: payers.name })
    .from(payers)
    .orderBy(asc(payers.name), asc(payers.id));
}

/** One line of the form: the insurer's key, the chosen payer ("" = not mapped), and the version read. */
export interface PayerMappingInput {
  key: string;
  payerId: string;
  version: string;
}

function refuse(t: IntegrationsT, key: IntegrationsKey): never {
  throw new IntegrationConnectionError(t(key));
}

/**
 * Reads the form's lines defensively: a fixed shape, bounded, no duplicate key, a payer that is empty
 * or a UUID, a version that is empty or an ISO timestamp, a key with no control or invisible
 * characters. Anything else is "the form sent something it shouldn't".
 */
function parseInputs(raw: unknown, t: IntegrationsT): PayerMappingInput[] {
  if (!Array.isArray(raw)) refuse(t, "error.unexpectedField");
  if (raw.length > MAX_PAYER_MAPPING_ROWS) refuse(t, "error.payersTooMany");
  const seen = new Set<string>();
  return raw.map((line: unknown) => {
    if (typeof line !== "object" || line === null) refuse(t, "error.unexpectedField");
    const { key, payerId, version } = line as Record<string, unknown>;
    if (typeof key !== "string" || typeof payerId !== "string" || typeof version !== "string") {
      refuse(t, "error.unexpectedField");
    }
    if (
      key.length === 0 ||
      key.length > MAX_PAYOR_KEY_LENGTH ||
      INVISIBLE_CHARS.test(key) ||
      seen.has(key) ||
      (payerId !== "" && !UUID.test(payerId)) ||
      (version !== "" && !ISO_TIMESTAMP.test(version))
    ) {
      refuse(t, "error.unexpectedField");
    }
    seen.add(key);
    return { key, payerId: payerId.toLowerCase(), version };
  });
}

/**
 * Saves the administrator's mapping decisions for one connection (spec PI2b "Payer mapping").
 *
 * Refusals, in order, before anything is written: not an administrator; **no MFA step-up in the last
 * five minutes** (`requireStepUp`, the helper Resume and Submit use; the actor's `recentMfa` comes from
 * the session, never the request); a malformed form; a connection that isn't the practice's (another
 * practice's ID is "not found") or is revoked; an insurer this connection never reported (no mapping
 * row and no patient carries the key: an administrator can't plant keys); a payer that isn't one of the
 * practice's; a line whose mapping changed since the page was opened (`version`).
 *
 * Only lines that change something are written: a payer set for an insurer, changed, or cleared to
 * "not mapped". Each written line is one `integration.payer_mapping_changed` event in the same
 * transaction (mapping ID, connection ID, the new and previous payer IDs, the number of synced patients
 * that carry the key, and the step-up time; never the key, the name, or a patient), so a failed audit
 * write rolls the whole save back. The connection row is locked `FOR SHARE` (a revoke that lands
 * meanwhile waits) and the existing mapping rows `FOR UPDATE`.
 */
export async function savePayerMappings(
  tx: TenantTx,
  actor: IntegrationActor,
  connectionId: string,
  raw: unknown,
  t: IntegrationsT = englishT,
): Promise<{ changed: number }> {
  if (!canManageIntegrations(actor.role)) refuse(t, "error.notAdmin");
  requireStepUp(actor, t);
  const inputs = parseInputs(raw, t);

  const [connection] = await tx
    .select({ id: integrationConnections.id, status: integrationConnections.status })
    .from(integrationConnections)
    .where(
      and(eq(integrationConnections.id, connectionId), eq(integrationConnections.tenantId, actor.tenantId)),
    )
    .for("share");
  if (!connection) refuse(t, "error.notFound");
  if (connection.status === "revoked") refuse(t, "error.revoked");

  const existingRows = await tx
    .select({
      id: integrationPayerMappings.id,
      payorKey: integrationPayerMappings.payorKey,
      payerId: integrationPayerMappings.payerId,
      updatedAt: integrationPayerMappings.updatedAt,
    })
    .from(integrationPayerMappings)
    .where(
      and(
        eq(integrationPayerMappings.connectionId, connectionId),
        eq(integrationPayerMappings.tenantId, actor.tenantId),
      ),
    )
    .for("update");
  const existing = new Map(existingRows.map((row) => [row.payorKey, row]));

  // An insurer this connection reported: it has a mapping row, or a synced patient carries its key.
  const unseen = inputs.map((line) => line.key).filter((key) => !existing.has(key));
  const reported = new Set<string>();
  if (unseen.length > 0) {
    const carried = await tx
      .select({ payorKey: patients.coveragePayorKey })
      .from(patients)
      .where(and(eq(patients.sourceConnectionId, connectionId), inArray(patients.coveragePayorKey, unseen)))
      .groupBy(patients.coveragePayorKey);
    for (const { payorKey } of carried) if (payorKey !== null) reported.add(payorKey);
  }
  for (const line of inputs) {
    if (!existing.has(line.key) && !reported.has(line.key)) refuse(t, "error.payerKeyUnknown");
  }

  // The payers chosen must be this practice's own (row-level security hides every other practice's;
  // the composite foreign key would refuse them too, this gives the administrator a message).
  const chosen = [...new Set(inputs.map((line) => line.payerId).filter((id) => id !== ""))];
  if (chosen.length > 0) {
    const own = await tx.select({ id: payers.id }).from(payers).where(inArray(payers.id, chosen));
    if (own.length !== chosen.length) refuse(t, "error.payerUnknown");
  }

  // What actually changes, checked against the version the page showed.
  const changes: Array<{ key: string; previous: string | null; next: string | null; id: string | null }> = [];
  for (const line of inputs) {
    const current = existing.get(line.key);
    const previous = current?.payerId ?? null;
    const next = line.payerId === "" ? null : line.payerId;
    if (previous === next) continue;
    if ((current?.updatedAt.toISOString() ?? "") !== line.version) refuse(t, "error.payersStale");
    changes.push({ key: line.key, previous, next, id: current?.id ?? null });
  }
  if (changes.length === 0) return { changed: 0 };

  const written: Array<{ id: string; key: string; previous: string | null; next: string | null }> = [];
  for (const change of changes) {
    if (change.id !== null) {
      const updated = await tx
        .update(integrationPayerMappings)
        .set({ payerId: change.next, updatedBy: actor.userId, updatedAt: sql`now()` })
        .where(
          and(
            eq(integrationPayerMappings.id, change.id),
            eq(integrationPayerMappings.tenantId, actor.tenantId),
            eq(integrationPayerMappings.connectionId, connectionId),
          ),
        )
        .returning({ id: integrationPayerMappings.id });
      if (updated.length !== 1) refuse(t, "error.payersStale");
      written.push({ id: change.id, key: change.key, previous: change.previous, next: change.next });
    } else {
      // A first decision for this insurer (only ever a payer: "not mapped" over nothing changes nothing).
      const inserted = await tx
        .insert(integrationPayerMappings)
        .values({
          tenantId: actor.tenantId,
          connectionId,
          payorKey: change.key,
          payerId: change.next,
          updatedBy: actor.userId,
        })
        .onConflictDoNothing({
          target: [
            integrationPayerMappings.tenantId,
            integrationPayerMappings.connectionId,
            integrationPayerMappings.payorKey,
          ],
        })
        .returning({ id: integrationPayerMappings.id });
      // Someone saved a decision for the same insurer first.
      if (inserted.length !== 1) refuse(t, "error.payersStale");
      written.push({ id: inserted[0]!.id, key: change.key, previous: null, next: change.next });
    }
  }

  const affected = await tx
    .select({ payorKey: patients.coveragePayorKey, count: sql<number>`count(*)::int` })
    .from(patients)
    .where(
      and(
        eq(patients.sourceConnectionId, connectionId),
        inArray(
          patients.coveragePayorKey,
          written.map((change) => change.key),
        ),
      ),
    )
    .groupBy(patients.coveragePayorKey);
  const affectedByKey = new Map(affected.map((row) => [row.payorKey, row.count]));

  for (const change of written) {
    await audit(tx, {
      action: "integration.payer_mapping_changed",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "integration_payer_mapping",
      entityId: change.id,
      metadata: {
        connection_id: connectionId,
        payer_id: change.next,
        previous_payer_id: change.previous,
        change: change.next === null ? "cleared" : change.previous === null ? "mapped" : "changed",
        affected_patient_count: affectedByKey.get(change.key) ?? 0,
        step_up_verified_at: actor.stepUpVerifiedAt ?? null,
      },
    });
  }
  return { changed: written.length };
}

/**
 * Records that an administrator opened the mapping page: the connection, and how many insurers and
 * synced patients it showed (counts). The page shows payor keys, which are Restricted PHI on the
 * patient rows they come from, so the read is audited like other reads of them (R-7.5.1); the event
 * itself carries no key or name.
 */
export async function auditPayerMappingsViewed(
  tx: TenantTx,
  actor: Pick<IntegrationActor, "tenantId" | "userId">,
  connectionId: string,
  list: PayerMappingList,
): Promise<void> {
  await audit(tx, {
    action: "integration.payer_mappings_viewed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_connection",
    entityId: connectionId,
    metadata: {
      insurer_count: list.rows.length,
      patient_count: list.rows.reduce((sum, row) => sum + row.patientCount, 0),
    },
  });
}
