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
import type { MessageKey } from "@/i18n/messages/types";
import type { Params } from "@/i18n/translate";
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
import { CURRENT_FORMAT_VERSION, periodLabel } from "./imports";
import { englishRevenue, type RevenueT } from "./i18n";
import { periodFiles, postedVoucherFor } from "./periods";

// Journal voucher workflow (docs/specs/revenue-cycle-accounting.md, B3). Every function runs in
// the caller's tenant transaction; every state change is audited with IDs and counts only.

export interface Actor {
  tenantId: string;
  userId: string;
  role: Role;
}

/**
 * A refused voucher operation. `message` is rendered eagerly (English by default); the catching
 * server action re-renders `key`/`params` in the request's language for the person to see.
 */
export class VoucherError extends Error {
  constructor(
    readonly key: MessageKey<"revenue">,
    readonly params?: Params,
    t: RevenueT = englishRevenue,
  ) {
    super(t(key, params));
  }
}

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

/**
 * Opening (the prior month's file) and closing receivables for a month's file. The practice's
 * first imported month has no opening (its opening balances are in the GL); any later month whose
 * prior month has no current-format file is a gap that must be filled first.
 */
async function voucherBalances(tx: TenantTx, fileId: string, year: number, month: number) {
  const prior = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const periods = await periodFiles(tx);
  const priorFile = periods.find((p) => p.periodYear === prior.year && p.periodMonth === prior.month);
  const hasEarlier = periods.some((p) => p.periodYear * 12 + p.periodMonth < year * 12 + month);
  return {
    opening: priorFile ? await fileBalances(tx, priorFile.fileId) : null,
    closing: await fileBalances(tx, fileId),
    missingPrior: !priorFile && hasEarlier ? periodLabel(prior.year, prior.month) : null,
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
export async function prepareVoucher(
  tx: TenantTx,
  actor: Actor,
  fileId: string,
  t: RevenueT = englishRevenue,
): Promise<string> {
  if (!canRunRevenueCycle(actor.role))
    throw new VoucherError("voucher.error.onlyManagersPrepare", undefined, t);
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
  if (!file) throw new VoucherError("voucher.error.fileNotFound", undefined, t);
  if (file.formatVersion !== CURRENT_FORMAT_VERSION) {
    throw new VoucherError("voucher.error.earlierLayout", undefined, t);
  }
  const { periodYear, periodMonth } = file;
  // Serialize per period so versions and the one-draft rule hold under concurrent clicks.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`rcm_voucher:${actor.tenantId}:${periodYear}-${periodMonth}`}))`,
  );
  const posted = await postedVoucherFor(tx, periodYear, periodMonth);
  if (posted) throw new VoucherError("voucher.error.alreadyApproved", { number: posted.number }, t);

  const [clearing] = await tx
    .select({ number: glAccounts.number })
    .from(glAccounts)
    .where(eq(glAccounts.isPaymentsClearing, true))
    .limit(1);
  if (!clearing) throw new VoucherError("voucher.error.noClearingAccount", undefined, t);
  const balances = await voucherBalances(tx, fileId, periodYear, periodMonth);
  const lines = buildVoucherLines(
    await fileGroups(tx, fileId),
    periodYear,
    periodMonth,
    clearing.number,
    balances.opening ? { opening: balances.opening, closing: balances.closing } : undefined,
  );
  if (lines.length === 0) throw new VoucherError("voucher.error.noLines", undefined, t);
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
  for (const old of superseded) {
    await audit(tx, {
      action: "rcm.voucher_superseded",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "rcm_voucher",
      entityId: old.id,
      metadata: { replacedBy: voucherId },
    });
  }
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

/**
 * A voucher with its lines and the five checks, recomputed now. `lock` takes a row lock first so
 * approval, export, and void can't interleave on the same voucher.
 */
export async function getVoucher(
  tx: TenantTx,
  voucherId: string,
  options: { lock?: boolean } = {},
  t: RevenueT = englishRevenue,
) {
  if (options.lock) {
    const [locked] = await tx
      .select({ id: rcmJournalVouchers.id })
      .from(rcmJournalVouchers)
      .where(eq(rcmJournalVouchers.id, voucherId))
      .for("update");
    if (!locked) return null;
  }
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
  const checks = checkVoucher(
    {
      lines,
      source: await sourceTotals(tx, voucher.fileId),
      accounts: await chart(tx),
      otherPostedVoucher: posted && posted.id !== voucher.id ? posted.number : null,
      balances: await voucherBalances(tx, voucher.fileId, voucher.periodYear, voucher.periodMonth),
    },
    t,
  );
  return { ...row, lines, checks };
}

/** Approves a draft: manager or admin, not the preparer, all five checks passing. */
export async function approveVoucher(
  tx: TenantTx,
  actor: Actor,
  voucherId: string,
  t: RevenueT = englishRevenue,
) {
  if (!canRunRevenueCycle(actor.role))
    throw new VoucherError("voucher.error.onlyManagersApprove", undefined, t);
  const detail = await getVoucher(tx, voucherId, { lock: true }, t);
  if (!detail) throw new VoucherError("voucher.error.voucherNotFound", undefined, t);
  if (detail.voucher.status !== "draft")
    throw new VoucherError("voucher.error.onlyDraftApprovable", undefined, t);
  if (detail.voucher.preparedBy === actor.userId) {
    throw new VoucherError("voucher.error.preparerCannotApprove", undefined, t);
  }
  if (!allPassed(detail.checks)) throw new VoucherError("voucher.error.checksMustPass", undefined, t);
  const updated = await tx
    .update(rcmJournalVouchers)
    .set({ status: "approved", approvedBy: actor.userId, approvedAt: new Date() })
    .where(and(eq(rcmJournalVouchers.id, voucherId), eq(rcmJournalVouchers.status, "draft")))
    .returning({ id: rcmJournalVouchers.id });
  if (updated.length === 0) throw new VoucherError("voucher.error.changed", undefined, t);
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
export async function exportVoucher(
  tx: TenantTx,
  actor: Actor,
  voucherId: string,
  t: RevenueT = englishRevenue,
) {
  if (!canRunRevenueCycle(actor.role))
    throw new VoucherError("voucher.error.onlyManagersExport", undefined, t);
  const detail = await getVoucher(tx, voucherId, { lock: true }, t);
  if (!detail) throw new VoucherError("voucher.error.voucherNotFound", undefined, t);
  const { voucher } = detail;
  if (voucher.status !== "approved" && voucher.status !== "exported") {
    throw new VoucherError("voucher.error.onlyApprovedExportable", undefined, t);
  }
  if (!allPassed(detail.checks)) throw new VoucherError("voucher.error.checkFailedNow", undefined, t);
  let firstExport = false;
  if (voucher.status === "approved") {
    const updated = await tx
      .update(rcmJournalVouchers)
      .set({ status: "exported", exportedBy: actor.userId, exportedAt: new Date() })
      .where(and(eq(rcmJournalVouchers.id, voucherId), eq(rcmJournalVouchers.status, "approved")))
      .returning({ id: rcmJournalVouchers.id });
    if (updated.length === 0) throw new VoucherError("voucher.error.changed", undefined, t);
    firstExport = true;
  }
  await audit(tx, {
    action: "rcm.voucher_exported",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "rcm_voucher",
    entityId: voucherId,
    metadata: { lines: detail.lines.length, firstExport },
  });
  return { filename: `${voucher.number}.csv`, csv: voucherCsv(voucher, detail.lines) };
}

/**
 * Voids an approved or exported voucher (administrators, with a reason) so the month can be
 * prepared again. An exported voucher is already in the general ledger, so the administrator must
 * confirm it was reversed there first, or the month would be posted twice.
 */
export async function voidVoucher(
  tx: TenantTx,
  actor: Actor,
  voucherId: string,
  reason: string,
  options: { reversedInGl?: boolean } = {},
  t: RevenueT = englishRevenue,
) {
  if (!canConfigureRevenueCycle(actor.role))
    throw new VoucherError("voucher.error.onlyAdminVoid", undefined, t);
  const trimmed = reason.trim();
  if (trimmed.length < 10 || trimmed.length > 500) throw new VoucherError("error.reasonLength", undefined, t);
  const [voucher] = await tx
    .select({ status: rcmJournalVouchers.status })
    .from(rcmJournalVouchers)
    .where(eq(rcmJournalVouchers.id, voucherId))
    .for("update");
  if (!voucher) throw new VoucherError("voucher.error.voucherNotFound", undefined, t);
  if (voucher.status !== "approved" && voucher.status !== "exported") {
    throw new VoucherError("voucher.error.onlyApprovedOrExportedVoidable", undefined, t);
  }
  if (voucher.status === "exported" && !options.reversedInGl) {
    throw new VoucherError("voucher.error.confirmReversedInGl", undefined, t);
  }
  const updated = await tx
    .update(rcmJournalVouchers)
    .set({ status: "void", voidedBy: actor.userId, voidedAt: new Date(), voidReason: trimmed })
    .where(and(eq(rcmJournalVouchers.id, voucherId), eq(rcmJournalVouchers.status, voucher.status)))
    .returning({ id: rcmJournalVouchers.id });
  if (updated.length === 0) throw new VoucherError("voucher.error.changed", undefined, t);
  await audit(tx, {
    action: "rcm.voucher_voided",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "rcm_voucher",
    entityId: voucherId,
    reason: trimmed,
    metadata: { previousStatus: voucher.status, reversedInGl: voucher.status === "exported" },
  });
}
