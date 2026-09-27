import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase, systemDb } from "@/db/client";
import {
  appealNotes,
  appeals,
  auditEvents,
  businessRules,
  claimLines,
  claims,
  denialNotes,
  denials,
  glAccounts,
  locations,
  memberships,
  patients,
  payerClasses,
  payers,
  practiceSettings,
  providers,
  rcmSites,
  tenants,
  users,
} from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { DatabaseError, withTenant } from "@/db/tenant";
import { generateDataset } from "@/domain/synthetic/generator";
import { audit } from "@/lib/audit";
import { expectDbError } from "./helpers";

// R-7.2.4 / CLAUDE.md #5: isolation is enforced by the database for every tenant-owned table.
type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;

async function practice(label: string, seed: number): Promise<Ctx> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Isolation ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [{ email: `iso-${suffix}@synthetic.test`, displayName: `Iso ${label}`, role: "specialist" }],
    dataset: generateDataset({ asOf: todayIn(), seed, patients: 4, claims: 12 }),
  });
  const ctx = { tenantId, userId: userIds[0]! };
  await withTenant(ctx, async (tx) => {
    const [denial] = await tx.select({ id: denials.id, claimId: denials.claimId }).from(denials).limit(1);
    await tx
      .insert(denialNotes)
      .values({ tenantId, denialId: denial!.id, authorId: ctx.userId, body: "Synthetic note" });
    const [appeal] = await tx
      .insert(appeals)
      .values({
        tenantId,
        denialId: denial!.id,
        claimId: denial!.claimId,
        level: "first_level",
        filedBy: ctx.userId,
      })
      .returning({ id: appeals.id });
    await tx
      .insert(appealNotes)
      .values({ tenantId, appealId: appeal!.id, authorId: ctx.userId, body: "Synthetic appeal note" });
    await tx.insert(practiceSettings).values({ tenantId, key: "appeal_follow_up_days", value: "30" });
  });
  return ctx;
}

beforeAll(async () => {
  a = await practice("alpha", 11);
  b = await practice("beta", 22);
});

afterAll(() => closeDatabase());

const tenantTables = {
  locations,
  providers,
  payers,
  patients,
  claims,
  claimLines,
  denials,
  denialNotes,
  appeals,
  practiceSettings,
  rcmSites,
  glAccounts,
  payerClasses,
  businessRules,
};

describe.each(Object.entries(tenantTables))("row-level security on %s", (_name, table) => {
  it("shows a tenant only its own rows", async () => {
    const rows = await withTenant(a, (tx) => tx.select({ tenantId: table.tenantId }).from(table));
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([a.tenantId]));
  });

  it("hides another tenant's rows even when asked for them directly", async () => {
    const rows = await withTenant(a, (tx) =>
      tx.select({ id: table.id }).from(table).where(eq(table.tenantId, b.tenantId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("can't update another tenant's rows", async () => {
    const updated = await withTenant(a, (tx) =>
      tx
        .update(table)
        .set({ tenantId: b.tenantId })
        .where(eq(table.tenantId, b.tenantId))
        .returning({ id: table.id }),
    );
    expect(updated).toHaveLength(0);
  });

  it("can't move its own rows to another tenant", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(table).set({ tenantId: b.tenantId }).where(eq(table.tenantId, a.tenantId)),
      ),
      /row-level security/,
    );
  });

  it("can't hard-delete practice data (no delete until legal hold exists)", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.delete(table)),
      /permission denied/,
    );
  });
});

