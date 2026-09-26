"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordProblem } from "@/auth/password";
import { requireOperator } from "@/auth/operator";
import {
  createPractice as create,
  PracticeError,
  resetDemoPractice as reset,
  setPracticeSuspended,
} from "@/domain/platform/practices";

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

export async function resetDemo(): Promise<ActionState> {
  const operator = await requireOperator();
  try {
    await reset(operator);
  } catch (error) {
    if (error instanceof PracticeError) return { error: error.message };
    throw error;
  }
  revalidatePath("/operator");
  return {};
}
