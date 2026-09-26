import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, rcmClaimLines, rcmFiles, rcmSites } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import {
  CURRENT_FORMAT_VERSION,
  getFile,
  importMonthlyFile,
  listFiles,
} from "@/domain/revenue-cycle/imports";
import type { MonthlyLine } from "@/domain/revenue-cycle/monthly-file";
import { generateDataset } from "@/domain/synthetic/generator";
import { expectDbError } from "./helpers";

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;

async function practice(label: string, seed: number): Promise<Ctx> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `RCM import ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [{ email: `rcm-import-${suffix}@synthetic.test`, displayName: "RCM Manager", role: "manager" }],
    dataset: generateDataset({ asOf: todayIn(), seed, patients: 3, claims: 6 }),
  });
  return { tenantId, userId: userIds[0]! };
}

const line = (rowNumber: number, overrides: Partial<MonthlyLine> = {}): MonthlyLine => ({
  rowNumber,
  patientName: "Synthetic, Pat",
  accountNumber: `SYN-${rowNumber}`,
  serviceDate: "2026-03-10",
  cpt: "99213",
  description: "Office visit",
  facility: "Elsewhere",
  payerName: "Gulf Coast Mutual (synthetic)",
  payerClass: "COMM",
  status: "OPEN",
  billedCents: 10_000,
  paymentCents: 4_000,
  adjustmentCents: 2_500,
  balanceCents: 3_500,
  ...overrides,
});

const routing = {
  ruleCode: "STANDARD",
  netCents: 0,
  arGl: "1200",
  revenueGl: "4000",
  adjustmentGl: "4050",
  flagged: true,
};
const emptyFile = (ctx: Ctx) => ({
  tenantId: ctx.tenantId,
  uploadedBy: ctx.userId,
  filename: "x.csv",
  periodYear: 2026,
  periodMonth: 1,
  rowCount: 0,
  billedCents: 0,
  paymentCents: 0,
  balanceCents: 0,
  netCents: 0,
  flaggedCount: 0,
});

beforeAll(async () => {
  a = await practice("alpha", 31);
  b = await practice("beta", 32);
});

afterAll(() => closeDatabase());

describe("synthetic practices", () => {
  it("come with last month's classified file whose control totals match its lines", async () => {
    const [file] = await withTenant(a, (tx) => listFiles(tx));
    expect(file!.rowCount).toBeGreaterThan(100);
    const [totals] = await withTenant(a, (tx) =>
      tx
        .select({
          lines: sql<number>`count(*)::int`,
          billed: sql<number>`sum(billed_cents)::bigint`.mapWith(Number),
          adjustments: sql<number>`sum(adjustment_cents)::bigint`.mapWith(Number),
          net: sql<number>`sum(net_cents)::bigint`.mapWith(Number),
          payments: sql<number>`sum(payment_cents)::bigint`.mapWith(Number),
          balance: sql<number>`sum(balance_cents)::bigint`.mapWith(Number),
        })
        .from(rcmClaimLines)
        .where(eq(rcmClaimLines.fileId, file!.id)),
    );
    expect(totals).toEqual({
      lines: file!.rowCount,
      billed: file!.billedCents,
      adjustments: file!.adjustmentCents,
      net: file!.netCents,
      payments: file!.paymentCents,
      balance: file!.balanceCents,
    });
    expect(file!.netCents).toBe(file!.billedCents - file!.adjustmentCents);
    expect(file!.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    const detail = await withTenant(a, (tx) => getFile(tx, file!.id, { page: 1 }));
    expect(detail!.byRule.some((r) => r.key === "STANDARD")).toBe(true);
    expect(detail!.bySite.every((s) => s.siteId !== null)).toBe(true);
  });
});

describe("seeded activity files", () => {
  it("cover three consecutive months that roll forward exactly", async () => {
    const files = (await withTenant(a, (tx) => listFiles(tx))).reverse();
    expect(files).toHaveLength(3);
    for (let i = 1; i < files.length; i++) {
      const [prior, file] = [files[i - 1]!, files[i]!];
      expect(prior.balanceCents + file.billedCents - file.paymentCents - file.adjustmentCents).toBe(
        file.balanceCents,
      );
    }
  });
});

describe("importMonthlyFile", () => {
  it("routes lines, records review reasons, detects sites, and audits the import", async () => {
    const [site] = await withTenant(a, (tx) => tx.select().from(rcmSites).limit(1));
    const fileId = await withTenant(a, (tx) =>
      importMonthlyFile(tx, {
        ...a,
        periodYear: 2026,
        periodMonth: 3,
        defaultSiteId: null,
        lines: [
          line(2, { facility: `${site!.name.toUpperCase()} annex` }),
          line(3, { payerClass: "SELF", adjustmentCents: 0, balanceCents: 6_000 }),
          line(4, { status: "VOID", paymentCents: 0, adjustmentCents: 10_000, balanceCents: 0 }),
          line(5, { cpt: "", billedCents: 0, paymentCents: 0, adjustmentCents: 0, balanceCents: 0 }),
          line(7, { cpt: "9921", payerClass: "MCR" }),
          // An older line: this month's payment and write-off overshot, leaving a credit balance.
          line(6, { serviceDate: "2026-01-20", billedCents: 0, balanceCents: -500 }),
        ],
      }),
    );
    const rows = await withTenant(a, (tx) =>
      tx
        .select()
        .from(rcmClaimLines)
        .where(eq(rcmClaimLines.fileId, fileId))
        .orderBy(rcmClaimLines.rowNumber),
    );
    expect(rows.map((r) => [r.ruleCode, r.arGl, r.adjustmentGl, r.netCents, r.reviewReasons])).toEqual([
      ["STANDARD", "1200", "4050", 7_500, []],
      ["STANDARD", "1240", "4450", 10_000, []],
      ["VOIDED", "1200", "4990", 0, []],
      ["STANDARD", "1200", "4050", 0, ["no_activity", "blank_code"]],
      ["STANDARD", "1200", "4050", -2_500, ["credit_balance"]],
      ["STANDARD", "1210", "4150", 7_500, ["invalid_code"]],
    ]);
    expect(rows.every((r) => r.flagged === r.reviewReasons.length > 0)).toBe(true);
    expect(rows[0]!.siteId).toBe(site!.id);
    expect(rows[1]!.siteId).toBeNull();
    const [file] = await withTenant(a, (tx) => tx.select().from(rcmFiles).where(eq(rcmFiles.id, fileId)));
    expect(file).toMatchObject({
      rowCount: 6,
      billedCents: 40_000,
      paymentCents: 16_000,
      adjustmentCents: 17_500,
      netCents: 22_500,
      balanceCents: 12_500,
      flaggedCount: 3,
      formatVersion: CURRENT_FORMAT_VERSION,
    });
    const events = await withTenant(a, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.entityId, fileId)),
    );
    expect(events.map((e) => e.action)).toEqual(["rcm.file_imported"]);
    expect(JSON.stringify(events[0]!.metadata)).not.toContain("Synthetic, Pat");
  });

  it("refuses another practice's site as the default", async () => {
    const [bSite] = await withTenant(b, (tx) => tx.select().from(rcmSites).limit(1));
    await expect(
      withTenant(a, (tx) =>
        importMonthlyFile(tx, {
          ...a,
          periodYear: 2026,
          periodMonth: 3,
          defaultSiteId: bSite!.id,
          lines: [line(2)],
        }),
      ),
    ).rejects.toThrow("Unknown site");
  });
});

describe("import boundaries", () => {
  it("flags service dates after the period (day of / after), not earlier late charges", async () => {
    const fileId = await withTenant(a, (tx) =>
      importMonthlyFile(tx, {
        ...a,
        periodYear: 2026,
        periodMonth: 3,
        defaultSiteId: null,
        lines: [
          line(2, { serviceDate: "2026-02-15" }),
          line(3, { serviceDate: "2026-03-31" }),
          line(4, { serviceDate: "2026-04-01" }),
        ],
      }),
    );
    const rows = await withTenant(a, (tx) =>
      tx
        .select({ flagged: rcmClaimLines.flagged })
        .from(rcmClaimLines)
        .where(eq(rcmClaimLines.fileId, fileId))
        .orderBy(rcmClaimLines.rowNumber),
    );
    expect(rows.map((r) => r.flagged)).toEqual([false, false, true]);
    const [file] = await withTenant(a, (tx) => tx.select().from(rcmFiles).where(eq(rcmFiles.id, fileId)));
    expect(file!.filename).toBe("monthly-file-2026-03.csv");
  });

  it("stores nothing when any line fails to insert", async () => {
    const before = await withTenant(a, (tx) => tx.select({ id: rcmFiles.id }).from(rcmFiles));
    await expect(
      withTenant(a, (tx) =>
        importMonthlyFile(tx, {
          ...a,
          periodYear: 2026,
          periodMonth: 3,
          defaultSiteId: null,
          lines: [line(2), line(3, { serviceDate: "2026-13-45" })],
        }),
      ),
    ).rejects.toThrow();
    const after = await withTenant(a, (tx) => tx.select({ id: rcmFiles.id }).from(rcmFiles));
    expect(after).toHaveLength(before.length);
  });
});

describe("imported files are tenant-isolated and immutable", () => {
  it.each([
    ["rcm_files", rcmFiles],
    ["rcm_claim_lines", rcmClaimLines],
  ] as const)(
    "%s: another practice sees nothing and nobody can change or delete rows",
    async (_name, table) => {
      const own = await withTenant(a, (tx) => tx.select({ tenantId: table.tenantId }).from(table));
      expect(own.length).toBeGreaterThan(0);
      expect(new Set(own.map((r) => r.tenantId))).toEqual(new Set([a.tenantId]));
      const leaked = await withTenant(b, (tx) =>
        tx.select({ id: table.id }).from(table).where(eq(table.tenantId, a.tenantId)),
      );
      expect(leaked).toHaveLength(0);
      await expectDbError(
        withTenant(a, (tx) => tx.update(table).set({ tenantId: a.tenantId })),
        /permission denied/,
      );
      await expectDbError(
        withTenant(a, (tx) => tx.delete(table)),
        /permission denied/,
      );
    },
  );

  it("rejects unknown review reasons and file formats", async () => {
    const [file] = await withTenant(a, (tx) => listFiles(tx));
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(rcmClaimLines).values({
          ...line(9_999),
          ...routing,
          tenantId: a.tenantId,
          fileId: file!.id,
          reviewReasons: ["looks_odd"],
        }),
      ),
      /review_reasons_known/,
    );
    await expectDbError(
      withTenant(a, (tx) => tx.insert(rcmFiles).values({ ...emptyFile(a), formatVersion: 3 })),
      /format_version_known/,
    );
  });

  it("rejects a file stamped with another practice", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.insert(rcmFiles).values({ ...emptyFile(a), tenantId: b.tenantId })),
      /row-level security/,
    );
  });
});
