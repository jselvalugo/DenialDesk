import "server-only";
import { eq, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { memberships, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { TenantTx } from "@/db/tenant";
import { hashPassword } from "./password";

// The platform operator account (docs/specs/operator-login.md): the one account whose email is
// PLATFORM_OPERATOR_EMAIL and that belongs to no practice. It signs in only at /operator/login.

/** The configured operator email, normalized, or null when the console is switched off. */
export function operatorEmail(): string | null {
  const email = process.env.PLATFORM_OPERATOR_EMAIL?.trim().toLowerCase();
  return email ? email : null;
}

export function isOperatorEmail(email: string): boolean {
  const configured = operatorEmail();
  return configured !== null && email.trim().toLowerCase() === configured;
}

/** An account with any practice membership is never the operator, whatever its email (fail closed). */
export async function hasPracticeMembership(userId: string): Promise<boolean> {
  const [row] = await systemDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  return row !== undefined;
}

export class OperatorSetupError extends Error {}

/**
 * Creates the operator account, or recovers an existing one: new password, two-step enrollment
 * and lockout cleared, every session ended. Pre-production only; the caller checks the setup code.
 * Refuses an email that belongs to a practice account or a disabled account.
 */
export async function setUpOperatorAccount(input: {
  email: string;
  password: string;
}): Promise<{ userId: string; created: boolean }> {
  if (process.env.APP_ENV === "production") {
    throw new OperatorSetupError("Operator setup isn't available in production.");
  }
  const passwordHash = await hashPassword(input.password);
  return systemDb().transaction(async (tx) => {
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
        );
      }
      if (existing.disabledAt) throw new OperatorSetupError("That account is disabled.");
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
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
    // Audited in the same transaction: a setup never commits without its audit event.
    await audit(tx as unknown as TenantTx, {
      action: "operator.setup_completed",
      actorUserId: userId,
      entityType: "user",
      entityId: userId,
      metadata: { created: !existing },
    });
    return { userId, created: !existing };
  });
}
