"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { passwordProblem } from "@/auth/password";
import { requireOperator } from "@/auth/operator";
import { approveConnection, rejectConnection } from "@/domain/integrations/approval";
import {
  checkAgreementFile,
  recordAgreement as record,
  voidAgreement as markVoid,
  type RecordOutcome,
} from "@/domain/platform/agreements";
import { createPractice as create, PracticeError, setPracticeSuspended } from "@/domain/platform/practices";
import { grantUniversityAccess, revokeUniversityAccess } from "@/domain/platform/university-access";
import { getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";

export interface CreateState {
  error?: string;
  created?: { tenantId: string; name: string; adminEmail: string; temporaryPassword: string };
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.email().max(254),
});

export async function createPractice(_: CreateState, formData: FormData): Promise<CreateState> {
  const operator = await requireOperator();
  const t = await getT("operator");
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
  });
  if (!parsed.success) return { error: t("errors.createFormInvalid") };
  try {
    const { tenantId, temporaryPassword } = await create(parsed.data, operator);
    if (passwordProblem(temporaryPassword)) throw new Error("Generated password failed policy");
    revalidatePath("/operator");
    return {
      created: { tenantId, name: parsed.data.name, adminEmail: parsed.data.adminEmail, temporaryPassword },
    };
  } catch (error) {
    if (error instanceof PracticeError) return { error: t(error.key, error.params) };
    throw error;
  }
}

export interface ActionState {
  error?: string;
}

export async function toggleSuspended(_: ActionState, formData: FormData): Promise<ActionState> {
  const operator = await requireOperator();
  const t = await getT("operator");
  const parsed = z
    .object({ tenantId: z.uuid(), suspend: z.enum(["true", "false"]) })
    .safeParse({ tenantId: formData.get("tenantId"), suspend: formData.get("suspend") });
  if (!parsed.success) return { error: t("errors.invalidRequest") };
  try {
    await setPracticeSuspended(parsed.data.tenantId, parsed.data.suspend === "true", operator);
  } catch (error) {
    if (error instanceof PracticeError) return { error: t(error.key, error.params) };
    throw error;
  }
  revalidatePath("/operator");
  return {};
}

