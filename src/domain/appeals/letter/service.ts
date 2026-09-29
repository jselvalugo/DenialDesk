import { and, desc, eq } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import type { TenantTx } from "@/db/tenant";
import {
  appealLetterAttestations,
  appealLetterTemplates,
  appealLetterVersions,
  appeals,
  users,
} from "@/db/schema";
import type { DenialCategory } from "@/domain/carc";
import type { MessageKey } from "@/i18n/messages/types";
import type { Params } from "@/i18n/translate";
import { audit } from "@/lib/audit";
import { loadMergeValues } from "./queries";
import {
  MISSING_VALUE,
  checkBody,
  hasUnresolvedPlaceholder,
  letterDigest,
  renderLetter,
  type BodyCheck,
} from "./merge-fields";

// Appeal letter writes and the export gate (docs/specs/appeals.md A2). Pure domain code: no auth, no
// form parsing, no Next.js, no translation. Errors come back as message keys for the caller to translate.
// Audit rows carry IDs, version numbers, and fixed reason codes only, never letter text or field values.

export interface LetterAuth {
  tenantId: string;
  userId: string;
}

export interface ServiceError {
  errorKey: MessageKey<"appeals">;
  params?: Params;
}

/** A letter can be started or changed until the appeal is submitted. Attesting is allowed in any status. */
const EDITABLE_STATUSES = ["draft", "in_review", "ready"];

export function bodyError(check: Exclude<BodyCheck, { ok: true }>): ServiceError {
  switch (check.reason) {
    case "empty":
      return { errorKey: "letter.error.empty" };
    case "too_long":
      return { errorKey: "letter.error.tooLong" };
    case "malformed":
      return { errorKey: "letter.error.malformed", params: { token: check.token } };
    case "unknown":
      return {
        errorKey: "letter.error.unknownField",
        params: { names: check.unknown.map((name) => name.slice(0, 40)).join(", ") },
      };
  }
}

async function lockAppeal(tx: TenantTx, appealId: string) {
  const [row] = await tx
    .select({ id: appeals.id, status: appeals.status })
    .from(appeals)
    .where(eq(appeals.id, appealId))
    .for("update");
  return row;
}

async function latestVersion(tx: TenantTx, appealId: string) {
  const [row] = await tx
    .select({
      id: appealLetterVersions.id,
      version: appealLetterVersions.version,
      body: appealLetterVersions.body,
      createdAt: appealLetterVersions.createdAt,
    })
    .from(appealLetterVersions)
    .where(eq(appealLetterVersions.appealId, appealId))
    .orderBy(desc(appealLetterVersions.version))
    .limit(1);
  return row;
}

/** The newest attestation of one version (a version can be re-attested after the data changes). */
async function newestAttestation(tx: TenantTx, appealId: string, version: number) {
  const [row] = await tx
    .select({
      id: appealLetterAttestations.id,
      renderedSha256: appealLetterAttestations.renderedSha256,
      attestedAt: appealLetterAttestations.attestedAt,
      attestedBy: users.displayName,
    })
    .from(appealLetterAttestations)
    .innerJoin(users, eq(users.id, appealLetterAttestations.attestedBy))
    .where(
      and(eq(appealLetterAttestations.appealId, appealId), eq(appealLetterAttestations.version, version)),
    )
    .orderBy(desc(appealLetterAttestations.attestedAt))
    .limit(1);
  return row;
}

export interface SaveLetterInput {
  appealId: string;
  body: string;
  /** The version the editor was showing (0 = no letter yet); a different latest version means a stale edit. */
  baseVersion: number;
  sourceCategory?: DenialCategory | null;
}

