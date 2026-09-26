import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { memberships, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { TenantTx } from "@/db/tenant";
import { isOperatorEmail } from "./operator-email";
import { hashPassword } from "./password";

// The platform operator account (docs/specs/operator-login.md): the one account whose email is
// PLATFORM_OPERATOR_EMAIL and that belongs to no practice. It signs in only at /operator/login.

export { isOperatorEmail, operatorEmail } from "./operator-email";

/** An account with any practice membership is never the operator, whatever its email (fail closed). */
export async function hasPracticeMembership(userId: string): Promise<boolean> {
  const [row] = await systemDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  return row !== undefined;
}

/**
 * The one rule for "is this the operator account": configured email AND no practice membership.
 * Used by practice sign-in (to refuse it), operator sign-in (to accept only it), and the console.
 */
export async function isOperatorAccount(user: { id: string; email: string }): Promise<boolean> {
  return isOperatorEmail(user.email) && !(await hasPracticeMembership(user.id));
}

/**
 * Setup and recovery are allowed only where APP_ENV explicitly says development or preview, so a
 * missing or mistyped APP_ENV never exposes an MFA-resetting path.
 */
export function operatorSetupAllowed(): boolean {
  return process.env.APP_ENV === "development" || process.env.APP_ENV === "preview";
}

export type SetupFailure = "not_allowed" | "practice_account" | "disabled" | "conflict";

export class OperatorSetupError extends Error {
  constructor(
    message: string,
    readonly reason: SetupFailure,
  ) {
    super(message);
  }
}

/**
 * Creates the operator account, or recovers an existing one: new password, two-step enrollment
 * and lockout cleared, every session ended. Pre-production only; the caller checks the setup code.
 * Refuses an email that belongs to a practice account or a disabled account.
 */
export async function setUpOperatorAccount(input: {
  email: string;
  password: string;
}): Promise<{ userId: string; created: boolean }> {
  if (!operatorSetupAllowed()) {
    throw new OperatorSetupError("Operator setup isn't available in this environment.", "not_allowed");
  }
  const passwordHash = await hashPassword(input.password);
  return systemDb()
    .transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: users.id, disabledAt: users.disabledAt })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${input.email})`)
        .limit(1)
        // Locks the row so a concurrent membership insert waits until this commits.
        .for("update");
      if (existing) {
        const [membership] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.userId, existing.id))
          .limit(1);
        if (membership) {
          throw new OperatorSetupError(
            "That email belongs to a practice account. Set PLATFORM_OPERATOR_EMAIL to an address used only for the platform console.",
            "practice_account",
          );
        }
        if (existing.disabledAt) throw new OperatorSetupError("That account is disabled.", "disabled");
      }
      const userId =
        existing?.id ??
        (
          await tx
            .insert(users)
            .values({ email: input.email.trim(), displayName: "Platform operator", passwordHash })
            .returning({ id: users.id })
        )[0]!.id;
      await tx
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          totpSecretEnc: null,
          mfaEnrolledAt: null,
          totpLastStep: null,
        })
        .where(eq(users.id, userId));
      const ended = await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      // Audited in the same transaction: a setup never commits without its audit event.
      await audit(tx as unknown as TenantTx, {
        action: "operator.setup_completed",
        actorUserId: userId,
        entityType: "user",
        entityId: userId,
        metadata: { created: !existing, mfaReset: true, sessionsEnded: ended.length },
      });
      return { userId, created: !existing };
    })
    .catch((error: unknown) => {
      // Two first-time setups racing both miss the row lock; the loser hits the unique email index.
      const code =
        (error as { cause?: { code?: string }; code?: string })?.cause?.code ??
        (error as { code?: string })?.code;
      if (code === "23505")
        throw new OperatorSetupError("Setup was just completed elsewhere. Try again.", "conflict");
      throw error;
    });
}
