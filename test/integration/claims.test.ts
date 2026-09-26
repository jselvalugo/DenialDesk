import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, claimLines, claims, claimVersions } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { filingSummary, getClaim, listClaims } from "@/domain/claims/queries";
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
    expect(event!.metadata).toEqual({
      version: 2,
      changedFields: "diagnosisCodes,line 1 units,line 1 chargeCents",
    });
    expect(JSON.stringify(event!.metadata)).not.toContain("E11.65");
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

  it("allows non-billed updates (payment posting) without a version", async () => {
    const { claim } = await draftClaim(a);
    await withTenant(a, (tx) =>
      tx.update(claims).set({ updatedAt: new Date() }).where(eq(claims.id, claim.id)),
    );
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
      listClaims(tx, { group: "unsubmitted", page: 1 }, today),
    );
    expect(total).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "draft" || r.status === "rejected")).toBe(true);
    const days = rows.map((r) => r.filing?.daysRemaining ?? Number.POSITIVE_INFINITY);
    expect(days).toEqual([...days].sort((x, y) => x - y));
    expect(rows.some((r) => r.filing?.state === "past_deadline")).toBe(true);
  });

  it("filters by filing state and keeps totals consistent", async () => {
    const summary = await withTenant(a, (tx) => filingSummary(tx, today));
    const past = await withTenant(a, (tx) =>
      listClaims(tx, { group: "unsubmitted", filing: "past_deadline", page: 1 }, today),
    );
    expect(past.total).toBe(summary.pastDeadline);
    expect(past.rows.every((r) => r.filing?.state === "past_deadline")).toBe(true);
  });

  it("shows no filing status for claims already with the payer", async () => {
    const { rows } = await withTenant(a, (tx) => listClaims(tx, { group: "in_process", page: 1 }, today));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.filing === null)).toBe(true);
    const ids = rows.map((r) => r.id);
    const statuses = await withTenant(a, (tx) =>
      tx.select({ status: claims.status }).from(claims).where(inArray(claims.id, ids)),
    );
    expect(statuses.some((s) => s.status === "draft")).toBe(false);
  });
});
