import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Role } from "@/auth/session";
import { canConfigureRevenueCycle, canRunRevenueCycle } from "@/auth/permissions";
import type { TenantTx } from "@/db/tenant";
import {
  glAccounts,
  rcmClaimLines,
  rcmFiles,
  rcmJournalLines,
  rcmJournalVouchers,
  rcmSites,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  allPassed,
  balanceKey,
  buildVoucherLines,
  checkVoucher,
  voucherCsv,
  voucherNumber,
  type AccountKind,
  type Balances,
} from "./journal";
import { CURRENT_FORMAT_VERSION } from "./imports";
import { periodFiles, postedVoucherFor } from "./periods";

// Journal voucher workflow (docs/specs/revenue-cycle-accounting.md, B3). Every function runs in
// the caller's tenant transaction; every state change is audited with IDs and counts only.

export interface Actor {
  tenantId: string;
  userId: string;
  role: Role;
}

export class VoucherError extends Error {}

/** A file's totals by site and accounts. */
async function fileGroups(tx: TenantTx, fileId: string) {
  return tx
    .select({
      siteCode: sql<string>`coalesce(${rcmSites.code}, '')`,
      arGl: rcmClaimLines.arGl,
      revenueGl: rcmClaimLines.revenueGl,
      adjustmentGl: rcmClaimLines.adjustmentGl,
      grossCents: sql<number>`sum(${rcmClaimLines.billedCents})::bigint`.mapWith(Number),
      adjustmentCents: sql<number>`sum(${rcmClaimLines.adjustmentCents})::bigint`.mapWith(Number),
      paymentCents: sql<number>`sum(${rcmClaimLines.paymentCents})::bigint`.mapWith(Number),
    })
    .from(rcmClaimLines)
    .leftJoin(rcmSites, eq(rcmSites.id, rcmClaimLines.siteId))
    .where(eq(rcmClaimLines.fileId, fileId))
    .groupBy(rcmSites.code, rcmClaimLines.arGl, rcmClaimLines.revenueGl, rcmClaimLines.adjustmentGl);
}

/** A file's open balances by site and AR account. */
async function fileBalances(tx: TenantTx, fileId: string): Promise<Balances> {
  const rows = await tx
    .select({
      siteCode: sql<string>`coalesce(${rcmSites.code}, '')`,
      arGl: rcmClaimLines.arGl,
      balanceCents: sql<number>`sum(${rcmClaimLines.balanceCents})::bigint`.mapWith(Number),
    })
    .from(rcmClaimLines)
    .leftJoin(rcmSites, eq(rcmSites.id, rcmClaimLines.siteId))
    .where(eq(rcmClaimLines.fileId, fileId))
    .groupBy(rcmSites.code, rcmClaimLines.arGl);
  return new Map(rows.map((r) => [balanceKey(r.siteCode, r.arGl), r.balanceCents]));
}

/** Opening (the prior month's file, if any) and closing receivables for a month's file. */
async function voucherBalances(tx: TenantTx, fileId: string, year: number, month: number) {
  const prior = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const priorFile = (await periodFiles(tx)).find(
    (p) => p.periodYear === prior.year && p.periodMonth === prior.month,
  );
  return {
    opening: priorFile ? await fileBalances(tx, priorFile.fileId) : null,
    closing: await fileBalances(tx, fileId),
  };
}

async function sourceTotals(tx: TenantTx, fileId: string) {
  const groups = await fileGroups(tx, fileId);
  return {
    grossCents: groups.reduce((t, g) => t + g.grossCents, 0),
    adjustmentCents: groups.reduce((t, g) => t + g.adjustmentCents, 0),
    paymentCents: groups.reduce((t, g) => t + g.paymentCents, 0),
  };
}

async function chart(tx: TenantTx) {
  const rows = await tx.select({ number: glAccounts.number, kind: glAccounts.kind }).from(glAccounts);
  return new Map<string, AccountKind>(rows.map((r) => [r.number, r.kind]));
}

/**
 * Prepares a draft voucher from a monthly file. Any earlier draft for the period is superseded;
 * a period that already has an approved or exported voucher must have it voided first.
 */
