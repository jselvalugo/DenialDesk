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
  checkBody,
  hasUnresolvedPlaceholder,
  letterDigest,
  renderLetter,
  type BodyCheck,
} from "./merge-fields";

// Appeal letter writes and the export gate (docs/specs/appeals.md A2). Pure domain code: no auth, no
// form parsing, no Next.js, no translation. Errors come back as message keys for the caller to translate.
// Audit rows carry IDs, version numbers, and reason codes only, never letter text or field values.

export interface LetterAuth {
  tenantId: string;
  userId: string;
}

export interface ServiceError {
  errorKey: MessageKey<"appeals">;
  params?: Params;
}

/** A letter can be started or changed until the appeal is submitted. */
const EDITABLE_STATUSES = ["draft", "in_review", "ready"];

export function bodyError(check: Exclude<BodyCheck, { ok: true }>): ServiceError {
  switch (check.reason) {
    case "empty":
      return { errorKey: "letter.error.empty" };
    case "too_long":
      return { errorKey: "letter.error.tooLong" };
    case "malformed":
      return { errorKey: "letter.error.malformed" };
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

/**
 * Records that the signed-in user reviewed this version of the letter (R-7.11.2). Only the latest
 * version can be attested, and never one that still holds a VERIFY / FILL IN placeholder.
 */
export async function attestLetter(
  tx: TenantTx,
  auth: LetterAuth,
  input: { appealId: string; version: number },
): Promise<{ ok: true } | ServiceError> {
  const appeal = await lockAppeal(tx, input.appealId);
  if (!appeal) return { errorKey: "error.notFound" };
  if (!EDITABLE_STATUSES.includes(appeal.status)) return { errorKey: "letter.error.locked" };

  const latest = await latestVersion(tx, input.appealId);
  if (!latest) return { errorKey: "letter.error.noLetter" };
  if (latest.version !== input.version) return { errorKey: "letter.error.stale" };
  if (hasUnresolvedPlaceholder(latest.body)) return { errorKey: "letter.error.unresolvedPlaceholder" };

  const [existing] = await tx
    .select({ id: appealLetterAttestations.id })
    .from(appealLetterAttestations)
    .where(
      and(
        eq(appealLetterAttestations.appealId, input.appealId),
        eq(appealLetterAttestations.version, latest.version),
      ),
    )
    .limit(1);
  if (existing) return { errorKey: "letter.error.alreadyAttested" };

  const context = await loadMergeValues(tx, input.appealId, todayIn(undefined, latest.createdAt));
  if (!context) return { errorKey: "error.notFound" };
  const digest = letterDigest(renderLetter(latest.body, context.values));

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

export type ExportRefusal = "not_found" | "no_letter" | "not_attested" | "changed_since_review";

export type ExportResult =
  | { ok: true; text: string; version: number; attestedBy: string; attestedAt: Date }
  | { ok: false; reason: ExportRefusal };

/**
 * The export gate (R-7.11.2). Returns the rendered letter only when the latest version has an
 * attestation and today's rendering still matches what was attested; otherwise refuses. Either way
 * the outcome is audited (HC-2.4), with IDs and a reason code only.
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
  const [attestation] = await tx
    .select({
      renderedSha256: appealLetterAttestations.renderedSha256,
      attestedAt: appealLetterAttestations.attestedAt,
      attestedBy: users.displayName,
    })
    .from(appealLetterAttestations)
    .innerJoin(users, eq(users.id, appealLetterAttestations.attestedBy))
    .where(
      and(
        eq(appealLetterAttestations.appealId, appealId),
        eq(appealLetterAttestations.version, latest.version),
      ),
    )
    .limit(1);
  if (!attestation) return refuse("not_attested", latest.version);

  const context = await loadMergeValues(tx, appealId, todayIn(undefined, latest.createdAt));
  if (!context) return refuse("not_found");
  const text = renderLetter(latest.body, context.values);
  if (letterDigest(text) !== attestation.renderedSha256)
    return refuse("changed_since_review", latest.version);

  await audit(tx, {
    action: "appeal.letter_exported",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal",
    entityId: appealId,
    metadata: { version: latest.version },
  });
  return {
    ok: true,
    text,
    version: latest.version,
    attestedBy: attestation.attestedBy,
    attestedAt: attestation.attestedAt,
  };
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

/** Creates or updates the practice's template for a category. */
export async function saveTemplate(
  tx: TenantTx,
  auth: LetterAuth,
  input: { category: DenialCategory; body: string },
): Promise<{ ok: true; created: boolean } | ServiceError> {
  const check = checkBody(input.body);
  if (!check.ok) return bodyError(check);

  const [existing] = await tx
    .select({ id: appealLetterTemplates.id })
    .from(appealLetterTemplates)
    .where(and(eq(appealLetterTemplates.category, input.category), eq(appealLetterTemplates.language, "en")))
    .for("update");
  let templateId: string;
  if (existing) {
    templateId = existing.id;
    await tx
      .update(appealLetterTemplates)
      .set({ body: input.body, updatedBy: auth.userId, updatedAt: new Date() })
      .where(eq(appealLetterTemplates.id, existing.id));
  } else {
    const [inserted] = await tx
      .insert(appealLetterTemplates)
      .values({
        tenantId: auth.tenantId,
        category: input.category,
        body: input.body,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .returning({ id: appealLetterTemplates.id });
    templateId = inserted!.id;
  }
  await audit(tx, {
    action: existing ? "appeal.template_updated" : "appeal.template_created",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal_letter_template",
    entityId: templateId,
    metadata: { category: input.category },
  });
  return { ok: true, created: !existing };
}
