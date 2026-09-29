import { hasRecentMfa } from "@/auth/step-up";
import type { AuthContext } from "@/auth/session";
import { isDatabaseError } from "@/db/errors";
import { BillingSettingsError, type BillingActor, type BillingField } from "@/domain/settings/billing";
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";

// Shared by the Settings > Billing server actions (docs/specs/claims.md C3a-S). Nothing here ever holds a
// submitted value: the TIN in particular is never part of a state object, so it can't be sent back.

export interface BillingFormState {
  /** A refusal for the whole form (alert style). */
  error?: string;
  /** Per-field messages; the message is a translated sentence, never the value. */
  fieldErrors?: Partial<Record<BillingField, string>>;
  /** The refusal a fresh MFA verification fixes (R-7.2.2): the form offers the `/step-up` link. */
  stepUpRequired?: boolean;
}

type SettingsT = Translator<Messages["settings"]>;

/** The domain actor: role and tenant from the verified session, `recentMfa` from its own `mfa_verified_at`. */
export function billingActor(
  auth: Pick<AuthContext, "tenantId" | "userId" | "role" | "mfaVerifiedAt">,
  now: Date = new Date(),
): BillingActor {
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    role: auth.role,
    recentMfa: hasRecentMfa(auth.mfaVerifiedAt ?? null, now),
    stepUpVerifiedAt: auth.mfaVerifiedAt?.toISOString() ?? null,
  };
}

/** A refusal as form state. Domain refusals become translated messages; a database error is one generic line. */
export function billingFailure(error: unknown, t: SettingsT): BillingFormState {
  if (error instanceof BillingSettingsError) {
    switch (error.kind) {
      case "forbidden":
        return { error: t("billing.error.notAdmin") };
      case "not_found":
        return { error: t("billing.error.notFound") };
      case "step_up":
        return { error: t("billing.error.stepUpRequired"), stepUpRequired: true };
      case "validation": {
        const fieldErrors: Partial<Record<BillingField, string>> = {};
        for (const issue of error.issues) {
          fieldErrors[issue.field] ??= t(issue.key, issue.max === undefined ? undefined : { max: issue.max });
        }
        return { error: t("billing.error.fixFields"), fieldErrors };
      }
    }
  }
  if (isDatabaseError(error)) return { error: t("billing.error.saveFailed") };
  throw error;
}
