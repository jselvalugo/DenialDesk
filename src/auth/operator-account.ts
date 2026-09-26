import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { memberships, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { TenantTx } from "@/db/tenant";
import { isOperatorEmail, operatorEmail } from "./operator-email";

// The platform operator account (docs/specs/operator-login.md): the one account whose email is
// PLATFORM_OPERATOR_EMAIL and that belongs to no practice. It signs in only at /operator/login, and
// it exists only as provisioned from infrastructure configuration (syncOperatorAccount).

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

/** The scrypt hash format produced by `pnpm operator:credential` (see src/auth/password.ts). */
const HASH_FORMAT = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{64,}$/;

/** The operator's password hash from infrastructure configuration, or null if unset or malformed. */
export function configuredOperatorHash(): string | null {
  const hash = process.env.PLATFORM_OPERATOR_PASSWORD_HASH?.trim();
  return hash && HASH_FORMAT.test(hash) ? hash : null;
}

/** The console is on only when both the operator email and a well-formed password hash are configured. */
export function operatorConfigured(): boolean {
  return operatorEmail() !== null && configuredOperatorHash() !== null;
}

/**
 * Makes the operator account match infrastructure configuration (PLATFORM_OPERATOR_EMAIL and
 * PLATFORM_OPERATOR_PASSWORD_HASH). No page or endpoint can create or reset the operator: only
 * whoever controls the hosting configuration can (docs/specs/operator-login.md).
 *
 * - No account yet: creates it, practice-free, with the configured hash (two-step set up at first sign-in).
 * - Hash changed: that is a credential rotation, used for recovery. The new hash applies, two-step
 *   enrollment and lockout are cleared, and every session of the account ends.
 * - An account with a practice membership, or a disabled one, is never touched (fail closed).
 * Cheap when nothing changed (one indexed lookup), so it runs on every console request and sign-in.
 */
export async function syncOperatorAccount(): Promise<void> {
  const email = operatorEmail();
  const hash = configuredOperatorHash();
  if (!email || !hash) return;
  const [user] = await systemDb()
    .select({ id: users.id, passwordHash: users.passwordHash, disabledAt: users.disabledAt })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (user?.passwordHash === hash) return;
  if (user && (user.disabledAt || (await hasPracticeMembership(user.id)))) return;

  await systemDb()
    .transaction(async (tx) => {
      if (!user) {
        const [created] = await tx
          .insert(users)
          .values({ email, displayName: "Platform operator", passwordHash: hash })
          .returning({ id: users.id });
        await audit(tx as unknown as TenantTx, {
          action: "operator.credential_provisioned",
          actorUserId: created!.id,
          entityType: "user",
          entityId: created!.id,
        });
        return;
      }
      // Only the request that actually swaps the hash rotates (concurrent requests see 0 rows).
      const rotated = await tx
        .update(users)
        .set({
          passwordHash: hash,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          totpSecretEnc: null,
          mfaEnrolledAt: null,
          totpLastStep: null,
        })
        .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash)))
        .returning({ id: users.id });
      if (rotated.length === 0) return;
      const ended = await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      await audit(tx as unknown as TenantTx, {
        action: "operator.credential_rotated",
        actorUserId: user.id,
        entityType: "user",
        entityId: user.id,
        metadata: { mfaReset: true, sessionsEnded: ended.length },
      });
    })
    .catch((error: unknown) => {
      // Two first requests racing to create the account: the loser hits the unique email index.
      const code =
        (error as { cause?: { code?: string }; code?: string })?.cause?.code ??
        (error as { code?: string })?.code;
      if (code !== "23505") throw error;
    });
}