describe("cross-tenant inserts", () => {
  it("rejects a row stamped with another tenant", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(locations).values({ tenantId: b.tenantId, name: "Sneaky", city: "Orlando" }),
      ),
      /row-level security/,
    );
  });

  it("rejects a note on another tenant's denial", async () => {
    const [bDenial] = await withTenant(b, (tx) => tx.select({ id: denials.id }).from(denials).limit(1));
    await expectDbError(
      withTenant(a, (tx) =>
        tx
          .insert(denialNotes)
          .values({ tenantId: b.tenantId, denialId: bDenial!.id, authorId: a.userId, body: "x" }),
      ),
      /row-level security/,
    );
  });

  it("rejects a note on another tenant's appeal", async () => {
    const [bAppeal] = await withTenant(b, (tx) => tx.select({ id: appeals.id }).from(appeals).limit(1));
    await expectDbError(
      withTenant(a, (tx) =>
        tx
          .insert(appealNotes)
          .values({ tenantId: b.tenantId, appealId: bAppeal!.id, authorId: a.userId, body: "x" }),
      ),
      /row-level security/,
    );
  });

  it("rejects an appeal on another tenant's denial or claim", async () => {
    const [bDenial] = await withTenant(b, (tx) =>
      tx.select({ id: denials.id, claimId: denials.claimId }).from(denials).limit(1),
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(appeals).values({
          tenantId: a.tenantId,
          denialId: bDenial!.id,
          claimId: bDenial!.claimId,
          level: "first_level",
          filedBy: a.userId,
        }),
      ),
      // Blocked one of two ways: the composite FK, or the claim-matches-denial trigger's own
      // lookup (which runs first and, under tenant a's RLS, can't see tenant b's denial row either).
      /row-level security|Integrity constraint violation|does not match the claim of denial/,
    );
  });

  it("rejects an appeal on another tenant's own denial paired with its own claim (claim/denial mismatch)", async () => {
    // Same tenant on both sides of the composite FKs, but the claim doesn't belong to the denial.
    const [aDenial] = await withTenant(a, (tx) =>
      tx.select({ id: denials.id, claimId: denials.claimId }).from(denials).limit(1),
    );
    const [otherClaim] = await withTenant(a, (tx) =>
      tx
        .select({ id: claims.id })
        .from(claims)
        .where(sql`${claims.id} != ${aDenial!.claimId}`)
        .limit(1),
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(appeals).values({
          tenantId: a.tenantId,
          denialId: aDenial!.id,
          claimId: otherClaim!.id,
          level: "first_level",
          filedBy: a.userId,
        }),
      ),
      /does not match the claim of denial/,
    );
  });

  it("rejects a practice setting stamped with another tenant", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(practiceSettings).values({ tenantId: b.tenantId, key: "sneaky", value: "1" }),
      ),
      /row-level security/,
    );
  });
});

describe("appeal_notes tenant isolation (insert/select only, no update grant)", () => {
  it("shows a tenant only its own notes", async () => {
    const rows = await withTenant(a, (tx) => tx.select({ tenantId: appealNotes.tenantId }).from(appealNotes));
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([a.tenantId]));
  });

  it("hides another tenant's notes even when asked for them directly", async () => {
    const rows = await withTenant(a, (tx) =>
      tx.select({ id: appealNotes.id }).from(appealNotes).where(eq(appealNotes.tenantId, b.tenantId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("can't update a note at all (no UPDATE grant)", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.update(appealNotes).set({ body: "edited" })),
      /permission denied/,
    );
  });

  it("can't hard-delete a note", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.delete(appealNotes)),
      /permission denied/,
    );
  });
});

