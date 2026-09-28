import type { AuthContext } from "@/auth/session";
import { isDatabaseError } from "@/db/errors";
import {
  IntegrationConnectionError,
  type ConnectionField,
  type IntegrationActor,
} from "@/domain/integrations/connections";
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";
import { syntheticDataOnly } from "@/lib/env";

// Shared by the Settings › Integrations server actions (docs/specs/patient-integrations.md PI1b-2).

export interface ConnectionFormState {
  error?: string;
  field?: ConnectionField;
}

/**
 * The domain actor for a signed-in practice user. `syntheticOnly` always comes from the server's
 * own environment (`syntheticDataOnly()`, fail-closed), never from the request — this is what keeps
 * real EHR endpoints out of every Netlify deploy (compliance review #5).
 */
export function integrationActor(
  auth: Pick<AuthContext, "tenantId" | "userId" | "role">,
  synthetic: () => boolean = syntheticDataOnly,
): IntegrationActor {
  return { tenantId: auth.tenantId, userId: auth.userId, role: auth.role, syntheticOnly: synthetic() };
}

/**
 * A refusal the form can show. Domain refusals keep their field; a database error becomes one
 * generic message — PostgreSQL's constraint detail never reaches the page or an error tracker
 * (compliance review #10). Anything else is a bug and is rethrown.
 */
export function connectionFormFailure(
  error: unknown,
  t: Translator<Messages["integrations"]>,
): ConnectionFormState {
  if (error instanceof IntegrationConnectionError) return { error: error.message, field: error.field };
  if (isDatabaseError(error)) return { error: t("error.saveFailed") };
  throw error;
}
