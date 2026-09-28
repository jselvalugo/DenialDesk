import { hasRecentMfa } from "@/auth/step-up";
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
  /** A form field, or "confirm" for the revoke acknowledgement. */
  field?: ConnectionField | "confirm";
  /** The refusal a fresh MFA verification fixes (R-7.2.2): the page offers a link to `/step-up`. */
  stepUpRequired?: boolean;
}

/**
 * The domain actor for a signed-in practice user. `syntheticOnly` always comes from the server's
 * own environment (`syntheticDataOnly()`, fail-closed), never from the request — this is what keeps
 * real EHR endpoints out of every Netlify deploy (compliance review #5). `recentMfa` likewise comes
 * from the session's own `mfa_verified_at` (R-7.2.2), with an injectable clock for tests.
 */
export function integrationActor(
  auth: Pick<AuthContext, "tenantId" | "userId" | "role"> & { mfaVerifiedAt?: Date | null },
  synthetic: () => boolean = syntheticDataOnly,
  now: Date = new Date(),
): IntegrationActor {
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    role: auth.role,
    syntheticOnly: synthetic(),
    recentMfa: hasRecentMfa(auth.mfaVerifiedAt ?? null, now),
  };
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
  if (error instanceof IntegrationConnectionError) {
    return {
      error: error.message,
      field: error.field,
      ...(error.stepUpRequired ? { stepUpRequired: true } : {}),
    };
  }
  if (isDatabaseError(error)) return { error: t("error.saveFailed") };
  throw error;
}
