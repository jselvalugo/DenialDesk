import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { rcmClaimLines, rcmFiles, rcmSites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { prepareEngine } from "./engine";
import type { MonthlyLine } from "./monthly-file";
import { loadEngineConfig } from "./setup";

/** "March 2026" for a file's accounting period. */
export const periodLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** Lines are inserted in chunks to stay far below PostgreSQL's parameter limit. */
const CHUNK = 500;

export interface ImportInput {
  tenantId: string;
  userId: string;
  filename: string;
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

/**
 * Classifies every line with the practice's rules and stores the file and its lines in the
 * caller's transaction: all or nothing. Audited with IDs and counts only.
 */
export async function importMonthlyFile(tx: TenantTx, input: ImportInput): Promise<string> {
  const classify = prepareEngine(await loadEngineConfig(tx));
  const sites = await tx.select({ id: rcmSites.id, name: rcmSites.name }).from(rcmSites);
  if (input.defaultSiteId && !sites.some((s) => s.id === input.defaultSiteId)) {
    // FKs bypass RLS, so a site ID from a form is checked against this tenant's sites.
    throw new Error("Unknown site");
  }

  const rows = input.lines.map((line) => {
    const result = classify({
      status: line.status,
      payerClass: line.payerClass,
      cpt: line.cpt,
      description: line.description,
      facility: line.facility,
      billedCents: line.billedCents,
    });
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
      balanceCents: line.balanceCents,
      siteId: siteFor(line.facility, sites, input.defaultSiteId),
      ruleCode: result.ruleCode,
      contraBps: result.contraBps,
      contraCents: result.contraCents,
      netCents: result.netCents,
      arGl: result.arGl,
      revenueGl: result.revenueGl,
      adjustmentGl: result.adjustmentGl,
      excluded: result.excluded,
      flagged: line.billedCents === 0 || line.cpt === "",
    };
  });
  const sum = (key: "billedCents" | "paymentCents" | "balanceCents" | "contraCents" | "netCents") =>
    rows.reduce((total, row) => total + row[key], 0);

  const [file] = await tx
    .insert(rcmFiles)
    .values({
      tenantId: input.tenantId,
      uploadedBy: input.userId,
      filename: input.filename,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      rowCount: rows.length,
      billedCents: sum("billedCents"),
      paymentCents: sum("paymentCents"),
      balanceCents: sum("balanceCents"),
      contraCents: sum("contraCents"),
      netCents: sum("netCents"),
      excludedCount: rows.filter((r) => r.excluded).length,
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
      contraCents: rcmFiles.contraCents,
      netCents: rcmFiles.netCents,
      paymentCents: rcmFiles.paymentCents,
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
  payerClass?: string;
  siteId?: string;
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
      contraCents: sql<number>`sum(${rcmClaimLines.contraCents})::bigint`.mapWith(Number),
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
  if (filters.payerClass) conditions.push(eq(rcmClaimLines.payerClass, filters.payerClass));
  if (filters.siteId) conditions.push(eq(rcmClaimLines.siteId, filters.siteId));
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
      contraCents: rcmClaimLines.contraCents,
      netCents: rcmClaimLines.netCents,
      paymentCents: rcmClaimLines.paymentCents,
      balanceCents: rcmClaimLines.balanceCents,
      arGl: rcmClaimLines.arGl,
      excluded: rcmClaimLines.excluded,
      flagged: rcmClaimLines.flagged,
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
