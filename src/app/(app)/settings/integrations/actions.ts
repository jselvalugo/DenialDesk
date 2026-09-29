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
  US_RESIDENCY_ATTESTATION_VERSION,
  withdrawConnection,
  resolveSigningKid,
  type IntegrationActor,
  type ResolvedSigningKid,
} from "@/domain/integrations/connections";
import { syncNow, syncResultMessage } from "@/domain/integrations/sync";
import { testConnection } from "@/domain/integrations/test-connection";
import type { TenantTx } from "@/db/tenant";
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";
import { isRevokeReasonCode } from "@/domain/integrations/revoke-reasons";
import { getLocale, getT } from "@/i18n/server";
import {
  connectionFormFailure,
  integrationActor,
  syncNowFailure,
  testConnectionFailure,
  type ConnectionFormState,
  type SyncNowState,
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

/**
 * Sync now (spec PI2b): queues a run and executes it in this request (background jobs are a later
 * slice). Admin only, re-checked here and in the domain; the environment rule, the once-a-minute limit
 * and the one-run-at-a-time rule are the domain's. A run-level failure is a result shown as text, not
 * an error page; nothing the remote server sent is returned.
 */
export async function syncNowAction(_: SyncNowState, formData: FormData): Promise<SyncNowState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id", 40));
  if (!id.success) return { error: t("error.notFound") };
  const actor = integrationActor(auth);
  try {
    const result = await syncNow((fn) => withTenant(auth, fn), actor, id.data, connectionTestDeps(), t);
    // The page and the tab-bar drop-down show the last sync time and the state.
    revalidatePath("/", "layout");
    return { status: result.status, message: syncResultMessage(result, t) };
  } catch (error) {
    return syncNowFailure(error, t);
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
  signing: ResolvedSigningKid,
) => Promise<void>;

/**
 * Pause, resume, and withdraw share everything but the domain call: admin, id, actor, refusals. The
 * live signing key's `kid` (public material only) is resolved here, before the transaction and its
 * row lock, for the transition that needs it (resume from `error`).
 */
async function transitionAction(
  formData: FormData,
  run: Transition,
  needsKey = false,
): Promise<ConnectionFormState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id", 40));
  if (!id.success) return { error: t("error.notFound") };
  const actor = integrationActor(auth);
  try {
    const signing = needsKey
      ? await resolveSigningKid(connectionTestDeps(), id.data)
      : { kid: null, refusal: null };
    await withTenant(auth, (tx) => run(tx, actor, id.data, text(formData, "updatedAt", 40), t, signing));
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
  return transitionAction(formData, resumeConnection, true);
}

/**
 * Submit a draft (spec PI2a): a real connection goes to DenialDesk for approval, the sandbox
 * activates. Admin only, re-checked here and in the domain. The attestation checkbox is read on the
 * server, together with the language the form displayed it in and the wording's version: a form
 * whose language no longer matches the request's (the language was switched in another tab, say), or
 * whose version is no longer the current one, is refused, so the wording an administrator agrees to
 * is always the wording recorded. The step-up and the passing test are
 * checked by the domain in the transaction that changes the status.
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
  const locale = await getLocale();
  if (text(formData, "locale", 8) !== locale) return { error: t("error.localeChanged") };
  // The wording's version the form displayed: refused if the wording was changed (a deploy between
  // page load and click), so the version recorded with the attestation is the one that was read.
  if (text(formData, "attestationVersion", 8) !== String(US_RESIDENCY_ATTESTATION_VERSION)) {
    return { error: t("error.attestationChanged") };
  }
  const actor = integrationActor(auth);
  try {
    await submitConnection(
      (fn) => withTenant(auth, fn),
      actor,
      id.data,
      text(formData, "updatedAt", 40),
      { attested: formData.get("attest") === "on", locale },
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
