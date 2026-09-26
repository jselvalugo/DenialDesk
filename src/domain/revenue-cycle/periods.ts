import { and, desc, eq, inArray } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { rcmFiles, rcmJournalVouchers } from "@/db/schema";
import { CURRENT_FORMAT_VERSION } from "./imports";

export interface PeriodFile {
  periodYear: number;
  periodMonth: number;
  fileId: string;
  /** The period's approved or exported voucher, if any (the books follow what was posted). */
  postedVoucherId: string | null;
}

export const periodKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/**
 * The file that counts for each period, oldest period first: the file of the period's approved
 * or exported journal voucher, else the most recent current-format import. Every period report uses this rule
 * (docs/specs/revenue-cycle-accounting.md).
 */
export async function periodFiles(tx: TenantTx): Promise<PeriodFile[]> {
  const [files, posted] = await Promise.all([
    tx
      .select({
        id: rcmFiles.id,
        periodYear: rcmFiles.periodYear,
        periodMonth: rcmFiles.periodMonth,
      })
      .from(rcmFiles)
      .where(eq(rcmFiles.formatVersion, CURRENT_FORMAT_VERSION))
      .orderBy(desc(rcmFiles.createdAt), desc(rcmFiles.id)),
    tx
      .select({
        id: rcmJournalVouchers.id,
        fileId: rcmJournalVouchers.fileId,
        periodYear: rcmJournalVouchers.periodYear,
        periodMonth: rcmJournalVouchers.periodMonth,
      })
      .from(rcmJournalVouchers)
      .where(inArray(rcmJournalVouchers.status, ["approved", "exported"])),
  ]);
  const byPeriod = new Map<string, PeriodFile>();
  for (const f of files) {
    const key = periodKey(f.periodYear, f.periodMonth);
    if (!byPeriod.has(key)) {
      byPeriod.set(key, {
        periodYear: f.periodYear,
        periodMonth: f.periodMonth,
        fileId: f.id,
        postedVoucherId: null,
      });
    }
  }
  for (const v of posted) {
    byPeriod.set(periodKey(v.periodYear, v.periodMonth), {
      periodYear: v.periodYear,
      periodMonth: v.periodMonth,
      fileId: v.fileId,
      postedVoucherId: v.id,
    });
  }
  return [...byPeriod.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, value]) => value);
}

/** The approved or exported voucher for a period, excluding one voucher (for check 5). */
export async function postedVoucherFor(tx: TenantTx, year: number, month: number) {
  const [voucher] = await tx
    .select({ id: rcmJournalVouchers.id, number: rcmJournalVouchers.number })
    .from(rcmJournalVouchers)
    .where(
      and(
        eq(rcmJournalVouchers.periodYear, year),
        eq(rcmJournalVouchers.periodMonth, month),
        inArray(rcmJournalVouchers.status, ["approved", "exported"]),
      ),
    )
    .limit(1);
  return voucher ?? null;
}
