import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { verifyPassword } from "@/auth/password";
import { closeDatabase, systemDb } from "@/db/client";
import { DEMO_PRACTICE, seedDemoPractice } from "@/db/demo";
import { memberships, tenants, users } from "@/db/schema";

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
  });
});
