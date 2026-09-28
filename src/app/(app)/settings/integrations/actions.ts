"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { hasRecentMfa, requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import {
  activateSandboxConnection,
  ConnectionError,
  createConnection,
  parseConnectionInput,
  pauseConnection,
  resumeConnection,
  revokeConnection,
  REVOKE_REASON_CODES,
  updateConnection,
  withdrawConnection,
  type RevokeReasonCode,
} from "@/domain/integrations/connections";
import { getT } from "@/i18n/server";
import { serverEnv, syntheticDataOnly } from "@/lib/env";

export interface IntegrationFormState {
  error?: string;
  field?: string;
  /** The only thing missing was a recent MFA verification: the UI offers a step-up link. */
  stepUpRequired?: boolean;
}

const uuid = z.uuid();

function text(formData: FormData, name: string, max = 2048): string {
  return String(formData.get(name) ?? "").slice(0, max);
}

function readConnectionInput(formData: FormData) {
  return {
    displayName: text(formData, "displayName", 200),
    baseUrl: text(formData, "baseUrl", 2048),
    clientId: text(formData, "clientId", 400),
    mrnIdentifierSystem: text(formData, "mrnIdentifierSystem", 400),
    usResidencyAttested: formData.get("usResidencyAttested") === "on",
  };
}

function failure(error: unknown): IntegrationFormState {
  if (error instanceof ConnectionError) {
    return { error: error.message, field: error.field, stepUpRequired: error.stepUpRequired };
  }
  throw error;
}

export async function createConnectionAction(
  _: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canManageIntegrations(auth.role)) return { error: t("integrations.error.notAdmin") };
  const parsed = parseConnectionInput(readConnectionInput(formData), t);
  if ("error" in parsed) return parsed.error;

  let id: string;
  try {
    ({ id } = await withTenant(auth, (tx) =>
      createConnection(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, recentMfa: hasRecentMfa(auth.mfaVerifiedAt) },
        parsed.data,
        { syntheticOnly: syntheticDataOnly() },
        serverEnv().INTEGRATION_ALLOWED_PORTS,
        t,
      ),
    ));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/settings/integrations");
  redirect(`/settings/integrations/${id}`);
}

export async function updateConnectionAction(
  _: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canManageIntegrations(auth.role)) return { error: t("integrations.error.notAdmin") };
  const id = uuid.safeParse(text(formData, "connectionId", 100));
  if (!id.success) return { error: t("integrations.error.notFound") };
  const parsed = parseConnectionInput(readConnectionInput(formData), t);
  if ("error" in parsed) return parsed.error;

  try {
    await withTenant(auth, (tx) =>
      updateConnection(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, recentMfa: hasRecentMfa(auth.mfaVerifiedAt) },
        id.data,
        parsed.data,
        { syntheticOnly: syntheticDataOnly() },
        serverEnv().INTEGRATION_ALLOWED_PORTS,
        t,
      ),
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/settings/integrations/${id.data}`);
  redirect(`/settings/integrations/${id.data}`);
}

function connectionId(formData: FormData): { id: string } | { error: string } {
  const parsed = uuid.safeParse(text(formData, "connectionId", 100));
  return parsed.success ? { id: parsed.data } : { error: "not_found" };
}

export async function withdrawConnectionAction(
  _: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canManageIntegrations(auth.role)) return { error: t("integrations.error.notAdmin") };
  const id = connectionId(formData);
  if ("error" in id) return { error: t("integrations.error.notFound") };
  try {
    await withTenant(auth, (tx) =>
      withdrawConnection(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, recentMfa: hasRecentMfa(auth.mfaVerifiedAt) },
        id.id,
        t,
      ),
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/settings/integrations/${id.id}`);
  return {};
}

export async function pauseConnectionAction(
  _: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canManageIntegrations(auth.role)) return { error: t("integrations.error.notAdmin") };
  const id = connectionId(formData);
  if ("error" in id) return { error: t("integrations.error.notFound") };
  try {
    await withTenant(auth, (tx) =>
      pauseConnection(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, recentMfa: hasRecentMfa(auth.mfaVerifiedAt) },
        id.id,
        t,
      ),
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/settings/integrations/${id.id}`);
  revalidatePath("/patients");
  return {};
}

export async function resumeConnectionAction(
  _: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canManageIntegrations(auth.role)) return { error: t("integrations.error.notAdmin") };
  const id = connectionId(formData);
  if ("error" in id) return { error: t("integrations.error.notFound") };
  try {
    await withTenant(auth, (tx) =>
      resumeConnection(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, recentMfa: hasRecentMfa(auth.mfaVerifiedAt) },
        id.id,
        t,
      ),
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/settings/integrations/${id.id}`);
  revalidatePath("/patients");
  return {};
}

const REASON_CODES = new Set<string>(REVOKE_REASON_CODES);

export async function revokeConnectionAction(
  _: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canManageIntegrations(auth.role)) return { error: t("integrations.error.notAdmin") };
  const id = connectionId(formData);
  if ("error" in id) return { error: t("integrations.error.notFound") };
  const reason = text(formData, "reasonCode", 40);
  if (!REASON_CODES.has(reason)) {
    return { error: t("integrations.error.chooseReason"), field: "reasonCode" };
  }
  try {
    await withTenant(auth, (tx) =>
      revokeConnection(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, recentMfa: hasRecentMfa(auth.mfaVerifiedAt) },
        id.id,
        reason as RevokeReasonCode,
        t,
      ),
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/settings/integrations/${id.id}`);
  revalidatePath("/patients");
  return {};
}

export async function activateSandboxAction(
  _: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canManageIntegrations(auth.role)) return { error: t("integrations.error.notAdmin") };
  const id = connectionId(formData);
  if ("error" in id) return { error: t("integrations.error.notFound") };
  try {
    await withTenant(auth, (tx) =>
      activateSandboxConnection(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, recentMfa: hasRecentMfa(auth.mfaVerifiedAt) },
        id.id,
        { syntheticOnly: syntheticDataOnly() },
        t,
      ),
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/settings/integrations/${id.id}`);
  revalidatePath("/patients");
  return {};
}