describe("identity tables", () => {
  it("show only the current practice, its memberships, and its team", async () => {
    const [visibleTenants, visibleMemberships, visibleUsers] = await withTenant(a, (tx) =>
      Promise.all([
        tx.select({ id: tenants.id }).from(tenants),
        tx.select({ tenantId: memberships.tenantId }).from(memberships),
        tx.select({ id: users.id }).from(users),
      ]),
    );
    expect(visibleTenants.map((t) => t.id)).toEqual([a.tenantId]);
    expect(new Set(visibleMemberships.map((m) => m.tenantId))).toEqual(new Set([a.tenantId]));
    expect(visibleUsers.map((u) => u.id)).toEqual([a.userId]);
  });

  it("never expose password hashes or MFA secrets to the app role", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.execute(sql`select password_hash from users`)),
      /permission denied/,
    );
    await expectDbError(
      withTenant(a, (tx) => tx.execute(sql`select totp_secret_enc from users`)),
      /permission denied/,
    );
  });

  it("return nothing when no tenant is bound", async () => {
    const rows = await systemDb().transaction(async (tx) => {
      await tx.execute(sql`set local role denialdesk_app`);
      return Promise.all([tx.select().from(payers), tx.select({ id: tenants.id }).from(tenants)]);
    });
    expect(rows.flat()).toHaveLength(0);
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

describe("database errors from tenant queries", () => {
  it("drop query parameters, which can contain PHI", async () => {
    const secret = "SYN-SECRET-PARAM-4242";
    try {
      await withTenant(a, (tx) =>
        tx.insert(locations).values({ tenantId: b.tenantId, name: secret, city: "Tampa" }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).cause).toBeUndefined();
    }
  });

  // Postgres puts row values in `detail` ("Key (tenant_id, mrn)=(…)", "Failing row contains (…)").
  const leaks = (error: unknown, values: string[]) => {
    const e = error as Error;
    const text = [e.message, e.stack, JSON.stringify(e), String(e.cause)].join("\n");
    return [...values, "Key (", "Failing row"].filter((value) => text.includes(value));
  };

  it("keep only SQLSTATE and constraint for a unique violation (23505)", async () => {
    const [existing] = await withTenant(a, (tx) => tx.select().from(patients).limit(1));
    const name = "Synthia Duplicatepatient";
    const error = await withTenant(a, (tx) =>
      tx.insert(patients).values({ ...existing!, id: undefined, firstName: name, createdAt: undefined }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe("23505");
    expect((error as DatabaseError).constraint).toBe("patients_tenant_mrn_key");
    expect(leaks(error, [name, existing!.mrn, a.tenantId])).toEqual([]);
  });

  it("keep only SQLSTATE and constraint for a check violation (23514)", async () => {
    const name = "SYN-GL-Synthia Checkpatient";
    const error = await withTenant(a, (tx) =>
      tx.insert(glAccounts).values({ tenantId: a.tenantId, number: "SYN-9999", name, kind: "ar" }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe("23514");
    expect((error as DatabaseError).constraint).toBe("gl_accounts_ar_routing");
    expect(leaks(error, [name, "SYN-9999", a.tenantId])).toEqual([]);
  });

  it("sanitize system (non-tenant) query errors too: no email, name, or password hash", async () => {
    const email = `synthia.duplicate-${Date.now()}@example.test`;
    const values = { email, displayName: "Synthia Systemuser", passwordHash: "$argon2id$SYN-HASH-0000" };
    await systemDb().insert(users).values(values);
    const error = await systemDb()
      .insert(users)
      .values({ ...values, email: email.toUpperCase() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe("23505");
    expect((error as DatabaseError).constraint).toBe("users_email_key");
    expect(leaks(error, [email, email.toUpperCase(), values.displayName, values.passwordHash])).toEqual([]);
    await systemDb().delete(users).where(eq(users.email, email));
  });

  // Every Drizzle query path reaches the sanitizer (ADR 0006). 22P02 quotes the bad value.
  const bad = "SYN-not-a-uuid-Synthia";
  it.each([
    ["select", () => systemDb().select().from(users).where(eq(users.id, bad))],
    ["relational query", () => systemDb().query.users.findFirst({ where: eq(users.id, bad) })],
    ["execute", () => systemDb().execute(sql`select ${bad}::uuid`)],
    [
      "statement in a system transaction",
      () => systemDb().transaction((tx) => tx.execute(sql`select ${bad}::uuid`)),
    ],
    [
      "nested savepoint",
      () =>
        systemDb().transaction((tx) => tx.transaction((inner) => inner.execute(sql`select ${bad}::uuid`))),
    ],
  ] as const)("sanitize a %s error", async (_, run) => {
    const error = await (run() as Promise<unknown>).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe("22P02");
    expect(leaks(error, [bad])).toEqual([]);
  });

  it("sanitize a deferred constraint violation raised at commit", async () => {
    const value = "SYN-DEFERRED-Synthia";
    const error = await systemDb()
      .transaction(async (tx) => {
        await tx.execute(
          sql`create temp table deferred_probe (v text unique deferrable initially deferred) on commit drop`,
        );
        await tx.execute(sql`insert into deferred_probe values (${value}), (${value})`);
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe("23505");
    expect(leaks(error, [value])).toEqual([]);
  });
});
