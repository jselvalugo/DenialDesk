import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, rcmClaimLines, rcmFiles, rcmSites } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { getFile, importMonthlyFile, listFiles } from "@/domain/revenue-cycle/imports";
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
  payerClass: "COM",
  status: "PAID",
  billedCents: 10_000,
  paymentCents: 4_000,
  balanceCents: 6_000,
  ...overrides,
});

beforeAll(async () => {
  a = await practice("alpha", 31);
  b = await practice("beta", 32);
});

afterAll(() => closeDatabase());

describe("synthetic practices", () => {
  it("come with last month's classified file whose control totals match its lines", async () => {
    const [file] = await withTenant(a, (tx) => listFiles(tx));
    expect(file!.rowCount).toBe(150);
    const [totals] = await withTenant(a, (tx) =>
      tx
        .select({
          lines: sql<number>`count(*)::int`,
          billed: sql<number>`sum(billed_cents)::bigint`.mapWith(Number),
          contra: sql<number>`sum(contra_cents)::bigint`.mapWith(Number),
          net: sql<number>`sum(net_cents)::bigint`.mapWith(Number),
          payments: sql<number>`sum(payment_cents)::bigint`.mapWith(Number),
        })
        .from(rcmClaimLines)
        .where(eq(rcmClaimLines.fileId, file!.id)),
    );
    expect(totals).toEqual({
      lines: file!.rowCount,
      billed: file!.billedCents,
      contra: file!.contraCents,
      net: file!.netCents,
      payments: file!.paymentCents,
    });
    expect(file!.netCents).toBe(file!.billedCents - file!.contraCents);
    const detail = await withTenant(a, (tx) => getFile(tx, file!.id, { page: 1 }));
    expect(detail!.byRule.length).toBeGreaterThan(3);
    expect(detail!.bySite.every((s) => s.siteId !== null)).toBe(true);
  });
});

describe("importMonthlyFile", () => {
  it("classifies lines, detects sites from the facility, and audits the import", async () => {
    const [site] = await withTenant(a, (tx) => tx.select().from(rcmSites).limit(1));
    const fileId = await withTenant(a, (tx) =>
      importMonthlyFile(tx, {
        ...a,
        filename: "synthetic-test.csv",
        periodYear: 2026,
        periodMonth: 3,
        defaultSiteId: null,
        lines: [
          line(2, { facility: `${site!.name.toUpperCase()} annex` }),
          line(3, { payerClass: "SPY" }),
          line(4, { status: "51CR" }),
          line(5, { cpt: "", billedCents: 0, paymentCents: 0, balanceCents: 0 }),
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
    expect(rows.map((r) => [r.ruleCode, r.arGl, r.contraCents, r.flagged])).toEqual([
      ["STANDARD", "1310", 0, false],
      ["SELF_PAY", "1320", 0, false],
      ["EXCL_51CR", "1310", 10_000, false],
      ["INVALID_CPT", "1310", 0, true],
    ]);
    expect(rows[0]!.siteId).toBe(site!.id);
    expect(rows[1]!.siteId).toBeNull();
    const [file] = await withTenant(a, (tx) => tx.select().from(rcmFiles).where(eq(rcmFiles.id, fileId)));
    expect(file).toMatchObject({ rowCount: 4, billedCents: 30_000, contraCents: 10_000, netCents: 20_000 });
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
          filename: "x.csv",
          periodYear: 2026,
          periodMonth: 3,
          defaultSiteId: bSite!.id,
          lines: [line(2)],
        }),
      ),
    ).rejects.toThrow("Unknown site");
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

  it("rejects a file stamped with another practice", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(rcmFiles).values({
          tenantId: b.tenantId,
          uploadedBy: a.userId,
          filename: "x.csv",
          periodYear: 2026,
          periodMonth: 1,
          rowCount: 0,
          billedCents: 0,
          paymentCents: 0,
          balanceCents: 0,
          contraCents: 0,
          netCents: 0,
          excludedCount: 0,
          flaggedCount: 0,
        }),
      ),
      /row-level security/,
    );
  });
});