/** Saves the body as the next version (append-only). */
export async function saveLetterVersion(
  tx: TenantTx,
  auth: LetterAuth,
  input: SaveLetterInput,
): Promise<{ ok: true; version: number } | ServiceError> {
  const check = checkBody(input.body);
  if (!check.ok) return bodyError(check);
  const appeal = await lockAppeal(tx, input.appealId);
  if (!appeal) return { errorKey: "error.notFound" };
  if (!EDITABLE_STATUSES.includes(appeal.status)) return { errorKey: "letter.error.locked" };

  const latest = await latestVersion(tx, input.appealId);
  if ((latest?.version ?? 0) !== input.baseVersion) return { errorKey: "letter.error.stale" };
  if (latest && latest.body === input.body) return { errorKey: "letter.error.unchanged" };

  const version = (latest?.version ?? 0) + 1;
  await tx.insert(appealLetterVersions).values({
    tenantId: auth.tenantId,
    appealId: input.appealId,
    version,
    body: input.body,
    sourceCategory: input.sourceCategory ?? null,
    createdBy: auth.userId,
  });
  await audit(tx, {
    action: "appeal.letter_saved",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal",
    entityId: input.appealId,
    metadata: { version },
  });
  return { ok: true, version };
}

export type AttestRefusal =
  | "no_letter"
  | "stale"
  | "unresolved_placeholder"
  | "missing_values"
  | "sensitive_patient"
  | "already_attested";

const ATTEST_ERROR_KEYS: Record<AttestRefusal, MessageKey<"appeals">> = {
  no_letter: "letter.error.noLetter",
  stale: "letter.error.stale",
  unresolved_placeholder: "letter.error.unresolvedPlaceholder",
  missing_values: "letter.error.missingValues",
  sensitive_patient: "letter.error.sensitivePatient",
  already_attested: "letter.error.alreadyAttested",
};

/**
 * Records that the signed-in user reviewed this version of the letter (R-7.11.2). Only the latest version
 * can be attested. Refused (and audited with a fixed reason code) while a VERIFY / FILL IN placeholder or a
 * "[not on file]" value is left, for a patient with any sensitivity marking, and when the same rendering was
 * already attested. Allowed in any appeal status: after the record changes a person can review again.
 */
export async function attestLetter(
  tx: TenantTx,
  auth: LetterAuth,
  input: { appealId: string; version: number },
): Promise<{ ok: true } | ServiceError> {
  const appeal = await lockAppeal(tx, input.appealId);
  if (!appeal) return { errorKey: "error.notFound" };

  const refuse = async (reason: AttestRefusal, version?: number): Promise<ServiceError> => {
    await audit(tx, {
      action: "appeal.letter_attest_refused",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "appeal",
      entityId: input.appealId,
      metadata: version === undefined ? { reason } : { reason, version },
    });
    return { errorKey: ATTEST_ERROR_KEYS[reason] };
  };

  const latest = await latestVersion(tx, input.appealId);
  if (!latest) return refuse("no_letter");
  if (latest.version !== input.version) return refuse("stale", latest.version);
  if (hasUnresolvedPlaceholder(latest.body)) return refuse("unresolved_placeholder", latest.version);

  const context = await loadMergeValues(tx, input.appealId, todayIn(undefined, latest.createdAt));
  if (!context) return { errorKey: "error.notFound" };
  if (context.sensitive) return refuse("sensitive_patient", latest.version);
  const rendered = renderLetter(latest.body, context.values);
  if (rendered.includes(MISSING_VALUE)) return refuse("missing_values", latest.version);
  const digest = letterDigest(rendered);

  const existing = await newestAttestation(tx, input.appealId, latest.version);
  if (existing && existing.renderedSha256 === digest) return refuse("already_attested", latest.version);

  await tx.insert(appealLetterAttestations).values({
    tenantId: auth.tenantId,
    appealId: input.appealId,
    version: latest.version,
    renderedSha256: digest,
    attestedBy: auth.userId,
  });
  await audit(tx, {
    action: "appeal.letter_attested",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal",
    entityId: input.appealId,
    metadata: { version: latest.version },
  });
  return { ok: true };
}

export type ExportRefusal =
  "not_found" | "no_letter" | "not_attested" | "changed_since_review" | "sensitive_patient" | "role";

export type ExportResult =
  | { ok: true; text: string; version: number; attestedBy: string; attestedAt: Date }
  | { ok: false; reason: ExportRefusal };

/**
 * The export gate (R-7.11.2). Returns the rendered letter only when the latest version has an
 * attestation, today's rendering still matches what was attested, and the patient carries no sensitivity
 * marking; otherwise refuses. Either way the outcome is audited (HC-2.4), with IDs and a reason code only.
 */