export async function prepareVoucher(tx: TenantTx, actor: Actor, fileId: string): Promise<string> {
  if (!canRunRevenueCycle(actor.role))
    throw new VoucherError("Only administrators and RCM managers can prepare vouchers.");
  const [file] = await tx
    .select({
      id: rcmFiles.id,
      periodYear: rcmFiles.periodYear,
      periodMonth: rcmFiles.periodMonth,
      formatVersion: rcmFiles.formatVersion,
    })
    .from(rcmFiles)
    .where(eq(rcmFiles.id, fileId))
    .limit(1);
  if (!file) throw new VoucherError("That file doesn't exist.");
  if (file.formatVersion !== CURRENT_FORMAT_VERSION) {
    throw new VoucherError("This file uses an earlier layout. Import the month's activity file again.");
  }
  const { periodYear, periodMonth } = file;
  // Serialize per period so versions and the one-draft rule hold under concurrent clicks.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`rcm_voucher:${actor.tenantId}:${periodYear}-${periodMonth}`}))`,
  );
  const posted = await postedVoucherFor(tx, periodYear, periodMonth);
  if (posted)
    throw new VoucherError(`Voucher ${posted.number} is already approved for this period. Void it first.`);

  const [clearing] = await tx
    .select({ number: glAccounts.number })
    .from(glAccounts)
    .where(eq(glAccounts.isPaymentsClearing, true))
    .limit(1);
  if (!clearing) throw new VoucherError("Set a payments clearing account in the chart of accounts first.");
  const balances = await voucherBalances(tx, fileId, periodYear, periodMonth);
  const lines = buildVoucherLines(
    await fileGroups(tx, fileId),
    periodYear,
    periodMonth,
    clearing.number,
    balances.opening ? { opening: balances.opening, closing: balances.closing } : undefined,
  );
  if (lines.length === 0) throw new VoucherError("The file has no lines to post.");
  const samePeriod = and(
    eq(rcmJournalVouchers.periodYear, periodYear),
    eq(rcmJournalVouchers.periodMonth, periodMonth),
  );
  const superseded = await tx
    .update(rcmJournalVouchers)
    .set({ status: "superseded" })
    .where(and(samePeriod, eq(rcmJournalVouchers.status, "draft")))
    .returning({ id: rcmJournalVouchers.id });
  const [{ last } = { last: 0 }] = await tx
    .select({ last: max(rcmJournalVouchers.version) })
    .from(rcmJournalVouchers)
    .where(samePeriod);
  const version = (last ?? 0) + 1;
  const [voucher] = await tx
    .insert(rcmJournalVouchers)
    .values({
      tenantId: actor.tenantId,
      fileId,
      periodYear,
      periodMonth,
      version,
      number: voucherNumber(periodYear, periodMonth, version),
      debitCents: lines.reduce((t, l) => t + l.debitCents, 0),
      creditCents: lines.reduce((t, l) => t + l.creditCents, 0),
      preparedBy: actor.userId,
    })
    .returning({ id: rcmJournalVouchers.id });
  const voucherId = voucher!.id;
  await tx.insert(rcmJournalLines).values(lines.map((l) => ({ ...l, tenantId: actor.tenantId, voucherId })));
  await audit(tx, {
    action: "rcm.voucher_prepared",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "rcm_voucher",
    entityId: voucherId,
    metadata: { fileId, lines: lines.length, version, superseded: superseded.length },
  });
  return voucherId;
}

const preparer = alias(users, "preparer");
const approver = alias(users, "approver");
const exporter = alias(users, "exporter");
const voider = alias(users, "voider");

export async function listVouchers(tx: TenantTx) {
  return tx
    .select({
      id: rcmJournalVouchers.id,
      number: rcmJournalVouchers.number,
      periodYear: rcmJournalVouchers.periodYear,
      periodMonth: rcmJournalVouchers.periodMonth,
      status: rcmJournalVouchers.status,
      debitCents: rcmJournalVouchers.debitCents,
      fileId: rcmJournalVouchers.fileId,
      preparedBy: preparer.displayName,
      createdAt: rcmJournalVouchers.createdAt,
    })
    .from(rcmJournalVouchers)
    .leftJoin(preparer, eq(preparer.id, rcmJournalVouchers.preparedBy))
    .orderBy(
      desc(rcmJournalVouchers.periodYear),
      desc(rcmJournalVouchers.periodMonth),
      desc(rcmJournalVouchers.version),
    );
}

/** A voucher with its lines and the five checks, recomputed now. */
export async function getVoucher(tx: TenantTx, voucherId: string) {
  const [row] = await tx
    .select({
      voucher: rcmJournalVouchers,
      preparedByName: preparer.displayName,
      approvedByName: approver.displayName,
      exportedByName: exporter.displayName,
      voidedByName: voider.displayName,
    })
    .from(rcmJournalVouchers)
    .leftJoin(preparer, eq(preparer.id, rcmJournalVouchers.preparedBy))
    .leftJoin(approver, eq(approver.id, rcmJournalVouchers.approvedBy))
    .leftJoin(exporter, eq(exporter.id, rcmJournalVouchers.exportedBy))
    .leftJoin(voider, eq(voider.id, rcmJournalVouchers.voidedBy))
    .where(eq(rcmJournalVouchers.id, voucherId))
    .limit(1);
  if (!row) return null;
  const { voucher } = row;
  const lines = await tx
    .select()
    .from(rcmJournalLines)
    .where(eq(rcmJournalLines.voucherId, voucherId))
    .orderBy(asc(rcmJournalLines.lineNumber));
  const posted = await postedVoucherFor(tx, voucher.periodYear, voucher.periodMonth);
  const checks = checkVoucher({
    lines,
    source: await sourceTotals(tx, voucher.fileId),
    accounts: await chart(tx),
    otherPostedVoucher: posted && posted.id !== voucher.id ? posted.number : null,
    balances: await voucherBalances(tx, voucher.fileId, voucher.periodYear, voucher.periodMonth),
  });
  return { ...row, lines, checks };
}

