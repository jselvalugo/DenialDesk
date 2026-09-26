import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { createDemoPractice as ensureDemoPracticeFresh, ensureDemoPractice } from "@/auth/demo";
import { verifyPassword } from "@/auth/password";
import type { AuthContext } from "@/auth/session";
import { closeDatabase, systemDb } from "@/db/client";
import {
  auditEvents,
  businessRules,
  claims,
  denials,
  locations,
  memberships,
  patients,
  payers,
  rcmFiles,
  tenants,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  createPractice,
  listPractices,
  PracticeError,
  resetDemoPractice,
  setPracticeSuspended,
} from "@/domain/platform/practices";
import { createTestTenant } from "./helpers";

let operator: AuthContext;

beforeAll(async () => {
  const home = await createTestTenant("Operator home");
  operator = {
    sessionId: "00000000-0000-4000-8000-000000000000",
    userId: home.userId,
    tenantId: home.tenantId,
    displayName: "Synthetic Operator",
    tenantName: "Operator home",
    role: "admin",
    tenantKind: "customer",
    authMethod: "password_mfa",
    email: "operator@synthetic.test",
  };
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

  it("only suspends customer practices (demo practices are reset instead)", async () => {
    const demo = await ensureDemoPractice();
    await expect(setPracticeSuspended(demo.tenantId, true, operator)).rejects.toBeInstanceOf(PracticeError);
  });

  it("won't suspend the operator's own practice", async () => {
    await expect(setPracticeSuspended(operator.tenantId, true, operator)).rejects.toBeInstanceOf(
      PracticeError,
    );
  });
});

describe("demo practice", () => {
  it("is created on first use and reused afterwards", async () => {
    const first = await ensureDemoPractice();
    const second = await ensureDemoPractice();
    expect(second).toEqual(first);
    const [tenant] = await systemDb().select().from(tenants).where(eq(tenants.id, first.tenantId));
    expect(tenant?.kind).toBe("demo");
  });

  it("reset archives the old demo practice and creates a fresh one", async () => {
    const before = await ensureDemoPractice();
    await resetDemoPractice(operator);
    const after = await ensureDemoPractice();
    expect(after.tenantId).not.toBe(before.tenantId);
    const active = await systemDb()
      .select()
      .from(tenants)
      .where(and(eq(tenants.kind, "demo"), isNull(tenants.suspendedAt)));
    expect(active.map((t) => t.id)).toEqual([after.tenantId]);
  });

  it("can reset to an empty practice (setup only) and back to sample data, audited with the mode", async () => {
    const count = async (ctx: { tenantId: string; userId: string }) =>
      withTenant(ctx, async (tx) => ({
        payers: (await tx.select({ id: payers.id }).from(payers)).length,
        locations: (await tx.select({ id: locations.id }).from(locations)).length,
        rules: (await tx.select({ id: businessRules.id }).from(businessRules)).length,
        patients: (await tx.select({ id: patients.id }).from(patients)).length,
        claims: (await tx.select({ id: claims.id }).from(claims)).length,
        denials: (await tx.select({ id: denials.id }).from(denials)).length,
        files: (await tx.select({ id: rcmFiles.id }).from(rcmFiles)).length,
      }));

    await resetDemoPractice(operator, "empty");
    const empty = await ensureDemoPractice();
    const [emptyTenant] = await systemDb().select().from(tenants).where(eq(tenants.id, empty.tenantId));
    expect(emptyTenant!.name).toMatch(/demo, empty/);
    const emptyCounts = await count(empty);
    expect(emptyCounts).toMatchObject({ patients: 0, claims: 0, denials: 0, files: 0, rules: 12 });
    expect(emptyCounts.payers).toBeGreaterThan(0);
    expect(emptyCounts.locations).toBeGreaterThan(0);
    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "operator.demo_reset"), eq(auditEvents.tenantId, empty.tenantId)));
    expect(event!.metadata).toEqual({ mode: "empty" });

    await resetDemoPractice(operator, "sample");
    const sample = await ensureDemoPractice();
    const sampleCounts = await count(sample);
    expect(sampleCounts.denials).toBeGreaterThan(0);
    expect(sampleCounts.files).toBe(1);
  });
});

describe("demo guards", () => {
  it("refuse to create or reset a demo practice when the demo is disabled", async () => {
    process.env.DEMO_LOGIN_ENABLED = "false";
    try {
      await expect(ensureDemoPracticeFresh()).rejects.toThrow(/disabled/);
      await expect(resetDemoPractice(operator)).rejects.toBeInstanceOf(PracticeError);
    } finally {
      process.env.DEMO_LOGIN_ENABLED = "true";
    }
  });

  it("allow only one active demo practice, even under concurrent first use", async () => {
    await resetDemoPractice(operator); // archive, leaving exactly one active
    await systemDb().update(tenants).set({ suspendedAt: new Date() }).where(eq(tenants.kind, "demo"));
    const results = await Promise.all([ensureDemoPractice(), ensureDemoPractice(), ensureDemoPractice()]);
    expect(new Set(results.map((r) => r.tenantId)).size).toBe(1);
  });
});

describe("listPractices", () => {
  it("lists every practice with team size and open-denial counts", async () => {
    const demo = await ensureDemoPractice();
    const practices = await listPractices(operator);
    const demoRow = practices.find((p) => p.id === demo.tenantId);
    expect(demoRow?.teamSize).toBe(3);
    expect(demoRow?.openDenials).toBeGreaterThan(0);
    expect(practices.some((p) => p.id === operator.tenantId)).toBe(true);
  });
});
