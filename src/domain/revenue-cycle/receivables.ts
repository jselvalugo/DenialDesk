import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { canConfigureRevenueCycle, canRunRevenueCycle } from "@/auth/permissions";
import type { TenantTx } from "@/db/tenant";
import { rcmClaimLines, rcmDepositFiles, rcmDeposits, rcmFiles, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { createHash } from "node:crypto";
import { ageReceivables, reconcileDeposits, rollForward, type BucketKey, type DepositLine } from "./aging";
import { periodEnd } from "./monthly-file";
import { periodFiles } from "./periods";
import type { Actor } from "./vouchers";

// A/R aging, roll-forward, and deposits (docs/specs/revenue-cycle-accounting.md, B4). Reports
// hold totals only; deposit imports are audited with counts.

export class DepositError extends Error {}

/** Stores a parsed deposit file in the caller's transaction and audits it (counts only). */
export async function importDeposits(tx: TenantTx, actor: Actor, deposits: DepositLine[]): Promise<string> {
  if (!canRunRevenueCycle(actor.role))
    throw new DepositError("Only administrators and RCM managers can import deposits.");
  if (deposits.length === 0) throw new DepositError("The file has no deposits.");
  if (!deposits.every((d) => Number.isSafeInteger(d.amountCents) && d.amountCents !== 0)) {
    throw new DepositError("Deposit amounts must be whole, non-zero cents.");
  }
  const totalCents = deposits.reduce((t, d) => t + d.amountCents, 0);
  const contentHash = createHash("sha256")
    .update(JSON.stringify(deposits.map((d) => [d.depositDate, d.amountCents])))
    .digest("hex");
  const dates = deposits.map((d) => d.depositDate).sort();
  const [dateFrom, dateTo] = [dates[0]!, dates.at(-1)!];
  // Serialize deposit imports per practice so the duplicate and overlap checks hold.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rcm_deposits:${actor.tenantId}`}))`);
  const [existing] = await tx
    .select({ id: rcmDepositFiles.id })
    .from(rcmDepositFiles)
    .where(and(eq(rcmDepositFiles.contentHash, contentHash), isNull(rcmDepositFiles.reversesFileId)))
    .limit(1);
  if (existing) throw new DepositError("This deposit file was already imported.");
  // Bank exports often cover overlapping ranges; importing one twice would double deposits.
  const reversed = tx
    .select({ id: rcmDepositFiles.reversesFileId })
    .from(rcmDepositFiles)
    .where(isNotNull(rcmDepositFiles.reversesFileId));
  const [overlap] = await tx
    .select({ from: rcmDepositFiles.dateFrom, to: rcmDepositFiles.dateTo })
    .from(rcmDepositFiles)
    .where(
      and(
        isNull(rcmDepositFiles.reversesFileId),
        notInArray(rcmDepositFiles.id, reversed),
        lte(rcmDepositFiles.dateFrom, dateTo),
        gte(rcmDepositFiles.dateTo, dateFrom),
      ),
    )
    .limit(1);
  if (overlap) {
    throw new DepositError(
      `These deposits overlap a file already imported (${overlap.from} to ${overlap.to}). Export only the new dates, or reverse the earlier file first.`,
    );
  }
  const [file] = await tx
    .insert(rcmDepositFiles)
    .values({
      tenantId: actor.tenantId,
      uploadedBy: actor.userId,
      rowCount: deposits.length,
      totalCents,
      contentHash,
      dateFrom,
      dateTo,
    })
    .returning({ id: rcmDepositFiles.id });
  const fileId = file!.id;
  for (let i = 0; i < deposits.length; i += 1_000) {
    await tx.insert(rcmDeposits).values(
      deposits.slice(i, i + 1_000).map((d) => ({
        tenantId: actor.tenantId,
        fileId,
        rowNumber: d.rowNumber,
        depositDate: d.depositDate,
        amountCents: d.amountCents,
      })),
    );
  }
  await audit(tx, {
    action: "rcm.deposits_imported",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "rcm_deposit_file",
    entityId: fileId,
    metadata: { rows: deposits.length },
  });
  return fileId;
}

/**
 * Cancels an imported deposit file with a reversing file of negated rows (administrators, with a
 * reason). Deposits are never edited or deleted; each file can be reversed once.
 */
export async function reverseDepositFile(tx: TenantTx, actor: Actor, fileId: string, reason: string) {
  if (!canConfigureRevenueCycle(actor.role))
    throw new DepositError("Only administrators can reverse deposit files.");
  const trimmed = reason.trim();
  if (trimmed.length < 10 || trimmed.length > 500)
    throw new DepositError("Give a reason of 10 to 500 characters.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rcm_deposits:${actor.tenantId}`}))`);
  const [file] = await tx.select().from(rcmDepositFiles).where(eq(rcmDepositFiles.id, fileId)).limit(1);
  if (!file) throw new DepositError("That deposit file doesn't exist.");
  if (file.reversesFileId) throw new DepositError("A reversing file can't be reversed.");
  const [already] = await tx
    .select({ id: rcmDepositFiles.id })
    .from(rcmDepositFiles)
    .where(eq(rcmDepositFiles.reversesFileId, fileId))
    .limit(1);
  if (already) throw new DepositError("This file was already reversed.");
  const rows = await tx.select().from(rcmDeposits).where(eq(rcmDeposits.fileId, fileId));
  const [reversal] = await tx
    .insert(rcmDepositFiles)
    .values({
      tenantId: actor.tenantId,
      uploadedBy: actor.userId,
      rowCount: rows.length,
      totalCents: -file.totalCents,
      dateFrom: file.dateFrom,
      dateTo: file.dateTo,
      reversesFileId: fileId,
    })
    .returning({ id: rcmDepositFiles.id });
  await tx.insert(rcmDeposits).values(
    rows.map((r) => ({
      tenantId: actor.tenantId,
      fileId: reversal!.id,
      rowNumber: r.rowNumber,
      depositDate: r.depositDate,
      amountCents: -r.amountCents,
    })),
  );
  await audit(tx, {
    action: "rcm.deposits_reversed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "rcm_deposit_file",
    entityId: fileId,
    reason: trimmed,
    metadata: { reversalFileId: reversal!.id, rows: rows.length },
  });
  return reversal!.id;
}

export async function listDepositFiles(tx: TenantTx) {
  const reversal = alias(rcmDepositFiles, "reversal");
  return tx
    .select({
      id: rcmDepositFiles.id,
      rowCount: rcmDepositFiles.rowCount,
      totalCents: rcmDepositFiles.totalCents,
      dateFrom: rcmDepositFiles.dateFrom,
      dateTo: rcmDepositFiles.dateTo,
      reversesFileId: rcmDepositFiles.reversesFileId,
      reversedBy: reversal.id,
      uploadedBy: users.displayName,
      createdAt: rcmDepositFiles.createdAt,
    })
    .from(rcmDepositFiles)
    .leftJoin(users, eq(users.id, rcmDepositFiles.uploadedBy))
    .leftJoin(reversal, eq(reversal.reversesFileId, rcmDepositFiles.id))
    .orderBy(desc(rcmDepositFiles.createdAt));
}

/**
 * Aging for one month (the latest by default), plus the roll-forward and deposit reconciliation
 * for every month that has a current-format file.
 */
export async function receivablesReport(tx: TenantTx, month?: { year: number; month: number }) {
  const periods = await periodFiles(tx);
  if (periods.length === 0) return null;
  const selected =
    (month && periods.find((p) => p.periodYear === month.year && p.periodMonth === month.month)) ??
    periods.at(-1)!;

  const files = await tx
    .select({
      id: rcmFiles.id,
      chargesCents: rcmFiles.billedCents,
      paymentsCents: rcmFiles.paymentCents,
      adjustmentsCents: rcmFiles.adjustmentCents,
      balanceCents: rcmFiles.balanceCents,
    })
    .from(rcmFiles)
    .where(
      inArray(
        rcmFiles.id,
        periods.map((p) => p.fileId),
      ),
    );
  const totals = new Map(files.map((f) => [f.id, f]));
  const months = periods.map((p) => ({
    periodYear: p.periodYear,
    periodMonth: p.periodMonth,
    ...totals.get(p.fileId)!,
  }));

  const asOf = periodEnd(selected.periodYear, selected.periodMonth);
  // Bucketed in the database (mirrors bucketFor in aging.ts), so only totals leave it.
  const age = sql`(${asOf}::date - ${rcmClaimLines.serviceDate})`;
  const bucket = sql<BucketKey | null>`case
    when ${rcmClaimLines.balanceCents} < 0 then null
    when ${age} <= 30 then '0_30'
    when ${age} <= 60 then '31_60'
    when ${age} <= 90 then '61_90'
    when ${age} <= 120 then '91_120'
    else 'over_120' end`;
  const agingRows = await tx
    .select({
      payerClass: rcmClaimLines.payerClass,
      bucket,
      cents: sql<number>`sum(${rcmClaimLines.balanceCents})::bigint`.mapWith(Number),
      lines: sql<number>`count(*)::int`,
    })
    .from(rcmClaimLines)
    .where(and(eq(rcmClaimLines.fileId, selected.fileId), ne(rcmClaimLines.balanceCents, 0)))
    // By position: the bucket expression carries a parameter, so it can't be repeated verbatim.
    .groupBy(sql`1`, sql`2`);
  // Deposits summed by month in the database, only for the months shown.
  const first = periodEnd(periods[0]!.periodYear, periods[0]!.periodMonth).slice(0, 8) + "01";
  const last = periodEnd(periods.at(-1)!.periodYear, periods.at(-1)!.periodMonth);
  const depositMonth = sql<string>`to_char(${rcmDeposits.depositDate}, 'YYYY-MM-01')`;
  const deposits = await tx
    .select({
      depositDate: depositMonth,
      amountCents: sql<number>`sum(${rcmDeposits.amountCents})::bigint`.mapWith(Number),
    })
    .from(rcmDeposits)
    .where(and(gte(rcmDeposits.depositDate, first), lte(rcmDeposits.depositDate, last)))
    .groupBy(depositMonth);

  return {
    periods,
    selected,
    asOf,
    aging: ageReceivables(agingRows),
    rollForward: rollForward(months),
    reconciliation: reconcileDeposits(months, deposits),
  };
}

/** Current-format months that have no deposits yet (what the synthetic sample may cover). */
export async function monthsWithoutDeposits(tx: TenantTx) {
  const periods = await periodFiles(tx);
  if (periods.length === 0) return [];
  const month = sql<string>`to_char(${rcmDeposits.depositDate}, 'YYYY-MM')`;
  const covered = new Set((await tx.select({ month }).from(rcmDeposits).groupBy(month)).map((r) => r.month));
  const files = await tx
    .select({ id: rcmFiles.id, paymentsCents: rcmFiles.paymentCents })
    .from(rcmFiles)
    .where(
      inArray(
        rcmFiles.id,
        periods.map((p) => p.fileId),
      ),
    );
  const payments = new Map(files.map((f) => [f.id, f.paymentsCents]));
  return periods
    .filter((p) => !covered.has(`${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`))
    .map((p) => ({
      periodYear: p.periodYear,
      periodMonth: p.periodMonth,
      paymentsCents: payments.get(p.fileId)!,
    }));
}
