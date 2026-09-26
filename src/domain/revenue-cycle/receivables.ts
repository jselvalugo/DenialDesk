import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { canRunRevenueCycle } from "@/auth/permissions";
import type { TenantTx } from "@/db/tenant";
import { rcmClaimLines, rcmDepositFiles, rcmDeposits, rcmFiles, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ageReceivables, reconcileDeposits, rollForward, type DepositLine } from "./aging";
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
  const [file] = await tx
    .insert(rcmDepositFiles)
    .values({ tenantId: actor.tenantId, uploadedBy: actor.userId, rowCount: deposits.length, totalCents })
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

export async function listDepositFiles(tx: TenantTx) {
  return tx
    .select({
      id: rcmDepositFiles.id,
      rowCount: rcmDepositFiles.rowCount,
      totalCents: rcmDepositFiles.totalCents,
      uploadedBy: users.displayName,
      createdAt: rcmDepositFiles.createdAt,
    })
    .from(rcmDepositFiles)
    .leftJoin(users, eq(users.id, rcmDepositFiles.uploadedBy))
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
  const lines = await tx
    .select({
      payerClass: rcmClaimLines.payerClass,
      serviceDate: rcmClaimLines.serviceDate,
      balanceCents: rcmClaimLines.balanceCents,
    })
    .from(rcmClaimLines)
    .where(and(eq(rcmClaimLines.fileId, selected.fileId), ne(rcmClaimLines.balanceCents, 0)));
  const first = periodEnd(periods[0]!.periodYear, periods[0]!.periodMonth).slice(0, 8) + "01";
  const deposits = await tx
    .select({ depositDate: rcmDeposits.depositDate, amountCents: rcmDeposits.amountCents })
    .from(rcmDeposits);

  return {
    periods,
    selected,
    asOf,
    aging: ageReceivables(lines, asOf),
    rollForward: rollForward(months),
    reconciliation: reconcileDeposits(
      months,
      deposits.filter((d) => d.depositDate >= first),
    ),
  };
}
