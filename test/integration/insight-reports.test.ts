import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, claims, denials } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { OPEN_STATUSES } from "@/domain/denial-status";
import { defaultDateRange } from "@/domain/insight/filters";
import {
  fetchClaimsByStatus,
  fetchDenialRate,
  fetchDenialsByCategory,
  fetchDenialsByDeadlineBucket,
  fetchDenialsByPayer,
  recordReportExported,
  recordReportViewed,
} from "@/domain/insight/queries";
import { buildSingleReportWorkbook } from "@/domain/insight/report";
import { generateDataset } from "@/domain/synthetic/generator";
import type { Actor } from "@/domain/revenue-cycle/vouchers";
import ExcelJS from "exceljs";

let a: Actor;
let b: Actor;

async function practice(label: string, seed: number): Promise<Actor> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Insight reporting ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [
      { email: `insight-mgr-${suffix}@synthetic.test`, displayName: "Insight Manager", role: "manager" },
    ],
    dataset: generateDataset({ asOf: todayIn(), seed, patients: 6, claims: 30 }),
  });
  return { tenantId, userId: userIds[0]!, role: "manager" };
}

beforeAll(async () => {
  a = await practice("alpha", 71);
  b = await practice("beta", 72);
});

afterAll(() => closeDatabase());

const filters = { ...defaultDateRange(), payerId: null as string | null, error: null };
// Widen the window generously so seeded synthetic denials/claims fall inside it.
const wideFilters = {
  dateFrom: "2000-01-01",
  dateTo: "2100-01-01",
  payerId: null as string | null,
  error: null,
};

describe("Insight reports — tenant isolation", () => {
  it("denials-by-category sees only its own tenant's denials, even with matching CARC codes", async () => {
    const [mine, theirs] = await Promise.all([
      withTenant(a, (tx) => fetchDenialsByCategory(tx, wideFilters)),
      withTenant(b, (tx) => fetchDenialsByCategory(tx, wideFilters)),
    ]);
    const myTotal = mine.reduce((t, g) => t + g.count, 0);
    const theirTotal = theirs.reduce((t, g) => t + g.count, 0);
    expect(myTotal).toBeGreaterThan(0);
    expect(theirTotal).toBeGreaterThan(0);

    const [myRows, theirRows] = await Promise.all([
      withTenant(a, (tx) =>
        tx.select({ id: denials.id }).from(denials).where(eq(denials.tenantId, a.tenantId)),
      ),
      withTenant(b, (tx) =>
        tx.select({ id: denials.id }).from(denials).where(eq(denials.tenantId, b.tenantId)),
      ),
    ]);
    expect(myTotal).toBe(myRows.length);
    expect(theirTotal).toBe(theirRows.length);
  });

  it("claims-by-status only counts each tenant's own claims", async () => {
    const [mine, theirs, myClaims, theirClaims] = await Promise.all([
      withTenant(a, (tx) => fetchClaimsByStatus(tx, wideFilters)),
      withTenant(b, (tx) => fetchClaimsByStatus(tx, wideFilters)),
      withTenant(a, (tx) => tx.select({ id: claims.id }).from(claims)),
      withTenant(b, (tx) => tx.select({ id: claims.id }).from(claims)),
    ]);
    expect(mine.reduce((t, g) => t + g.count, 0)).toBe(myClaims.length);
    expect(theirs.reduce((t, g) => t + g.count, 0)).toBe(theirClaims.length);
  });

  it("denials-by-payer never merges an unverified payer's row with another payer's", async () => {
    const mine = await withTenant(a, (tx) => fetchDenialsByPayer(tx, wideFilters));
    expect(mine.length).toBeGreaterThan(0);
    // Every payer id maps to exactly one row (no merging across payers).
    const ids = mine.map((g) => g.payerId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Insight reports — calculations against seeded data", () => {
  it("denial rate matches a hand-computed count from the same window", async () => {
    const result = await withTenant(a, (tx) => fetchDenialRate(tx, wideFilters));
    const [submitted] = await withTenant(a, (tx) =>
      tx
        .select({ count: sql<number>`count(distinct ${claims.id})::int` })
        .from(claims)
        .where(sql`${claims.status} <> 'draft'`),
    );
    expect(result.submittedClaims).toBe(submitted!.count);
    if (result.submittedClaims === 0) {
      expect(result.rate).toBeNull();
    } else {
      expect(result.rate).toBe(result.deniedClaims / result.submittedClaims);
    }
  });

  it("open denials by deadline bucket always includes the no_deadline bucket, even at zero", async () => {
    const buckets = await withTenant(a, (tx) => fetchDenialsByDeadlineBucket(tx, wideFilters, todayIn()));
    expect(buckets.map((b) => b.bucket)).toContain("no_deadline");
    const totalCount = buckets.reduce((t, b) => t + b.count, 0);
    const [openCount] = await withTenant(a, (tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(denials)
        .innerJoin(claims, eq(claims.id, denials.claimId))
        .where(
          and(
            inArray(denials.status, OPEN_STATUSES),
            gte(denials.noticeDate, wideFilters.dateFrom),
            lte(denials.noticeDate, wideFilters.dateTo),
          ),
        ),
    );
    expect(totalCount).toBe(openCount!.count);
  });
});

describe("Insight reports — audit and export", () => {
  it("records insight.report_viewed and insight.report_exported with no patient/claim IDs in metadata", async () => {
    const result = await withTenant(a, async (tx) => {
      await recordReportViewed(tx, a, "claims-by-status", filters);
      const workbook = await buildSingleReportWorkbook(tx, "claims-by-status", wideFilters, {
        practiceName: "Insight reporting alpha (synthetic)",
        userId: a.userId,
      });
      await recordReportExported(tx, a, "claims-by-status", filters, workbook.rowCount);
      return {
        events: await tx
          .select({ action: auditEvents.action, metadata: auditEvents.metadata })
          .from(auditEvents)
          .where(inArray(auditEvents.action, ["insight.report_viewed", "insight.report_exported"])),
        buffer: workbook.buffer,
        filename: workbook.filename,
      };
    });
    expect(result.events.some((e) => e.action === "insight.report_viewed")).toBe(true);
    expect(result.events.some((e) => e.action === "insight.report_exported")).toBe(true);
    for (const event of result.events) {
      const json = JSON.stringify(event.metadata);
      expect(json).not.toMatch(/patient|claimId|denialId|mrn/i);
    }
    // Filename carries no PHI — just the report id and the date range.
    expect(result.filename).toBe(`claims-by-status_${wideFilters.dateFrom}_${wideFilters.dateTo}.xlsx`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["About", "Claims by status"]);
  });
});
