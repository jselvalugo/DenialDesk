import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, locations, payers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { createTestTenant, expectDbError } from "./helpers";

// R-7.2.4: tenant isolation is enforced by the database, not just by application code.
let a: Awaited<ReturnType<typeof createTestTenant>>;
let b: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  a = await createTestTenant("Alpha");
  b = await createTestTenant("Beta");
  await withTenant(a, (tx) =>
    tx.insert(locations).values({ tenantId: a.tenantId, name: "Alpha main", city: "Tampa" }),
  );
  await withTenant(b, (tx) =>
    tx.insert(locations).values({ tenantId: b.tenantId, name: "Beta main", city: "Miami" }),
  );
});

afterAll(() => closeDatabase());

describe("row-level security", () => {
  it("shows a tenant only its own rows", async () => {
    const rows = await withTenant(a, (tx) => tx.select().from(locations));
    expect(rows.map((r) => r.tenantId)).toEqual([a.tenantId]);
  });

  it("hides another tenant's rows even when queried by ID", async () => {
    const [betaLocation] = await withTenant(b, (tx) => tx.select().from(locations));
    const rows = await withTenant(a, (tx) =>
      tx.select().from(locations).where(eq(locations.id, betaLocation!.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("rejects inserting a row for another tenant", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(locations).values({ tenantId: b.tenantId, name: "Sneaky", city: "Orlando" }),
      ),
      /row-level security/,
    );
  });

  it("cannot move a row to another tenant", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(locations).set({ tenantId: b.tenantId }).where(eq(locations.tenantId, a.tenantId)),
      ),
      /row-level security/,
    );
  });

  it("cannot update or delete another tenant's rows", async () => {
    const updated = await withTenant(a, (tx) =>
      tx.update(locations).set({ name: "Changed" }).where(eq(locations.tenantId, b.tenantId)).returning(),
    );
    const deleted = await withTenant(a, (tx) =>
      tx.delete(locations).where(eq(locations.tenantId, b.tenantId)).returning(),
    );
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it("returns nothing when no tenant is bound", async () => {
    const rows = await systemDb().transaction(async (tx) => {
      await tx.execute(sql`set local role denialdesk_app`);
      return tx.select().from(payers);
    });
    expect(rows).toHaveLength(0);
  });

  it("does not let the app role read password hashes", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.execute(sql`select password_hash from users limit 1`)),
      /permission denied/,
    );
  });
});

describe("audit log", () => {
  it("records events and shows them only to their tenant", async () => {
    await withTenant(a, (tx) =>
      audit(tx, { action: "denial.queue_viewed", actorUserId: a.userId, tenantId: a.tenantId }),
    );
    const seenByB = await withTenant(b, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.tenantId, a.tenantId)),
    );
    const seenByA = await withTenant(a, (tx) => tx.select().from(auditEvents));
    expect(seenByB).toHaveLength(0);
    expect(seenByA.length).toBeGreaterThanOrEqual(1);
  });

  it("is append-only, even for the table owner", async () => {
    await expectDbError(systemDb().execute(sql`update audit_events set action = 'tampered'`), /append-only/);
    await expectDbError(systemDb().execute(sql`delete from audit_events`), /append-only/);
    await expectDbError(systemDb().execute(sql`truncate audit_events`), /append-only/);
  });
});
