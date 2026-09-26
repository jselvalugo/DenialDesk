import { and, eq, ne, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { isOperatorEmail } from "@/auth/operator-email";
import { hashPassword } from "@/auth/password";
import { audit } from "@/lib/audit";
import type { TenantTx } from "./tenant";
import { systemDb } from "./client";
import { memberships, sessions, tenants, users } from "./schema";
import { seedPractice } from "./seed";

export const DEMO_PRACTICE = "Coral Bay Physicians (synthetic)";

/**
 * Creates the synthetic demo practice once. If it already exists, repairs its admin account
 * instead ("repaired"): creates the admin if missing, otherwise resets the password to the
 * configured one and clears any lockout, and with `resetMfa` clears two-step enrollment so it can
 * be set up again. (The platform operator is a separate account, provisioned from configuration.) Used by
 * `pnpm db:seed` and the pre-production seed endpoint (token-protected, never in production).
 */
export class SeedRefusedError extends Error {}

export async function seedDemoPractice(
  admin: { email: string; password: string },
  options: { resetMfa?: boolean; repair?: boolean } = {},
): Promise<"seeded" | "repaired" | "exists"> {
  // Checked here, not only in seedPractice: the repair path never reaches seedPractice.
  if (process.env.APP_ENV === "production") {
    throw new SeedRefusedError("Refusing to seed or repair accounts with APP_ENV=production");
  }
  // The operator is a separate, practice-free account: the seed must never touch it.
  if (isOperatorEmail(admin.email)) {
    throw new SeedRefusedError(
      "SEED_ADMIN_EMAIL is the platform operator's email. Give the demo admin a different address.",
    );
  }
  const [existing] = await systemDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.name, DEMO_PRACTICE))
    .limit(1);
  if (existing) {
    if (options.repair === false) return "exists";
    await repairAdmin(existing.id, admin, options.resetMfa ?? false);
    return "repaired";
  }
  await seedPractice({
    practiceName: DEMO_PRACTICE,
    asOf: todayIn(),
    users: [
      { email: admin.email, displayName: "Morgan Delacroix", role: "admin", password: admin.password },
      { email: "m.alvarez@denialdesk.test", displayName: "Marisol Alvarez", role: "specialist" },
      { email: "j.chen@denialdesk.test", displayName: "Jonah Chen", role: "specialist" },
      { email: "t.okafor@denialdesk.test", displayName: "Tobi Okafor", role: "manager" },
    ],
    sampleVoucherBy: 3,
  });
  return "seeded";
}

async function repairAdmin(
  tenantId: string,
  admin: { email: string; password: string },
  resetMfa: boolean,
): Promise<void> {
  const passwordHash = await hashPassword(admin.password);
  await systemDb().transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${admin.email})`)
      .limit(1)
      // Locks the user row so a concurrent membership insert (which needs a key-share lock on it)
      // waits until this repair commits, keeping the "no other practice" check true.
      .for("update");
    if (user) {
      // Only ever touch an account that belongs to the seeded practice alone: never another
      // practice's user who happens to share the configured email.
      const elsewhere = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), ne(memberships.tenantId, tenantId)))
        .limit(1);
      if (elsewhere.length > 0) {
        throw new SeedRefusedError("The configured admin email belongs to another practice's user");
      }
    }
    const userId =
      user?.id ??
      (
        await tx
          .insert(users)
          .values({ email: admin.email, displayName: "Morgan Delacroix", passwordHash })
          .returning({ id: users.id })
      )[0]!.id;
    // A deliberately disabled account (disabled_at) stays disabled.
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        ...(resetMfa ? { totpSecretEnc: null, mfaEnrolledAt: null, totpLastStep: null } : {}),
      })
      .where(eq(users.id, userId));
    const [membership] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      .limit(1);
    if (!membership) await tx.insert(memberships).values({ tenantId, userId, role: "admin" });
    // Any session opened with the old credentials ends.
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
    // Audited in the same transaction: a repair never commits without its audit event.
    await audit(tx as unknown as TenantTx, {
      action: "system.admin_repaired",
      tenantId,
      entityType: "user",
      entityId: userId,
      metadata: { resetMfa, created: !user },
    });
  });
}
