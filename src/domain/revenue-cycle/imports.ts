import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { rcmClaimLines, rcmFiles, rcmSites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { CPT_FORMAT, prepareEngine } from "./engine";
import { periodEnd, type MonthlyLine } from "./monthly-file";
import { loadEngineConfig } from "./setup";

/** "March 2026" for a file's accounting period. */
export const periodLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** Why a line needs a person to look at it (stored on the line, shown on the file page). */
export const REVIEW_REASONS = {
  no_activity: "No charges, payments, adjustments, or balance",
  blank_code: "Blank procedure code",
  invalid_code: "Procedure code isn't five letters or digits",
  after_period: "Service date after the period",
  credit_balance: "Credit balance (possible refund due)",
} as const;
export type ReviewReason = keyof typeof REVIEW_REASONS;

export function reviewReasons(line: MonthlyLine, lastDay: string): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (
    line.billedCents === 0 &&
    line.paymentCents === 0 &&
    line.adjustmentCents === 0 &&
    line.balanceCents === 0
  ) {
    reasons.push("no_activity");
  }
  if (line.cpt === "") reasons.push("blank_code");
  else if (!CPT_FORMAT.test(line.cpt)) reasons.push("invalid_code");
  if (line.serviceDate > lastDay) reasons.push("after_period");
  if (line.balanceCents < 0) reasons.push("credit_balance");
  return reasons;
}

/** Lines are inserted in chunks to stay far below PostgreSQL's parameter limit. */
const CHUNK = 500;

export interface ImportInput {
  tenantId: string;
  userId: string;
  periodYear: number;
  periodMonth: number;
  /** Site for lines whose facility doesn't name a site; null = none. */
  defaultSiteId: string | null;
  lines: MonthlyLine[];
}

