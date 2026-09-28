"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { hasRecentMfa, requireAuth } from "@/auth/session";
import { isDatabaseError } from "@/db/errors";
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
import { getLocale, getT } from "@/i18n/server";
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";
import { serverEnv, syntheticDataOnly } from "@/lib/env";

export interface IntegrationFormState {
  error?: string;
  field?: string;
  /** The only thing missing was a recent MFA verification: the UI offers a step-up link. */
  stepUpRequired?: boolean;
}

type SettingsT = Translator<Messages["settings"]>;

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

/**
 * `ConnectionError` (a refusal the domain layer means the admin to see) is shown as-is; anything
 * else — a unique-violation race against the DB's own partial unique index, a trigger refusal, or
 * any other sanitized database error (security review PR #81, item 4) — becomes one generic,
 * translated message instead of an unhandled error reaching Next's error boundary (or, worse, a
 * raw database message). A truly unexpected (non-database) error is still rethrown.
 */
function failure(error: unknown, t: SettingsT): IntegrationFormState {
  if (error instanceof ConnectionError) {
    return { error: error.message, field: error.field, stepUpRequired: error.stepUpRequired };
  }
  if (isDatabaseError(error)) {
    return { error: t("integrations.error.unexpected") };
  }
  throw error;
}

/** Every gated action shares this shape; `locale` is only meaningful when an attestation is set. */
async function actorFrom(auth: { tenantId: string; userId: string; mfaVerifiedAt: Date | null }) {
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    recentMfa: hasRecentMfa(auth.mfaVerifiedAt),
    locale: await getLocale(),
  };
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
    const actor = await actorFrom(auth);
    ({ id } = await withTenant(auth, (tx) =>
      createConnection(
        tx,
        actor,
        parsed.data,
        { syntheticOnly: syntheticDataOnly() },
        serverEnv().INTEGRATION_ALLOWED_PORTS,
        t,
      ),
    ));
  } catch (error) {
    return failure(error, t);
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
    const actor = await actorFrom(auth);
    await withTenant(auth, (tx) =>
      updateConnection(
        tx,
        actor,
        id.data,
        parsed.data,
        { syntheticOnly: syntheticDataOnly() },
        serverEnv().INTEGRATION_ALLOWED_PORTS,
        t,
      ),
    );
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath(`/settings/integrations/${id.data}`);
  redirect(`/settings/integrations/${id.data}`);
}

function connectionId(formData: FormData): { ok: true; id: string } | { ok: false } {
  const parsed = uuid.safeParse(text(formData, "connectionId", 100));
  return parsed.success ? { ok: true, id: parsed.data } : { ok: false };
}

export async function withdrawConnectionAction(
  _: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canManageIntegrations(auth.role)) return { error: t("integrations.error.notAdmin") };
  const id = connectionId(formData);
  if (!id.ok) return { error: t("integrations.error.notFound") };
  try {
    const actor = await actorFrom(auth);
    await withTenant(auth, (tx) =>
      withdrawConnection(tx, actor, id.id, { syntheticOnly: syntheticDataOnly() }, t),
    );
  } catch (error) {
    return failure(error, t);
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
  if (!id.ok) return { error: t("integrations.error.notFound") };
  try {
    const actor = await actorFrom(auth);
    await withTenant(auth, (tx) =>
      pauseConnection(tx, actor, id.id, { syntheticOnly: syntheticDataOnly() }, t),
    );
  } catch (error) {
    return failure(error, t);
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
  if (!id.ok) return { error: t("integrations.error.notFound") };
  try {
    const actor = await actorFrom(auth);
    await withTenant(auth, (tx) =>
      resumeConnection(tx, actor, id.id, { syntheticOnly: syntheticDataOnly() }, t),
    );
  } catch (error) {
    return failure(error, t);
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
  if (!id.ok) return { error: t("integrations.error.notFound") };
  const reason = text(formData, "reasonCode", 40);
  if (!REASON_CODES.has(reason)) {
    return { error: t("integrations.error.chooseReason"), field: "reasonCode" };
  }
  try {
    const actor = await actorFrom(auth);
    await withTenant(auth, (tx) =>
      revokeConnection(
        tx,
        actor,
        id.id,
        reason as RevokeReasonCode,
        { syntheticOnly: syntheticDataOnly() },
        t,
      ),
    );
  } catch (error) {
    return failure(error, t);
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
  if (!id.ok) return { error: t("integrations.error.notFound") };
  try {
    const actor = await actorFrom(auth);
    await withTenant(auth, (tx) =>
      activateSandboxConnection(tx, actor, id.id, { syntheticOnly: syntheticDataOnly() }, t),
    );
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath(`/settings/integrations/${id.id}`);
  revalidatePath("/patients");
  return {};
}