export interface RecordAgreementState {
  error?: string;
  recorded?: { filename: string; outcome: RecordOutcome; supersededPrevious: boolean };
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const agreementSchema = z.object({
  tenantId: z.uuid(),
  effectiveDate: z.iso.date(),
  expiresOn: z.union([z.literal(""), z.iso.date()]).transform((v) => (v === "" ? null : v)),
  signedOn: z.iso.date(),
  practiceSigner: z.string().trim().min(2).max(160),
  ourSigner: z.string().trim().min(2).max(160),
  note: optionalText(500),
});

/** Records a signed BAA (docs/specs/practice-agreements.md). The file is validated in memory. */
export async function recordAgreement(
  _: RecordAgreementState,
  formData: FormData,
): Promise<RecordAgreementState> {
  const operator = await requireOperator();
  const t = await getT("operator");
  const parsed = agreementSchema.safeParse({
    tenantId: formData.get("tenantId"),
    effectiveDate: formData.get("effectiveDate"),
    expiresOn: formData.get("expiresOn") ?? "",
    signedOn: formData.get("signedOn"),
    practiceSigner: formData.get("practiceSigner"),
    ourSigner: formData.get("ourSigner"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { error: t("errors.agreementFormInvalid") };
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: t("errors.chooseFile") };
  const syntheticOnly = syntheticDataOnly();
  const attestedSynthetic = formData.get("syntheticAttestation") === "on";
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const check = checkAgreementFile({
    name: file.name,
    size: file.size,
    head,
    syntheticOnly,
    attestedSynthetic,
  });
  if (!check.ok) return { error: t(check.error, check.params) };
  try {
    const { supersededId, outcome } = await record(
      {
        ...parsed.data,
        filename: file.name,
        content: Buffer.from(await file.arrayBuffer()),
        attestedSynthetic,
      },
      operator,
      { syntheticOnly },
    );
    revalidatePath("/operator");
    revalidatePath(`/operator/practices/${parsed.data.tenantId}`);
    return { recorded: { filename: file.name, outcome, supersededPrevious: supersededId !== null } };
  } catch (error) {
    if (error instanceof PracticeError) return { error: t(error.key, error.params) };
    throw error;
  }
}

export interface VoidAgreementState {
  error?: string;
  voided?: true;
}

/** Marks an agreement as recorded in error (kept on file, no longer counted). */
export async function voidAgreement(_: VoidAgreementState, formData: FormData): Promise<VoidAgreementState> {
  const operator = await requireOperator();
  const t = await getT("operator");
  const parsed = z
    .object({ tenantId: z.uuid(), agreementId: z.uuid(), reason: z.string().trim().min(5).max(500) })
    .safeParse({
      tenantId: formData.get("tenantId"),
      agreementId: formData.get("agreementId"),
      reason: formData.get("reason"),
    });
  if (!parsed.success) return { error: t("errors.voidFormInvalid") };
  try {
    await markVoid(parsed.data, operator);
  } catch (error) {
    if (error instanceof PracticeError) return { error: t(error.key, error.params) };
    throw error;
  }
  revalidatePath("/operator");
  revalidatePath(`/operator/practices/${parsed.data.tenantId}`);
  return { voided: true };
}

export interface UniversityAccessState {
  error?: string;
  granted?: true;
  revoked?: true;
}

/** Records that the practice bought DenialDesk University access (spec: denialdesk-university.md, "Access"). */
export async function grantUniversity(
  _: UniversityAccessState,
  formData: FormData,
): Promise<UniversityAccessState> {
  const operator = await requireOperator();
  const t = await getT("operator");
  const parsed = z
    .object({ tenantId: z.uuid(), note: z.string().trim().max(200).optional() })
    .safeParse({ tenantId: formData.get("tenantId"), note: formData.get("note") ?? undefined });
  if (!parsed.success) return { error: t("errors.universityFormInvalid") };
  try {
    await grantUniversityAccess({ tenantId: parsed.data.tenantId, note: parsed.data.note ?? null }, operator);
  } catch (error) {
    if (error instanceof PracticeError) return { error: t(error.key, error.params) };
    throw error;
  }
  revalidatePath(`/operator/practices/${parsed.data.tenantId}`);
  return { granted: true };
}

/** Ends the practice's University access, with a reason kept on the record. */
export async function revokeUniversity(
  _: UniversityAccessState,
  formData: FormData,
): Promise<UniversityAccessState> {
  const operator = await requireOperator();
  const t = await getT("operator");
  const parsed = z
    .object({ tenantId: z.uuid(), reason: z.string().trim().min(5).max(500) })
    .safeParse({ tenantId: formData.get("tenantId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: t("errors.universityRevokeReasonTooShort") };
  try {
    await revokeUniversityAccess(parsed.data, operator);
  } catch (error) {
    if (error instanceof PracticeError) return { error: t(error.key, error.params) };
    throw error;
  }
  revalidatePath(`/operator/practices/${parsed.data.tenantId}`);
  return { revoked: true };
}

export interface IntegrationDecisionState {
  error?: string;
}

/** A form field as the server reads it: text only, capped, so nothing large reaches the domain. */
function field(formData: FormData, name: string, max: number): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

const decisionIds = z.object({ tenantId: z.uuid(), connectionId: z.uuid() });

/**
 * Approves a submitted EHR/PM connection (docs/specs/patient-integrations.md PI1c). The operator
 * session is required first (a practice session, an administrator's included, is never accepted);
 * the domain then checks the operator again, the practice, the connection's state and version, and
 * the registry claim. The checkboxes count only as `on`. Success goes back to the queue.
 */
export async function approveIntegration(
  _: IntegrationDecisionState,
  formData: FormData,
): Promise<IntegrationDecisionState> {
  const operator = await requireOperator();
  const t = await getT("operator");
  const ids = decisionIds.safeParse({
    tenantId: field(formData, "tenantId", 40),
    connectionId: field(formData, "connectionId", 40),
  });
  if (!ids.success) return { error: t("errors.invalidRequest") };
  try {
    await approveConnection(
      {
        ...ids.data,
        expectedUpdatedAt: field(formData, "updatedAt", 40),
        methodCode: field(formData, "methodCode", 64),
        verifiedOn: field(formData, "verifiedOn", 32),
        contactRole: field(formData, "contactRole", 64),
        populationScope: field(formData, "populationScope", 64),
        mrnNineDigitsVerified: formData.get("mrnNineDigits") === "on",
        clientIdOwnershipVerified: formData.get("clientIdOwnership") === "on",
      },
      operator,
    );
  } catch (error) {
    if (error instanceof PracticeError) return { error: t(error.key, error.params) };
    throw error;
  }
  revalidatePath("/operator/integrations");
  revalidatePath(`/operator/practices/${ids.data.tenantId}`);
  // The practice's own signed-in pages show the connection's status (drop-down, Settings).
  revalidatePath("/", "layout");
  redirect("/operator/integrations?decided=approved");
}

/** Rejects a submitted connection with a reason code: back to draft, registry claim released. */
export async function rejectIntegration(
  _: IntegrationDecisionState,
  formData: FormData,
): Promise<IntegrationDecisionState> {
  const operator = await requireOperator();
  const t = await getT("operator");
  const ids = decisionIds.safeParse({
    tenantId: field(formData, "tenantId", 40),
    connectionId: field(formData, "connectionId", 40),
  });
  if (!ids.success) return { error: t("errors.invalidRequest") };
  try {
    await rejectConnection(
      {
        ...ids.data,
        expectedUpdatedAt: field(formData, "updatedAt", 40),
        reasonCode: field(formData, "reasonCode", 64),
      },
      operator,
    );
  } catch (error) {
    if (error instanceof PracticeError) return { error: t(error.key, error.params) };
    throw error;
  }
  revalidatePath("/operator/integrations");
  revalidatePath(`/operator/practices/${ids.data.tenantId}`);
  revalidatePath("/", "layout");
  redirect("/operator/integrations?decided=rejected");
}
