import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { verifyPassword } from "@/auth/password";
import { closeDatabase, systemDb } from "@/db/client";
import { DEMO_PRACTICE, SeedRefusedError, seedDemoPractice } from "@/db/demo";
import { auditEvents, memberships, sessions, tenants, users } from "@/db/schema";
import { createTestTenant } from "./helpers";

// The pre-production seed endpoint doubles as the owner's way back into the operator account.
afterAll(() => closeDatabase());

const email = `seed-admin-${Date.now()}@synthetic.test`;
const adminRow = async () =>
  (
    await systemDb()
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
  )[0]!;

describe("seedDemoPractice", () => {
  it("repairs the admin when the practice exists: creates, resets password, clears lockout, keeps MFA unless asked", async () => {
    await seedDemoPractice({ email: `first-${email}`, password: "first-synthetic-password" });
    // The practice exists (this or an earlier run), so the configured admin is created in it.
    expect(await seedDemoPractice({ email, password: "synthetic-password-one" })).toBe("repaired");
    const created = await adminRow();
    expect(await verifyPassword("synthetic-password-one", created.passwordHash)).toBe(true);
    const [practice] = await systemDb().select().from(tenants).where(eq(tenants.name, DEMO_PRACTICE));
    const [membership] = await systemDb()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, created.id));
    expect(membership).toMatchObject({ tenantId: practice!.id, role: "admin" });

    await systemDb()
      .update(users)
      .set({
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() + 60_000),
        totpSecretEnc: "v1.synthetic",
        mfaEnrolledAt: new Date(),
      })
      .where(eq(users.id, created.id));
    await seedDemoPractice({ email, password: "synthetic-password-two" });
    const repaired = await adminRow();
    expect(await verifyPassword("synthetic-password-two", repaired.passwordHash)).toBe(true);
    expect(repaired).toMatchObject({ failedLoginCount: 0, lockedUntil: null, totpSecretEnc: "v1.synthetic" });

    await seedDemoPractice({ email, password: "synthetic-password-two" }, { resetMfa: true });
    expect(await adminRow()).toMatchObject({ totpSecretEnc: null, mfaEnrolledAt: null });
    const count = await systemDb().select().from(memberships).where(eq(memberships.userId, created.id));
    expect(count).toHaveLength(1);

    const events = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.action} = 'system.admin_repaired' and ${auditEvents.entityId} = ${created.id}`,
      );
    expect(events.map((e) => e.metadata)).toEqual([
      { resetMfa: false, created: true },
      { resetMfa: false, created: false },
      { resetMfa: true, created: false },
    ]);
  });

  it("ends the admin's sessions and leaves a disabled account disabled", async () => {
    const admin = await adminRow();
    await systemDb()
      .insert(sessions)
      .values({
        userId: admin.id,
        tokenHash: `synthetic-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        lastSeenAt: new Date(),
      });
    const disabledAt = new Date();
    await systemDb().update(users).set({ disabledAt }).where(eq(users.id, admin.id));
    await seedDemoPractice({ email, password: "synthetic-password-three" });
    const open = await systemDb()
      .select()
      .from(sessions)
      .where(sql`${sessions.userId} = ${admin.id} and ${sessions.revokedAt} is null`);
    expect(open).toHaveLength(0);
    expect((await adminRow()).disabledAt).not.toBeNull();
  });

  it("refuses to touch a user of another practice who shares the configured email", async () => {
    const other = await createTestTenant("Other practice");
    const [otherUser] = await systemDb().select().from(users).where(eq(users.id, other.userId));
    await expect(
      seedDemoPractice({ email: otherUser!.email, password: "attacker-chosen-password" }),
    ).rejects.toBeInstanceOf(SeedRefusedError);
    const [after] = await systemDb().select().from(users).where(eq(users.id, other.userId));
    expect(after!.passwordHash).toBe(otherUser!.passwordHash);
  });

  it("refuses to run in production", async () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      await expect(seedDemoPractice({ email, password: "synthetic-password-four" })).rejects.toBeInstanceOf(
        SeedRefusedError,
      );
    } finally {
      process.env.APP_ENV = previous;
    }
  });
});