export async function prepareExport(tx: TenantTx, auth: LetterAuth, appealId: string): Promise<ExportResult> {
  const [appeal] = await tx.select({ id: appeals.id }).from(appeals).where(eq(appeals.id, appealId));
  if (!appeal) return { ok: false, reason: "not_found" };

  const refuse = async (reason: ExportRefusal, version?: number): Promise<ExportResult> => {
    await audit(tx, {
      action: "appeal.letter_export_refused",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "appeal",
      entityId: appealId,
      metadata: version === undefined ? { reason } : { reason, version },
    });
    return { ok: false, reason };
  };

  const latest = await latestVersion(tx, appealId);
  if (!latest) return refuse("no_letter");
  const attestation = await newestAttestation(tx, appealId, latest.version);
  if (!attestation) return refuse("not_attested", latest.version);

  const context = await loadMergeValues(tx, appealId, todayIn(undefined, latest.createdAt));
  if (!context) return refuse("not_found");
  if (context.sensitive) return refuse("sensitive_patient", latest.version);
  const text = renderLetter(latest.body, context.values);
  if (letterDigest(text) !== attestation.renderedSha256)
    return refuse("changed_since_review", latest.version);

  await audit(tx, {
    action: "appeal.letter_exported",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal",
    entityId: appealId,
    metadata: { version: latest.version, attestationId: attestation.id },
  });
  return {
    ok: true,
    text,
    version: latest.version,
    attestedBy: attestation.attestedBy,
    attestedAt: attestation.attestedAt,
  };
}

/** Audits an export attempt by a role that may not export (compliance reads only, R-5.1.2). */
export async function recordExportRoleRefused(
  tx: TenantTx,
  auth: LetterAuth,
  appealId: string,
): Promise<void> {
  await audit(tx, {
    action: "appeal.letter_export_refused",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal",
    entityId: appealId,
    metadata: { reason: "role" },
  });
}

/** Audits opening the letter page (the rendered letter carries PHI). */
export async function recordLetterViewed(
  tx: TenantTx,
  auth: LetterAuth,
  appealId: string,
  version: number | null,
): Promise<void> {
  await audit(tx, {
    action: "appeal.letter_viewed",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal",
    entityId: appealId,
    metadata: version === null ? {} : { version },
  });
}

/** Creates or updates the practice's template for a category. Two creators at once end as create + update. */
export async function saveTemplate(
  tx: TenantTx,
  auth: LetterAuth,
  input: { category: DenialCategory; body: string },
): Promise<{ ok: true; created: boolean } | ServiceError> {
  const check = checkBody(input.body);
  if (!check.ok) return bodyError(check);

  const find = async () => {
    const [row] = await tx
      .select({ id: appealLetterTemplates.id })
      .from(appealLetterTemplates)
      .where(
        and(eq(appealLetterTemplates.category, input.category), eq(appealLetterTemplates.language, "en")),
      )
      .for("update");
    return row;
  };

  let templateId: string;
  let created = false;
  const existing = await find();
  if (existing) {
    templateId = existing.id;
  } else {
    // ON CONFLICT DO NOTHING, not a caught unique violation: an error would abort the transaction.
    const [inserted] = await tx
      .insert(appealLetterTemplates)
      .values({
        tenantId: auth.tenantId,
        category: input.category,
        body: input.body,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .onConflictDoNothing()
      .returning({ id: appealLetterTemplates.id });
    if (inserted) {
      templateId = inserted.id;
      created = true;
    } else {
      // Someone created it between our read and write; fall through to an update.
      const raced = await find();
      if (!raced) return { errorKey: "letter.error.invalidRequest" };
      templateId = raced.id;
    }
  }
  if (!created) {
    await tx
      .update(appealLetterTemplates)
      .set({ body: input.body, updatedBy: auth.userId, updatedAt: new Date() })
      .where(eq(appealLetterTemplates.id, templateId));
  }
  await audit(tx, {
    action: created ? "appeal.template_created" : "appeal.template_updated",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal_letter_template",
    entityId: templateId,
    metadata: { category: input.category },
  });
  return { ok: true, created };
}
