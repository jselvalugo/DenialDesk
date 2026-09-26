import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { verifyPassword } from "@/auth/password";
import type { OperatorContext } from "@/auth/operator";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, memberships, tenants, users } from "@/db/schema";
import {
  createPractice,
  listPractices,
  PracticeError,
  setPracticeSuspended,
} from "@/domain/platform/practices";
import { todayIn } from "@rules/calendar";
import { seedPractice } from "@/db/seed";
import { createTestTenant } from "./helpers";

// The operator belongs to no practice (docs/specs/operator-login.md).
let operator: OperatorContext;
let listedPractice: { tenantId: string };

beforeAll(async () => {
  const email = `operator-${Date.now()}@synthetic.test`;
  const [user] = await systemDb()
    .insert(users)
    .values({ email, displayName: "Platform operator", passwordHash: "unused" })
    .returning({ id: users.id });
  operator = {
    sessionId: "00000000-0000-4000-8000-000000000000",
    userId: user!.id,
    displayName: "Platform operator",
    email,
  };
  listedPractice = await createTestTenant("Operator-listed practice");
});

afterAll(() => closeDatabase());

describe("createPractice", () => {
  it("creates a customer practice with an admin who can sign in with the temporary password", async () => {
    const email = `admin-${Date.now()}@synthetic.test`;
    const { tenantId, temporaryPassword } = await createPractice(
      { name: "Synthetic Bayview Clinic", adminName: "Synthetic Admin", adminEmail: email },
      operator,
    );
    const [tenant] = await systemDb().select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant).toMatchObject({ kind: "customer", suspendedAt: null });
    const [admin] = await systemDb().select().from(users).where(eq(users.email, email));
    expect(await verifyPassword(temporaryPassword, admin!.passwordHash)).toBe(true);
    expect(admin!.mfaEnrolledAt).toBeNull(); // MFA set up on first sign-in
    expect(admin!.mustChangePassword).toBe(true); // temporary password must be replaced
    const [membership] = await systemDb().select().from(memberships).where(eq(memberships.userId, admin!.id));
    expect(membership).toMatchObject({ tenantId, role: "admin" });
    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "operator.practice_created"), eq(auditEvents.entityId, tenantId)));
    expect(event?.actorUserId).toBe(operator.userId);
  });

  it("rejects an email that already has an account", async () => {
    const email = `dupe-${Date.now()}@synthetic.test`;
    await createPractice({ name: "First", adminName: "A", adminEmail: email }, operator);
    await expect(
      createPractice({ name: "Second", adminName: "B", adminEmail: email.toUpperCase() }, operator),
    ).rejects.toBeInstanceOf(PracticeError);
  });
});

describe("suspension", () => {
  it("suspends and reactivates a practice", async () => {
    const { tenantId } = await createPractice(
      { name: "Suspend me", adminName: "A", adminEmail: `susp-${Date.now()}@synthetic.test` },
      operator,
    );
    await setPracticeSuspended(tenantId, true, operator);
    expect(
      (await systemDb().select().from(tenants).where(eq(tenants.id, tenantId)))[0]?.suspendedAt,
    ).not.toBeNull();
    await setPracticeSuspended(tenantId, false, operator);
    expect(
      (await systemDb().select().from(tenants).where(eq(tenants.id, tenantId)))[0]?.suspendedAt,
    ).toBeNull();
  });

  it("only suspends customer practices (legacy demo practices stay archived)", async () => {
    const legacy = await createTestTenant("Legacy demo practice (synthetic)");
    await systemDb()
      .update(tenants)
      .set({ kind: "demo", suspendedAt: new Date() }) // every demo practice is archived now
      .where(eq(tenants.id, legacy.tenantId));
    await expect(setPracticeSuspended(legacy.tenantId, true, operator)).rejects.toBeInstanceOf(PracticeError);
  });
});

describe("listPractices", () => {
  it("lists every practice with team size and open-denial counts", async () => {
    const { tenantId } = await seedPractice({
      practiceName: `Operator-listed seeded practice ${Date.now()} (synthetic)`,
      asOf: todayIn(),
      users: [
        { email: `listed-a-${Date.now()}@synthetic.test`, displayName: "Synthetic A", role: "admin" },
        { email: `listed-b-${Date.now()}@synthetic.test`, displayName: "Synthetic B", role: "specialist" },
      ],
    });
    const practices = await listPractices(operator);
    const row = practices.find((p) => p.id === tenantId);
    expect(row?.teamSize).toBe(2);
    expect(row?.openDenials).toBeGreaterThan(0);
    expect(practices.some((p) => p.id === listedPractice.tenantId)).toBe(true);
  });
});
