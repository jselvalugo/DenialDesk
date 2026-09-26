"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordProblem } from "@/auth/password";
import { requireOperator } from "@/auth/operator";
import {
  checkAgreementFile,
  recordAgreement as record,
  voidAgreement as markVoid,
  type RecordOutcome,
} from "@/domain/platform/agreements";
import { createPractice as create, PracticeError, setPracticeSuspended } from "@/domain/platform/practices";
import { syntheticDataOnly } from "@/lib/env";

export interface CreateState {
  error?: string;
  created?: { name: string; adminEmail: string; temporaryPassword: string };
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.email().max(254),
});

export async function createPractice(_: CreateState, formData: FormData): Promise<CreateState> {
  const operator = await requireOperator();
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
  });
  if (!parsed.success) return { error: "Enter a practice name, the admin's name, and a valid email." };
  try {
    const { temporaryPassword } = await create(parsed.data, operator);
    if (passwordProblem(temporaryPassword)) throw new Error("Generated password failed policy");
    revalidatePath("/operator");
    return { created: { name: parsed.data.name, adminEmail: parsed.data.adminEmail, temporaryPassword } };
  } catch (error) {
    if (error instanceof PracticeError) return { error: error.message };
    throw error;
  }
}

export interface ActionState {
  error?: string;
}

export async function toggleSuspended(_: ActionState, formData: FormData): Promise<ActionState> {
  const operator = await requireOperator();
  const parsed = z
    .object({ tenantId: z.uuid(), suspend: z.enum(["true", "false"]) })
    .safeParse({ tenantId: formData.get("tenantId"), suspend: formData.get("suspend") });
  if (!parsed.success) return { error: "Invalid request." };
  try {
    await setPracticeSuspended(parsed.data.tenantId, parsed.data.suspend === "true", operator);
  } catch (error) {
    if (error instanceof PracticeError) return { error: error.message };
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
    return { error: "Enter the effective and signed dates and both signers." };
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose the signed agreement as a PDF file." };
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
  if (!check.ok) return { error: check.error };
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
    if (error instanceof PracticeError) return { error: error.message };
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
  const parsed = z
    .object({ tenantId: z.uuid(), agreementId: z.uuid(), reason: z.string().trim().min(5).max(500) })
    .safeParse({
      tenantId: formData.get("tenantId"),
      agreementId: formData.get("agreementId"),
      reason: formData.get("reason"),
    });
  if (!parsed.success) return { error: "Choose the agreement and say why it was recorded in error." };
  try {
    await markVoid(parsed.data, operator);
  } catch (error) {
    if (error instanceof PracticeError) return { error: error.message };
    throw error;
  }
  revalidatePath("/operator");
  revalidatePath(`/operator/practices/${parsed.data.tenantId}`);
  return { voided: true };
}