/** Approves a draft: manager or admin, not the preparer, all five checks passing. */
export async function approveVoucher(tx: TenantTx, actor: Actor, voucherId: string) {
  if (!canRunRevenueCycle(actor.role))
    throw new VoucherError("Only administrators and RCM managers can approve vouchers.");
  const detail = await getVoucher(tx, voucherId);
  if (!detail) throw new VoucherError("That voucher doesn't exist.");
  if (detail.voucher.status !== "draft") throw new VoucherError("Only draft vouchers can be approved.");
  if (detail.voucher.preparedBy === actor.userId) {
    throw new VoucherError("Someone other than the preparer must approve the voucher.");
  }
  if (!allPassed(detail.checks)) throw new VoucherError("All five checks must pass before approval.");
  const updated = await tx
    .update(rcmJournalVouchers)
    .set({ status: "approved", approvedBy: actor.userId, approvedAt: new Date() })
    .where(and(eq(rcmJournalVouchers.id, voucherId), eq(rcmJournalVouchers.status, "draft")))
    .returning({ id: rcmJournalVouchers.id });
  if (updated.length === 0) throw new VoucherError("The voucher changed. Reload and try again.");
  await audit(tx, {
    action: "rcm.voucher_approved",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "rcm_voucher",
    entityId: voucherId,
    metadata: { lines: detail.lines.length },
  });
}

/**
 * The GL import CSV of an approved or exported voucher. The first export marks it exported;
 * every download is audited. Checks are re-run so a changed chart can't be exported silently.
 */
export async function exportVoucher(tx: TenantTx, actor: Actor, voucherId: string) {
  if (!canRunRevenueCycle(actor.role))
    throw new VoucherError("Only administrators and RCM managers can export vouchers.");
  const detail = await getVoucher(tx, voucherId);
  if (!detail) throw new VoucherError("That voucher doesn't exist.");
  const { voucher } = detail;
  if (voucher.status !== "approved" && voucher.status !== "exported") {
    throw new VoucherError("Only approved vouchers can be exported.");
  }
  if (!allPassed(detail.checks))
    throw new VoucherError("A check no longer passes. Void the voucher and prepare it again.");
  if (voucher.status === "approved") {
    await tx
      .update(rcmJournalVouchers)
      .set({ status: "exported", exportedBy: actor.userId, exportedAt: new Date() })
      .where(and(eq(rcmJournalVouchers.id, voucherId), eq(rcmJournalVouchers.status, "approved")));
  }
  await audit(tx, {
    action: "rcm.voucher_exported",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "rcm_voucher",
    entityId: voucherId,
    metadata: { lines: detail.lines.length, firstExport: voucher.status === "approved" },
  });
  return { filename: `${voucher.number}.csv`, csv: voucherCsv(voucher, detail.lines) };
}

/** Voids a voucher (administrators, with a reason) so the period can be prepared again. */
export async function voidVoucher(tx: TenantTx, actor: Actor, voucherId: string, reason: string) {
  if (!canConfigureRevenueCycle(actor.role)) throw new VoucherError("Only administrators can void vouchers.");
  const trimmed = reason.trim();
  if (trimmed.length < 10 || trimmed.length > 500)
    throw new VoucherError("Give a reason of 10 to 500 characters.");
  const [voucher] = await tx
    .select({ status: rcmJournalVouchers.status })
    .from(rcmJournalVouchers)
    .where(eq(rcmJournalVouchers.id, voucherId))
    .limit(1);
  if (!voucher) throw new VoucherError("That voucher doesn't exist.");
  if (voucher.status === "void" || voucher.status === "superseded") {
    throw new VoucherError("This voucher is no longer active.");
  }
  await tx
    .update(rcmJournalVouchers)
    .set({ status: "void", voidedBy: actor.userId, voidedAt: new Date(), voidReason: trimmed })
    .where(and(eq(rcmJournalVouchers.id, voucherId), eq(rcmJournalVouchers.status, voucher.status)));
  await audit(tx, {
    action: "rcm.voucher_voided",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "rcm_voucher",
    entityId: voucherId,
    reason: trimmed,
    metadata: { previousStatus: voucher.status },
  });
}
