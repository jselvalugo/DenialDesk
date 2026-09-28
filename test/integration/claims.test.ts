import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, claimLines, claims, claimVersions, payers } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { DatabaseError, withTenant } from "@/db/tenant";
import { claimsOverview, getClaim } from "@/domain/claims/queries";
import { ClaimCorrectionError, correctClaim } from "@/domain/claims/versions";
import { generateDataset } from "@/domain/synthetic/generator";
import { expectDbError } from "./helpers";

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;
const today = todayIn();

async function practice(label: string, seed: number): Promise<Ctx> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Claims ${suffix} (synthetic)`,
    asOf: today,
    users: [{ email: `claims-${suffix}@synthetic.test`, displayName: `Claims ${label}`, role: "specialist" }],
    dataset: generateDataset({ asOf: today, seed, patients: 4, claims: 6 }),
  });
  return { tenantId, userId: userIds[0]! };
}

async function draftClaim(ctx: Ctx) {
  return withTenant(ctx, async (tx) => {
    const [claim] = await tx
      .select()
      .from(claims)
      .where(eq(claims.status, "draft"))
      .orderBy(asc(claims.claimNumber))
      .limit(1);
    const lines = await tx.select().from(claimLines).where(eq(claimLines.claimId, claim!.id));
    return { claim: claim!, lines };
  });
}

beforeAll(async () => {
  a = await practice("alpha", 31);
  b = await practice("beta", 32);
});

afterAll(() => closeDatabase());

describe("claim version history (R-3.10.3)", () => {
  it("records version 1 for every seeded claim", async () => {
    const counts = await withTenant(a, async (tx) => {
      const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(claims);
      const [v] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(claimVersions)
        .where(eq(claimVersions.version, 1));
      return { claims: c!.n, versions: v!.n };
    });
    expect(counts.claims).toBeGreaterThan(0);
    expect(counts.versions).toBe(counts.claims);
  });

  it("corrects a draft claim, writes version 2, and audits field names only", async () => {
    const { claim, lines } = await draftClaim(a);
    const line = lines[0]!;
    const result = await withTenant(a, (tx) =>
      correctClaim(tx, {
        ...a,
        claimId: claim.id,
        expectedVersion: 1,
        today,
        correction: {
          serviceDate: claim.serviceDate,
          diagnosisCodes: ["E11.65"],
          lines: [{ ...line, units: line.units + 1, chargeCents: line.chargeCents + 500 }],
          reason: "Coder review of the visit note",
        },
      }),
    );
    expect(result).toEqual({
      version: 2,
      changedFields: ["diagnosisCodes", "line 1 units", "line 1 chargeCents"],
    });

    const detail = await withTenant(a, (tx) => getClaim(tx, claim.id));
    expect(detail!.claim.version).toBe(2);
    expect(detail!.claim.diagnosisCodes).toEqual(["E11.65"]);
    expect(detail!.claim.billedCents).toBe(line.chargeCents + 500);
    expect(detail!.history.map((v) => v.version)).toEqual([2, 1]);
    expect(detail!.history[0]).toMatchObject({
      reason: "Coder review of the visit note",
      author: "Claims alpha",
    });
    expect(detail!.history[1]!.snapshot.diagnosisCodes).toEqual(claim.diagnosisCodes);

    const [event] = await withTenant(a, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "claim.corrected"), eq(auditEvents.entityId, claim.id))),
    );
    // The typed reason stays in claim_versions; the audit row points at that version.
    expect(event!.reason).toBe("claim_correction");
    expect(event!.metadata).toEqual({
      version: 2,
      versionId: detail!.history[0]!.id,
      changedFields: "diagnosisCodes,line 1 units,line 1 chargeCents",
    });
    expect(JSON.stringify(event)).not.toContain("E11.65");
    expect(JSON.stringify(event)).not.toContain("Coder review");
  });

  it("rejects a stale version, no-op edits, added lines, and future dates", async () => {
    const { claim, lines } = await draftClaim(a);
    const correction = {
      serviceDate: claim.serviceDate,
      diagnosisCodes: claim.diagnosisCodes,
      lines: lines.map((l) => ({ ...l })),
      reason: "Checking guards",
    };
    const attempt = (override: Partial<typeof correction>, expectedVersion = claim.version) =>
      withTenant(a, (tx) =>
        correctClaim(tx, {
          ...a,
          claimId: claim.id,
          expectedVersion,
          today,
          correction: { ...correction, ...override },
        }),
      );
    await expect(attempt({}, claim.version - 1)).rejects.toThrow(/changed since you opened it/);
    await expect(attempt({})).rejects.toThrow(/Nothing changed/);
    await expect(
      attempt({ lines: [...correction.lines, { ...correction.lines[0]!, lineNumber: 99 }] }),
    ).rejects.toThrow(ClaimCorrectionError);
    await expect(attempt({ serviceDate: "2999-01-01" })).rejects.toThrow(/future/);
  });

  it("refuses to correct a claim the payer has already accepted", async () => {
    const [paid] = await withTenant(a, (tx) =>
      tx.select().from(claims).where(eq(claims.status, "paid")).limit(1),
    );
    await expect(
      withTenant(a, (tx) =>
        correctClaim(tx, {
          ...a,
          claimId: paid!.id,
          expectedVersion: paid!.version,
          today,
          correction: {
            serviceDate: paid!.serviceDate,
            diagnosisCodes: ["I10"],
            lines: [],
            reason: "Should not be allowed",
          },
        }),
      ),
    ).rejects.toThrow(/Only draft or rejected/);
  });

  it("the database refuses billed changes without a version row", async () => {
    const { claim, lines } = await draftClaim(a);
    await expectDbError(
      withTenant(a, (tx) =>
        tx
          .update(claims)
          .set({ diagnosisCodes: ["Z00.00"] })
          .where(eq(claims.id, claim.id)),
      ),
      /must move to version/,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx
          .update(claims)
          .set({ billedCents: 1, version: claim.version + 1 })
          .where(eq(claims.id, claim.id)),
      ),
      /has no history row/,
    );
    await expectDbError(
      withTenant(a, (tx) => tx.update(claimLines).set({ units: 9 }).where(eq(claimLines.id, lines[0]!.id))),
      /without a new claim version/,
    );
  });

  it("the database refuses moving a claim to another patient or payer without a version", async () => {
    const { claim } = await draftClaim(a);
    const [other] = await withTenant(a, (tx) =>
      tx
        .select()
        .from(claims)
        .where(sql`${claims.patientId} <> ${claim.patientId}`)
        .limit(1),
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(claims).set({ patientId: other!.patientId }).where(eq(claims.id, claim.id)),
      ),
      /must move to version/,
    );
  });

  it("claims.created_at can't be changed (it marks claims created in a transaction)", async () => {
    const { claim, lines } = await draftClaim(a);
    await expectDbError(
      withTenant(a, async (tx) => {
        await tx
          .update(claims)
          .set({ createdAt: sql`now()` })
          .where(eq(claims.id, claim.id));
        await tx.update(claimLines).set({ units: 9 }).where(eq(claimLines.id, lines[0]!.id));
      }),
      /created_at cannot change/,
    );
  });

  it("an impossible calendar date never reaches the database", async () => {
    const { claim, lines } = await draftClaim(a);
    await expect(
      withTenant(a, (tx) =>
        correctClaim(tx, {
          ...a,
          claimId: claim.id,
          expectedVersion: claim.version,
          today,
          correction: {
            serviceDate: "2026-02-30",
            diagnosisCodes: claim.diagnosisCodes,
            lines: lines.map((l) => ({ ...l })),
            reason: "Bad date",
          },
        }),
      ),
    ).rejects.toThrow();
    // A data exception's message quotes the value; the sanitized error keeps only its code.
    const error = await withTenant(a, (tx) => tx.execute(sql`select '2026-02-30'::date`)).catch(
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe("22008");
    expect((error as Error).message).not.toContain("2026-02-30");
  });

  it("allows non-billed updates (payment posting) without a version", async () => {
    const { claim } = await draftClaim(a);
    await withTenant(a, (tx) =>
      tx.update(claims).set({ updatedAt: new Date() }).where(eq(claims.id, claim.id)),
    );
  });

  it("the database refuses adding a line to an existing claim without a version", async () => {
    const { claim, lines } = await draftClaim(a);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(claimLines).values({ ...lines[0]!, id: undefined, lineNumber: 90, claimId: claim.id }),
      ),
      /without a new claim version/,
    );
  });

  it("the database stamps who and when on a version", async () => {
    const { claim } = await draftClaim(a);
    const snapshot = {
      serviceDate: claim.serviceDate,
      diagnosisCodes: [],
      billedCents: 0,
      status: "draft",
      lines: [],
    };
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(claimVersions).values({
          tenantId: a.tenantId,
          claimId: claim.id,
          version: 80,
          snapshot,
          reason: "Impersonation attempt",
          changedBy: b.userId,
        }),
      ),
      /must be the current user/,
    );
    const [row] = await withTenant(a, (tx) =>
      tx
        .insert(claimVersions)
        .values({
          tenantId: a.tenantId,
          claimId: claim.id,
          version: 81,
          snapshot,
          reason: "Backdating attempt",
          createdAt: new Date("2001-01-01T00:00:00Z"),
        })
        .returning({ createdAt: claimVersions.createdAt }),
    );
    expect(row!.createdAt.getUTCFullYear()).toBeGreaterThan(2001);
  });

  it("two corrections from the same page: one wins, the other is told to reload", async () => {
    const { claim, lines } = await draftClaim(a);
    const run = (units: number) =>
      withTenant(a, (tx) =>
        correctClaim(tx, {
          ...a,
          claimId: claim.id,
          expectedVersion: claim.version,
          today,
          correction: {
            serviceDate: claim.serviceDate,
            diagnosisCodes: claim.diagnosisCodes,
            lines: lines.map((l) => ({ ...l, units })),
            reason: "Concurrent edit",
          },
        }),
      );
    const results = await Promise.allSettled([run(7), run(8)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ClaimCorrectionError);
    expect(String(failed.reason)).toMatch(/changed since you opened it/);
  });

  it("history is append-only", async () => {
    const { claim } = await draftClaim(a);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(claimVersions).set({ reason: "rewritten" }).where(eq(claimVersions.claimId, claim.id)),
      ),
      /permission denied|append-only/,
    );
    await expectDbError(
      withTenant(a, (tx) => tx.delete(claimVersions).where(eq(claimVersions.claimId, claim.id))),
      /permission denied|append-only/,
    );
  });
});

describe("claim_versions tenant isolation (R-7.2.4)", () => {
  it("shows a tenant only its own versions", async () => {
    const rows = await withTenant(a, (tx) =>
      tx.select({ tenantId: claimVersions.tenantId }).from(claimVersions),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([a.tenantId]));
  });

  it("rejects a version stamped with another tenant", async () => {
    const { claim } = await draftClaim(b);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(claimVersions).values({
          tenantId: b.tenantId,
          claimId: claim.id,
          version: 50,
          snapshot: {
            serviceDate: claim.serviceDate,
            diagnosisCodes: [],
            billedCents: 0,
            status: "draft",
            lines: [],
          },
          reason: "Cross-tenant attempt",
        }),
      ),
      /row-level security/,
    );
  });

  it("rejects a version in its own tenant that points at another tenant's claim", async () => {
    const { claim } = await draftClaim(b);
    const error = await withTenant(a, (tx) =>
      tx.insert(claimVersions).values({
        tenantId: a.tenantId,
        claimId: claim.id,
        version: claim.version + 1,
        snapshot: {
          serviceDate: claim.serviceDate,
          diagnosisCodes: [],
          billedCents: 0,
          status: "draft",
          lines: [],
        },
        reason: "Cross-tenant attempt",
      }),
    ).catch((e: unknown) => e);
    // Integrity violations keep only the SQLSTATE (23503: foreign key) and the constraint name.
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe("23503");
    expect((error as DatabaseError).constraint).toBe("claim_versions_claim_fk");
  });

  it("can't correct another tenant's claim", async () => {
    const { claim, lines } = await draftClaim(b);
    await expect(
      withTenant(a, (tx) =>
        correctClaim(tx, {
          ...a,
          claimId: claim.id,
          expectedVersion: claim.version,
          today,
          correction: {
            serviceDate: claim.serviceDate,
            diagnosisCodes: ["I10"],
            lines: lines.map((l) => ({ ...l })),
            reason: "Cross-tenant attempt",
          },
        }),
      ),
    ).rejects.toThrow(/Claim not found/);
  });
});

describe("claims list and timely-filing summary (R-3.1.5)", () => {
  it("lists unsubmitted claims most urgent first, with rule-based deadlines", async () => {
    const { rows, total } = await withTenant(a, (tx) =>
      claimsOverview(tx, { group: "unsubmitted", page: 1 }, today),
    );
    expect(total).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "draft" || r.status === "rejected")).toBe(true);
    const days = rows.map((r) => r.filing?.daysRemaining ?? Number.POSITIVE_INFINITY);
    expect(days).toEqual([...days].sort((x, y) => x - y));
    expect(rows.some((r) => r.filing?.state === "past_deadline")).toBe(true);
  });

  it("filters unsubmitted claims by payer", async () => {
    const all = await withTenant(a, (tx) => claimsOverview(tx, { group: "unsubmitted", page: 1 }, today));
    const payerId = await withTenant(a, async (tx) => {
      const [row] = await tx
        .select({ payerId: claims.payerId })
        .from(claims)
        .where(eq(claims.id, all.rows[0]!.id));
      return row!.payerId;
    });
    const filtered = await withTenant(a, (tx) =>
      claimsOverview(tx, { group: "unsubmitted", payerId, page: 1 }, today),
    );
    expect(filtered.total).toBeGreaterThan(0);
    expect(filtered.total).toBeLessThan(all.total);
    expect(new Set(filtered.rows.map((r) => r.payerName))).toEqual(new Set([all.rows[0]!.payerName]));
  });

  it("filters by filing state and keeps totals consistent", async () => {
    const { summary } = await withTenant(a, (tx) => claimsOverview(tx, { group: "all", page: 1 }, today));
    const past = await withTenant(a, (tx) =>
      claimsOverview(tx, { group: "unsubmitted", filing: "past_deadline", page: 1 }, today),
    );
    expect(past.total).toBe(summary.pastDeadline);
    expect(past.rows.every((r) => r.filing?.state === "past_deadline")).toBe(true);
    for (const [filing, expected] of [
      ["due_soon", summary.dueSoon],
      ["not_configured", summary.notConfigured],
    ] as const) {
      const list = await withTenant(a, (tx) =>
        claimsOverview(tx, { group: "unsubmitted", filing, page: 1 }, today),
      );
      expect(list.total).toBe(expected);
      expect(expected).toBeGreaterThan(0);
      expect(list.rows.every((r) => r.filing?.state === filing)).toBe(true);
    }
  });

  it("counts an unverified payer's unsubmitted claims separately, with no computed deadline", async () => {
    const { claim } = await draftClaim(a);
    const before = await withTenant(a, (tx) => claimsOverview(tx, { group: "all", page: 1 }, today));

    const unverifiedPayerId = await withTenant(a, async (tx) => {
      const [payer] = await tx
        .insert(payers)
        .values({ tenantId: a.tenantId, name: `Unverified test payer ${Date.now()}` })
        .returning();
      await tx.insert(claims).values({
        tenantId: a.tenantId,
        claimNumber: `UNVER-${Date.now()}`,
        patientId: claim.patientId,
        providerId: claim.providerId,
        locationId: claim.locationId,
        payerId: payer!.id,
        serviceDate: claim.serviceDate,
        diagnosisCodes: claim.diagnosisCodes,
        billedCents: claim.billedCents,
        status: "draft",
      });
      return payer!.id;
    });

    const after = await withTenant(a, (tx) => claimsOverview(tx, { group: "all", page: 1 }, today));
    expect(after.summary.payerUnverified).toBe(before.summary.payerUnverified + 1);

    const filtered = await withTenant(a, (tx) =>
      claimsOverview(tx, { group: "unsubmitted", filing: "payer_unverified", page: 1 }, today),
    );
    expect(filtered.rows.some((r) => r.payerName.startsWith("Unverified test payer"))).toBe(true);
    expect(filtered.rows.every((r) => r.filing?.state === "payer_unverified")).toBe(true);

    const byPayer = await withTenant(a, (tx) =>
      claimsOverview(tx, { group: "unsubmitted", payerId: unverifiedPayerId, page: 1 }, today),
    );
    expect(byPayer.rows).toHaveLength(1);
    expect(byPayer.rows[0]!.filing).toEqual({
      state: "payer_unverified",
      deadline: null,
      daysRemaining: null,
    });
  });

  it("shows no filing status for claims already with the payer", async () => {
    const { rows } = await withTenant(a, (tx) => claimsOverview(tx, { group: "in_process", page: 1 }, today));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.filing === null)).toBe(true);
    const ids = rows.map((r) => r.id);
    const statuses = await withTenant(a, (tx) =>
      tx.select({ status: claims.status }).from(claims).where(inArray(claims.id, ids)),
    );
    expect(statuses.some((s) => s.status === "draft")).toBe(false);
  });

  it("sorts an explicit column (SQL-backed group) ascending or descending, with a stable id tie-break (P4)", async () => {
    const { asc: ascResult, desc: descResult } = await withTenant(a, async (tx) => {
      const asc = await claimsOverview(tx, { group: "all", sort: "billed", dir: "asc", page: 1 }, today);
      const desc = await claimsOverview(tx, { group: "all", sort: "billed", dir: "desc", page: 1 }, today);
      return { asc, desc };
    });
    expect(ascResult.rows.length).toBeGreaterThan(1);
    // A `dir` flip never changes the filtered total, only the order the pages come back in.
    expect(descResult.total).toBe(ascResult.total);
    for (const [rows, sign] of [
      [ascResult.rows, 1],
      [descResult.rows, -1],
    ] as const) {
      for (let i = 1; i < rows.length; i += 1) {
        const cmp = (rows[i]!.billedCents - rows[i - 1]!.billedCents) * sign;
        expect(cmp).toBeGreaterThanOrEqual(0);
        if (cmp === 0) expect(rows[i - 1]!.id < rows[i]!.id).toBe(true);
      }
    }
  });

  it("sorts the unsubmitted queue (in-memory, urgency by default) by an explicit column instead", async () => {
    const [byDefault, byClaimNumber] = await withTenant(a, async (tx) => {
      const urgency = await claimsOverview(tx, { group: "unsubmitted", page: 1 }, today);
      const explicit = await claimsOverview(
        tx,
        { group: "unsubmitted", sort: "claimNumber", dir: "asc", page: 1 },
        today,
      );
      return [urgency, explicit];
    });
    expect(byClaimNumber.rows.length).toBeGreaterThan(1);
    const numbers = byClaimNumber.rows.map((r) => r.claimNumber);
    expect(numbers).toEqual([...numbers].sort());
    // The total (urgency-filtered set) is unaffected by which order it's read in.
    expect(byClaimNumber.total).toBe(byDefault.total);
  });
});
