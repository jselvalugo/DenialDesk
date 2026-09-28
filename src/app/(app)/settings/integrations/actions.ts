"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import {
  createConnection,
  createSandboxConnection,
  getConnection,
  pauseConnection,
  resumeConnection,
  revokeConnection,
  submitConnection,
  updateConnection,
  withdrawConnection,
  type IntegrationActor,
} from "@/domain/integrations/connections";
import { testConnection } from "@/domain/integrations/test-connection";
import type { TenantTx } from "@/db/tenant";
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";
import { isRevokeReasonCode } from "@/domain/integrations/revoke-reasons";
import { getLocale, getT } from "@/i18n/server";
import {
  connectionFormFailure,
  integrationActor,
  testConnectionFailure,
  type ConnectionFormState,
  type TestConnectionState,
} from "./form-state";
import { connectionTestDeps } from "./test-deps";

// Settings › Integrations (docs/specs/patient-integrations.md PI1b-2). Every action re-checks the
// role on the server (menu and page visibility are not access control); the domain checks it again.

const uuid = z.uuid();

function text(formData: FormData, name: string, max: number): string {
  return String(formData.get(name) ?? "").slice(0, max);
}

/** Only fields the form actually sent: a disabled (locked) input is absent, not blank. */
function sentEndpointFields(formData: FormData) {
  const fields: Record<string, string> = { displayName: text(formData, "displayName", 400) };
  for (const [name, max] of [
    ["baseUrl", 2200],
    ["clientId", 400],
    ["mrnIdentifierSystem", 400],
  ] as const) {
    if (formData.has(name)) fields[name] = text(formData, name, max);
  }
  return fields;
}

export async function createConnectionAction(
  _: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const actor = integrationActor(auth);
  let id: string;
  try {
    ({ id } = await withTenant(auth, (tx) =>
      actor.syntheticOnly
        ? createSandboxConnection(tx, actor, { displayName: text(formData, "displayName", 400) }, t)
        : createConnection(tx, actor, sentEndpointFields(formData), t),
    ));
  } catch (error) {
    return connectionFormFailure(error, t);
  }
  // The whole signed-in layout: the tab-bar data-source drop-down reads the connection too.
  revalidatePath("/", "layout");
  redirect(`/settings/integrations/${id}`);
}

export async function updateConnectionAction(
  _: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id", 40));
  if (!id.success) return { error: t("error.notFound") };
  const actor = integrationActor(auth);
  try {
    await withTenant(auth, async (tx) => {
      const current = await getConnection(tx, id.data);
      // The sandbox takes a name only; sending anything else would be refused by the allow-list.
      // Read before the domain locks the row: safe because `is_sandbox` can never change (trigger
      // integration_connections_lifecycle), and updateConnection re-reads it FOR UPDATE anyway.
      const input = current?.isSandbox
        ? { displayName: text(formData, "displayName", 400) }
        : sentEndpointFields(formData);
      await updateConnection(tx, actor, id.data, text(formData, "updatedAt", 40), input, t);
    });
  } catch (error) {
    return connectionFormFailure(error, t);
  }
  // The whole signed-in layout: the tab-bar data-source drop-down reads the connection too.
  revalidatePath("/", "layout");
  redirect(`/settings/integrations/${id.data}`);
}

/**
 * Test connection (spec PI2a): discovery plus one token request, no patient data. Admin only,
 * re-checked here and in the domain. The domain does the network calls with no transaction open,
 * rate-limits per connection and per practice, and audits. Nothing the remote server sent is returned.
 */
export async function testConnectionAction(
  _: TestConnectionState,
  formData: FormData,
): Promise<TestConnectionState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id", 40));
  if (!id.success) return { error: t("error.notFound") };
  const actor = integrationActor(auth);
  try {
    const result = await testConnection(
      (fn) => withTenant(auth, fn),
      actor,
      id.data,
      connectionTestDeps(),
      t,
    );
    // A passing test pins the token endpoint and issuer on a draft: the page shows them.
    revalidatePath(`/settings/integrations/${id.data}`);
    return result;
  } catch (error) {
    return testConnectionFailure(error, t);
  }
}

export async function revokeConnectionAction(
  _: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id", 40));
  if (!id.success) return { error: t("error.notFound") };
  // The reason is a code from a fixed vocabulary (the domain refuses anything else), checked before
  // the acknowledgement so the first thing missing is the first thing reported.
  const reason = text(formData, "reason", 64);
  if (!isRevokeReasonCode(reason)) return { error: t("error.revokeReasonRequired"), field: "reason" };
  // Inline confirmation (DESIGN.md §3), checked on the server too.
  if (formData.get("confirm") !== "on") return { error: t("error.confirmRevoke"), field: "confirm" };
  const actor = integrationActor(auth);
  try {
    await withTenant(auth, (tx) =>
      revokeConnection(tx, actor, id.data, text(formData, "updatedAt", 40), reason, t),
    );
  } catch (error) {
    return connectionFormFailure(error, t);
  }
  // The whole signed-in layout: the tab-bar data-source drop-down reads the connection too.
  revalidatePath("/", "layout");
  redirect(`/settings/integrations/${id.data}`);
}

type Transition = (
  tx: TenantTx,
  actor: IntegrationActor,
  id: string,
  expectedUpdatedAt: string,
  t: Translator<Messages["integrations"]>,
) => Promise<void>;

/** Pause, resume, and withdraw share everything but the domain call: admin, id, actor, refusals. */
async function transitionAction(formData: FormData, run: Transition): Promise<ConnectionFormState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id", 40));
  if (!id.success) return { error: t("error.notFound") };
  const actor = integrationActor(auth);
  try {
    await withTenant(auth, (tx) => run(tx, actor, id.data, text(formData, "updatedAt", 40), t));
  } catch (error) {
    return connectionFormFailure(error, t);
  }
  revalidatePath("/", "layout");
  redirect(`/settings/integrations/${id.data}`);
}

/** Pause an active connection (PI2a). */
export async function pauseConnectionAction(
  _: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  return transitionAction(formData, pauseConnection);
}

/**
 * Resume a paused or errored connection; refused without a step-up in the last five minutes
 * (R-7.2.2), and from `error` also without a passing Test connection (spec PI2a).
 */
export async function resumeConnectionAction(
  _: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  return transitionAction(formData, (tx, actor, id, expectedUpdatedAt, t) =>
    resumeConnection(tx, actor, id, expectedUpdatedAt, t, connectionTestDeps()),
  );
}

/**
 * Submit a draft (spec PI2a): a real connection goes to DenialDesk for approval, the sandbox
 * activates. Admin only, re-checked here and in the domain. The attestation checkbox is read on the
 * server, the language it was shown in comes from the request, and the step-up and the passing test
 * are checked by the domain in the transaction that changes the status.
 */
export async function submitConnectionAction(
  _: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id", 40));
  if (!id.success) return { error: t("error.notFound") };
  const actor = integrationActor(auth);
  try {
    await submitConnection(
      (fn) => withTenant(auth, fn),
      actor,
      id.data,
      text(formData, "updatedAt", 40),
      { attested: formData.get("attest") === "on", locale: await getLocale() },
      connectionTestDeps(),
      t,
    );
  } catch (error) {
    return connectionFormFailure(error, t);
  }
  revalidatePath("/", "layout");
  redirect(`/settings/integrations/${id.data}`);
}

/** Withdraw a connection awaiting approval, back to a draft (PI2a). */
export async function withdrawConnectionAction(
  _: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  return transitionAction(formData, withdrawConnection);
}
