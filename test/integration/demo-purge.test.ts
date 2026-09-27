import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase, systemDb } from "@/db/client";
import {
  auditEvents,
  claims,
  claimVersions,
  memberships,
  tenants,
  universityAccess,
  universityProgress,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { seedPractice } from "@/db/seed";
import { generateDataset } from "@/domain/synthetic/generator";
import { expectDbError } from "./helpers";

// Migration 0032 purges the retired demo practices through purge_demo_practices() (ADR 0008).
// Real function against the database: demo practices and demo-only users go, customer practices,
// shared users and the audit log stay, and every delete guard is back on afterwards.

afterAll(() => closeDatabase());

const GUARDS = [
  "claim_versions_no_update",
  "custom_field_value_versions_no_update",
  "remittances_no_delete",
  "remittance_claims_no_update",
  "remittance_events_no_update",
  "prompt_pay_responses_no_update",
  "tenant_agreements_guard_row",
  "audit_events_no_update", // never touched: the audit log stays append-only
];

async function practice(label: string, emails: string[]) {
  const asOf = todayIn();
  return seedPractice({
    practiceName: `${label} (synthetic)`,
    asOf,
    users: emails.map((email) => ({ email, displayName: "Synthetic User", role: "admin" as const })),
    dataset: generateDataset({ asOf, seed: 7, patients: 3, claims: 6 }),
  });
}

/** Audit events are readable per tenant only (row-level security). */
async function auditFor(tenantId: string, userId: string) {
  return withTenant({ tenantId, userId }, (tx) =>
    tx.select({ action: auditEvents.action, entityId: auditEvents.entityId }).from(auditEvents),
  );
}

async function countClaims(tenantId: string, userId: string) {
  const [row] = await withTenant({ tenantId, userId }, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(claims),
  );
  return row!.n;
}

describe("purge_demo_practices", () => {
  it("removes demo practices and demo-only users, keeps customers and the audit log", async () => {
    const s = randomUUID().slice(0, 8);
    const demo = await practice(`Demo ${s}`, [`demo-${s}@synthetic.test`]);
    const customer = await practice(`Customer ${s}`, [`cust-${s}@synthetic.test`]);
    // A user in both practices must survive (only demo-only users are purged).
    await systemDb()
      .insert(memberships)
      .values({ tenantId: demo.tenantId, userId: customer.userIds[0]!, role: "admin" });
    // A University completion (0033) must not block the purge (0034).
    await systemDb().insert(universityProgress).values({
      tenantId: demo.tenantId,
      userId: demo.userIds[0]!,
      lessonId: "getting-started/finding-your-way",
    });
    // Nor must a University access row (0036); 0037 adds it to the purge.
    await systemDb()
      .insert(universityAccess)
      .values({ tenantId: demo.tenantId, requestedAt: new Date(), requestedBy: demo.userIds[0]! });
    await systemDb()
      .update(tenants)
      .set({ kind: "demo", suspendedAt: new Date() })
      .where(eq(tenants.id, demo.tenantId));
    const customerClaims = await countClaims(customer.tenantId, customer.userIds[0]!);
    expect(customerClaims).toBeGreaterThan(0);
    const before = await auditFor(demo.tenantId, demo.userIds[0]!);

    const [result] = (await systemDb().execute(sql`SELECT purge_demo_practices() AS n`)).rows as {
      n: number;
    }[];
    expect(result!.n).toBeGreaterThanOrEqual(1);

    expect(await systemDb().select().from(tenants).where(eq(tenants.id, demo.tenantId))).toHaveLength(0);
    expect(await systemDb().select().from(users).where(eq(users.id, demo.userIds[0]!))).toHaveLength(0);
    expect(await systemDb().select().from(users).where(eq(users.id, customer.userIds[0]!))).toHaveLength(1);
    expect(await countClaims(customer.tenantId, customer.userIds[0]!)).toBe(customerClaims);
    expect(await countClaims(demo.tenantId, customer.userIds[0]!)).toBe(0);

    // Earlier audit events are kept, plus one purge record per practice and per user.
    const kept = await auditFor(demo.tenantId, demo.userIds[0]!);
    expect(kept).toHaveLength(before.length + 2);
    expect(kept.filter((e) => e.action === "system.demo_purged")).toHaveLength(1);
    expect(
      kept.filter((e) => e.action === "system.demo_user_purged" && e.entityId === demo.userIds[0]),
    ).toHaveLength(1);

    // Every delete guard is enabled again, and the audit log is still append-only.
    const triggers = (
      await systemDb().execute(
        sql`SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN (${sql.join(
          GUARDS.map((g) => sql`${g}`),
          sql`, `,
        )})`,
      )
    ).rows as { tgname: string; tgenabled: string }[];
    expect(triggers).toHaveLength(GUARDS.length);
    expect(triggers.every((t) => t.tgenabled === "O")).toBe(true);
    await expectDbError(
      withTenant({ tenantId: customer.tenantId, userId: customer.userIds[0]! }, (tx) =>
        tx.delete(claimVersions).where(inArray(claimVersions.tenantId, [customer.tenantId])),
      ),
      /append-only|permission denied/,
    );
  });
});