/** Picks the site whose name appears in the facility text (longest name wins), else the default. */
export function siteFor(facility: string, sites: { id: string; name: string }[], fallback: string | null) {
  const text = facility.toLowerCase();
  const match = sites
    .filter((s) => s.name.trim() !== "" && text.includes(s.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return match?.id ?? fallback;
}

/** Month-end activity layout (monthly-file.ts); older imports are version 1. */
export const CURRENT_FORMAT_VERSION = 2;

/**
 * Routes every line with the practice's rules and stores the file and its lines in the
 * caller's transaction: all or nothing. Audited with IDs and counts only.
 */
export async function importMonthlyFile(tx: TenantTx, input: ImportInput): Promise<string> {
  const classify = prepareEngine(await loadEngineConfig(tx));
  const sites = await tx.select({ id: rcmSites.id, name: rcmSites.name }).from(rcmSites);
  if (input.defaultSiteId && !sites.some((s) => s.id === input.defaultSiteId)) {
    // FKs bypass RLS, so a site ID from a form is checked against this tenant's sites.
    throw new Error("Unknown site");
  }

  // Service after the period can't be in this month's file; earlier dates are normal (older open
  // lines and late charges).
  const lastDay = periodEnd(input.periodYear, input.periodMonth);
  const rows = input.lines.map((line) => {
    const result = classify({
      status: line.status,
      payerClass: line.payerClass,
      cpt: line.cpt,
      description: line.description,
      facility: line.facility,
    });
    const reasons = reviewReasons(line, lastDay);
    return {
      tenantId: input.tenantId,
      rowNumber: line.rowNumber,
      patientName: line.patientName,
      accountNumber: line.accountNumber,
      serviceDate: line.serviceDate,
      cpt: line.cpt,
      description: line.description,
      facility: line.facility,
      payerName: line.payerName,
      payerClass: line.payerClass,
      status: line.status,
      billedCents: line.billedCents,
      paymentCents: line.paymentCents,
      adjustmentCents: line.adjustmentCents,
      balanceCents: line.balanceCents,
      siteId: siteFor(line.facility, sites, input.defaultSiteId),
      ruleCode: result.ruleCode,
      netCents: line.billedCents - line.adjustmentCents,
      arGl: result.arGl,
      revenueGl: result.revenueGl,
      adjustmentGl: result.adjustmentGl,
      flagged: reasons.length > 0,
      reviewReasons: reasons,
    };
  });
  const sum = (key: "billedCents" | "paymentCents" | "adjustmentCents" | "balanceCents" | "netCents") =>
    rows.reduce((total, row) => total + row[key], 0);

  const [file] = await tx
    .insert(rcmFiles)
    .values({
      tenantId: input.tenantId,
      uploadedBy: input.userId,
      // A generic name: uploaded file names can contain patient names (PHI).
      filename: `monthly-file-${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}.csv`,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      rowCount: rows.length,
      billedCents: sum("billedCents"),
      paymentCents: sum("paymentCents"),
      adjustmentCents: sum("adjustmentCents"),
      balanceCents: sum("balanceCents"),
      netCents: sum("netCents"),
      formatVersion: CURRENT_FORMAT_VERSION,
      flaggedCount: rows.filter((r) => r.flagged).length,
    })
    .returning({ id: rcmFiles.id });
  const fileId = file!.id;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.insert(rcmClaimLines).values(rows.slice(i, i + CHUNK).map((row) => ({ ...row, fileId })));
  }
  await audit(tx, {
    action: "rcm.file_imported",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "rcm_file",
    entityId: fileId,
    metadata: { rows: rows.length, periodYear: input.periodYear, periodMonth: input.periodMonth },
  });
  return fileId;
}

export async function listFiles(tx: TenantTx) {
  return tx
    .select({
      id: rcmFiles.id,
      filename: rcmFiles.filename,
      periodYear: rcmFiles.periodYear,
      periodMonth: rcmFiles.periodMonth,
      rowCount: rcmFiles.rowCount,
      billedCents: rcmFiles.billedCents,
      formatVersion: rcmFiles.formatVersion,
      netCents: rcmFiles.netCents,
      paymentCents: rcmFiles.paymentCents,
      adjustmentCents: rcmFiles.adjustmentCents,
      balanceCents: rcmFiles.balanceCents,
      flaggedCount: rcmFiles.flaggedCount,
      uploadedBy: users.displayName,
      createdAt: rcmFiles.createdAt,
    })
    .from(rcmFiles)
    .leftJoin(users, eq(users.id, rcmFiles.uploadedBy))
    .orderBy(desc(rcmFiles.periodYear), desc(rcmFiles.periodMonth), desc(rcmFiles.createdAt));
}

export const LINES_PAGE_SIZE = 50;

export interface LineFilters {
  ruleCode?: string;
  flagged?: boolean;
  page: number;
}

export async function getFile(tx: TenantTx, fileId: string, filters: LineFilters) {
  const [file] = await tx
    .select({ file: rcmFiles, uploadedBy: users.displayName })
    .from(rcmFiles)
    .leftJoin(users, eq(users.id, rcmFiles.uploadedBy))
    .where(eq(rcmFiles.id, fileId))
    .limit(1);
  if (!file) return null;

  const inFile = eq(rcmClaimLines.fileId, fileId);
  const byRule = await tx
    .select({
      key: rcmClaimLines.ruleCode,
      lines: count(),
      billedCents: sql<number>`sum(${rcmClaimLines.billedCents})::bigint`.mapWith(Number),
      adjustmentCents: sql<number>`sum(${rcmClaimLines.adjustmentCents})::bigint`.mapWith(Number),
      netCents: sql<number>`sum(${rcmClaimLines.netCents})::bigint`.mapWith(Number),
    })
    .from(rcmClaimLines)
    .where(inFile)
    .groupBy(rcmClaimLines.ruleCode)
    .orderBy(desc(sql`sum(${rcmClaimLines.billedCents})`));
  const byPayerClass = await tx
    .select({
      key: rcmClaimLines.payerClass,
      lines: count(),
      billedCents: sql<number>`sum(${rcmClaimLines.billedCents})::bigint`.mapWith(Number),
      netCents: sql<number>`sum(${rcmClaimLines.netCents})::bigint`.mapWith(Number),
      paymentCents: sql<number>`sum(${rcmClaimLines.paymentCents})::bigint`.mapWith(Number),
    })
    .from(rcmClaimLines)
    .where(inFile)
    .groupBy(rcmClaimLines.payerClass)
    .orderBy(desc(sql`sum(${rcmClaimLines.billedCents})`));
  const bySite = await tx
    .select({
      siteId: rcmClaimLines.siteId,
      code: rcmSites.code,
      name: rcmSites.name,
      lines: count(),
      netCents: sql<number>`sum(${rcmClaimLines.netCents})::bigint`.mapWith(Number),
    })
    .from(rcmClaimLines)
    .leftJoin(rcmSites, eq(rcmSites.id, rcmClaimLines.siteId))
    .where(inFile)
    .groupBy(rcmClaimLines.siteId, rcmSites.code, rcmSites.name)
    .orderBy(asc(rcmSites.code));

  const conditions: SQL[] = [inFile];
  if (filters.ruleCode) conditions.push(eq(rcmClaimLines.ruleCode, filters.ruleCode));
  if (filters.flagged) conditions.push(eq(rcmClaimLines.flagged, true));
  const where = and(...conditions);
  const lines = await tx
    .select({
      id: rcmClaimLines.id,
      rowNumber: rcmClaimLines.rowNumber,
      patientName: rcmClaimLines.patientName,
      accountNumber: rcmClaimLines.accountNumber,
      serviceDate: rcmClaimLines.serviceDate,
      cpt: rcmClaimLines.cpt,
      payerClass: rcmClaimLines.payerClass,
      status: rcmClaimLines.status,
      siteCode: rcmSites.code,
      ruleCode: rcmClaimLines.ruleCode,
      billedCents: rcmClaimLines.billedCents,
      netCents: rcmClaimLines.netCents,
      paymentCents: rcmClaimLines.paymentCents,
      adjustmentCents: rcmClaimLines.adjustmentCents,
      balanceCents: rcmClaimLines.balanceCents,
      arGl: rcmClaimLines.arGl,
      flagged: rcmClaimLines.flagged,
      reviewReasons: rcmClaimLines.reviewReasons,
    })
    .from(rcmClaimLines)
    .leftJoin(rcmSites, eq(rcmSites.id, rcmClaimLines.siteId))
    .where(where)
    .orderBy(asc(rcmClaimLines.rowNumber))
    .limit(LINES_PAGE_SIZE)
    .offset((filters.page - 1) * LINES_PAGE_SIZE);
  const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(rcmClaimLines).where(where);

  return { ...file, byRule, byPayerClass, bySite, lines, total };
}

/** Masks identifiers for roles that review totals but don't work accounts (minimum necessary). */
export function maskPatientName(name: string): string {
  const initial = name.trim().charAt(0);
  return initial ? `${initial}••••` : "••••";
}

export function maskAccount(account: string): string {
  return `•••• ${account.slice(-4)}`;
}
