import { randomBytes, randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { addCalendarDays } from "@rules/calendar";
import { appealDeadline } from "@rules/deadlines";
import { isOperatorEmail } from "@/auth/operator-email";
import { hashPassword } from "@/auth/password";
import { snapshotOf } from "@/domain/claims/correction";
import { generateDataset, type SyntheticDataset } from "@/domain/synthetic/generator";
import { importMonthlyFile } from "@/domain/revenue-cycle/imports";
import { seedRevenueCycleDefaults } from "@/domain/revenue-cycle/setup";
import { importDeposits } from "@/domain/revenue-cycle/receivables";
import { generateDeposits, generateMonthlyFiles } from "@/domain/revenue-cycle/synthetic-file";
import { prepareVoucher } from "@/domain/revenue-cycle/vouchers";
import { encryptField } from "@/lib/crypto/field";
import { systemDb } from "./client";
import {
  claimLines,
  claims,
  claimVersions,
  denials,
  locations,
  memberships,
  patients,
  payers,
  promptPayResponses,
  providers,
  rcmSites,
  remittanceClaims,
  remittanceEvents,
  remittances,
  tenants,
  users,
} from "./schema";
import { withTenant } from "./tenant";

const minDate = (a: string, b: string) => (a < b ? a : b);

/** Days from payer receipt to payment for synthetic paid claims: some on time, some late (interest). */
const PAYMENT_LAGS = [12, 17, 19, 24, 33, 46];

/** Keeps each INSERT well under PostgreSQL's 65,535-parameter limit. */
async function insertInChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

export interface SeedUser {
  email: string;
  displayName: string;
  role: "admin" | "manager" | "specialist" | "compliance";
  password?: string;
}

/**
 * Creates one synthetic practice with users and a generated dataset. Refuses to run in production:
 * seed data is synthetic by definition and never belongs in a production tenant (ADR 0003).
 */
export async function seedPractice(options: {
  practiceName: string;
  asOf: string;
  users: SeedUser[];
  dataset?: SyntheticDataset;
  /**
   * false = setup only (locations, providers, payers, accounting rules) with no patients, claims,
   * denials, or imported files, so every number on screen comes from what the user does.
   */
  withSampleActivity?: boolean;
  /**
   * With sample activity: the user (index into `users`, an admin or manager) who prepares a draft
   * journal voucher for the latest month, so another user can review and approve it.
   */
  sampleVoucherBy?: number;
}): Promise<{ tenantId: string; userIds: string[] }> {
  if (process.env.APP_ENV === "production") {
    throw new Error("Refusing to seed synthetic data with APP_ENV=production");
  }
  // A practice user with the operator's email would permanently block operator provisioning.
  if (options.users.some((user) => isOperatorEmail(user.email))) {
    throw new Error("Refusing to seed a practice user with the platform operator's email");
  }
  const generated = options.dataset ?? generateDataset({ asOf: options.asOf });
  const withActivity = options.withSampleActivity ?? true;
  const dataset = withActivity ? generated : { ...generated, patients: [], claims: [] };
  const db = systemDb();

  const [tenant] = await db
    .insert(tenants)
    .values({ name: options.practiceName, kind: "customer" })
    .returning();
  const tenantId = tenant!.id;
  const userIds: string[] = [];
  for (const user of options.users) {
    const [row] = await db
      .insert(users)
      .values({
        email: user.email,
        displayName: user.displayName,
        passwordHash: await hashPassword(user.password ?? randomBytes(24).toString("base64url")),
      })
      .returning();
    await db.insert(memberships).values({ tenantId, userId: row!.id, role: user.role });
    userIds.push(row!.id);
  }

  // IDs are generated here so every table is written in one batched insert: fast enough to run
  // inside a serverless function (the Netlify preview seed endpoint), not just from a laptop.
  const ids = new Map<string, string>();
  const idFor = (key: string) => {
    if (!ids.has(key)) ids.set(key, randomUUID());
    return ids.get(key)!;
  };
  const payerByKey = new Map(dataset.payers.map((p) => [p.key, p]));
  // Only people who can work denials get assignments (compliance and admins don't in the demo).
  const specialists = userIds.filter((_, i) => ["specialist", "manager"].includes(options.users[i]!.role));

  // Primary coverage: the payer of each patient's most recent claim.
  const primaryPayerKey = new Map<string, string>();
  for (const c of [...dataset.claims].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate)))
    primaryPayerKey.set(c.patientKey, c.payerKey);

  const remitGroups = new Map<
    string,
    {
      payerKey: string;
      paymentDate: string;
      claims: {
        claimId: string;
        billed: number;
        paid: number;
        adjustments: { group: "CO" | "PR" | "OA"; carc: string; cents: number }[];
        rarcs: string[];
      }[];
    }
  >();
  const claimRows: (typeof claims.$inferInsert)[] = [];
  const lineRows: (typeof claimLines.$inferInsert)[] = [];
  const denialRows: (typeof denials.$inferInsert)[] = [];
  for (const [index, c] of dataset.claims.entries()) {
    const billed = c.lines.reduce((sum, line) => sum + line.chargeCents, 0);
    const denied = c.denial?.deniedCents ?? 0;
    const claimId = idFor(c.key);
    // Adjudicated claims are paid or denied by a synthetic remittance; a claim whose payment date is
    // still ahead stays accepted by the payer and unpaid, so open prompt-pay clocks exist.
    const paymentDate = c.unsubmitted
      ? null
      : (c.denial?.noticeDate ??
        addCalendarDays(c.payerReceivedDate!, PAYMENT_LAGS[index % PAYMENT_LAGS.length]!));
    const awaitingPayment = paymentDate !== null && paymentDate > dataset.asOf;
    if (paymentDate && !awaitingPayment) {
      const payerKey = c.payerKey;
      const key = `${payerKey}|${paymentDate}`;
      const group = remitGroups.get(key) ?? { payerKey, paymentDate, claims: [] };
      group.claims.push({
        claimId,
        billed,
        paid: billed - denied,
        adjustments: c.denial ? [{ group: c.denial.groupCode, carc: c.denial.carc, cents: denied }] : [],
        rarcs: c.denial?.rarcs ?? [],
      });
      remitGroups.set(key, group);
    }
    claimRows.push({
      id: claimId,
      tenantId,
      claimNumber: c.claimNumber,
      patientId: idFor(c.patientKey),
      providerId: idFor(c.providerKey),
      locationId: idFor(c.locationKey),
      payerId: idFor(c.payerKey),
      serviceDate: c.serviceDate,
      diagnosisCodes: c.diagnosisCodes,
      billedCents: billed,
      paidCents: c.unsubmitted || awaitingPayment ? 0 : billed - denied,
      status:
        c.unsubmitted ??
        (awaitingPayment
          ? "acknowledged"
          : !c.denial
            ? "paid"
            : denied < billed
              ? "partially_paid"
              : "denied"),
      electronic: c.electronic,
      submittedAt: c.unsubmitted === "draft" ? null : new Date(`${c.serviceDate}T14:00:00Z`),
      payerReceivedDate: c.payerReceivedDate,
    });
    const lineIds = c.lines.map((line, lineIndex) => {
      const id = randomUUID();
      lineRows.push({ id, tenantId, claimId, lineNumber: lineIndex + 1, ...line });
      return id;
    });
    if (c.denial) {
      const payer = payerByKey.get(c.payerKey)!;
      const deadline = appealDeadline({
        regime: payer.regime,
        noticeDate: c.denial.noticeDate,
        payerAppealWindowDays: payer.appealWindowDays,
      });
      denialRows.push({
        tenantId,
        claimId,
        claimLineId: c.denial.lineIndex === null ? null : lineIds[c.denial.lineIndex]!,
        groupCode: c.denial.groupCode,
        carc: c.denial.carc,
        rarcs: c.denial.rarcs,
        category: c.denial.category,
        deniedCents: c.denial.deniedCents,
        noticeDate: c.denial.noticeDate,
        appealDeadline: deadline?.date ?? null,
        appealDeadlineBasis: deadline?.basis ?? null,
        status: c.denial.status,
        appealSubmittedOn: ["appeal_submitted", "overturned", "upheld"].includes(c.denial.status)
          ? minDate(addCalendarDays(c.denial.noticeDate, 21), dataset.asOf)
          : null,
        assigneeId:
          c.denial.status === "new" || specialists.length === 0
            ? null
            : specialists[index % specialists.length]!,
      });
    }
  }

  await withTenant({ tenantId, userId: userIds[0]! }, async (tx) => {
    await tx
      .insert(locations)
      .values(dataset.locations.map((l) => ({ id: idFor(l.key), tenantId, name: l.name, city: l.city })));
    await tx.insert(providers).values(
      dataset.providers.map((p) => ({
        id: idFor(p.key),
        tenantId,
        name: p.name,
        npi: p.npi,
        taxonomy: p.taxonomy,
        flLicense: p.flLicense,
      })),
    );
    await tx.insert(payers).values(
      dataset.payers.map((p) => ({
        id: idFor(p.key),
        tenantId,
        name: p.name,
        ediPayerId: p.ediPayerId,
        regime: p.regime,
        appealWindowDays: p.appealWindowDays,
        appealWindowSource: p.appealWindowSource,
      })),
    );
    if (dataset.patients.length > 0)
      await tx.insert(patients).values(
        dataset.patients.map((p, index) => ({
          id: idFor(p.key),
          tenantId,
          mrn: p.mrn,
          firstName: p.firstName,
          lastName: p.lastName,
          birthDate: p.birthDate,
          memberIdEnc: encryptField(p.memberId),
          memberIdLast4: p.memberId.slice(-4),
          sex: p.sex,
          addressLine1: `${100 + (index % 900)} Synthetic Way`,
          city: p.city,
          state: "FL",
          postalCode: p.postalCode,
          primaryPayerId: primaryPayerKey.has(p.key) ? idFor(primaryPayerKey.get(p.key)!) : null,
        })),
      );
    await insertInChunks(claimRows, (chunk) => tx.insert(claims).values(chunk));
    await insertInChunks(lineRows, (chunk) => tx.insert(claimLines).values(chunk));
    // Version 1 of every claim (R-3.10.3), recorded by the system.
    const linesByClaim = new Map<string, typeof lineRows>();
    for (const line of lineRows)
      linesByClaim.set(line.claimId, [...(linesByClaim.get(line.claimId) ?? []), line]);
    await insertInChunks(
      claimRows.map((claim) => ({
        tenantId,
        claimId: claim.id!,
        version: 1,
        snapshot: snapshotOf(
          { ...claim, status: claim.status },
          (linesByClaim.get(claim.id!) ?? []).map((l) => ({
            lineNumber: l.lineNumber,
            procedureCode: l.procedureCode,
            modifiers: l.modifiers ?? [],
            units: l.units,
            chargeCents: l.chargeCents,
          })),
        ),
        reason: "Synthetic claim created",
      })),
      (chunk) => tx.insert(claimVersions).values(chunk),
    );
    await insertInChunks(denialRows, (chunk) => tx.insert(denials).values(chunk));
    // Posted synthetic remittances (one per payer and payment date) and the payer responses they
    // put on each claim's prompt-pay clock. Recorded by the system (no user).
    const remitRows: (typeof remittances.$inferInsert)[] = [];
    const remitClaimRows: (typeof remittanceClaims.$inferInsert)[] = [];
    const remitEventRows: (typeof remittanceEvents.$inferInsert)[] = [];
    const responseRows: (typeof promptPayResponses.$inferInsert)[] = [];
    for (const [n, group] of [...remitGroups.values()].entries()) {
      const remittanceId = randomUUID();
      const total = group.claims.reduce((sum, c) => sum + c.paid, 0);
      remitRows.push({
        id: remittanceId,
        tenantId,
        payerId: idFor(group.payerKey),
        method: total > 0 ? "eft" : "non_payment",
        traceNumber: `SYN-TRN-${String(100_000 + n)}`,
        paymentDate: group.paymentDate,
        totalPaidCents: total,
        status: "posted",
        source: "seed",
      });
      remitEventRows.push(
        { tenantId, remittanceId, event: "received", reason: "Synthetic remittance loaded" },
        { tenantId, remittanceId, event: "posted", reason: `Posted ${group.claims.length} claim payments` },
      );
      for (const c of group.claims) {
        remitClaimRows.push({
          tenantId,
          remittanceId,
          claimId: c.claimId,
          statusCode: c.paid > 0 ? "1" : "4",
          chargeCents: c.billed,
          paidCents: c.paid,
          adjustments: c.adjustments,
          rarcs: c.rarcs,
        });
        responseRows.push({
          tenantId,
          claimId: c.claimId,
          kind: c.paid > 0 ? "payment" : "denial",
          responseDate: group.paymentDate,
          cents: c.paid,
          remittanceId,
        });
      }
    }
    await insertInChunks(remitRows, (chunk) => tx.insert(remittances).values(chunk));
    await insertInChunks(remitEventRows, (chunk) => tx.insert(remittanceEvents).values(chunk));
    await insertInChunks(remitClaimRows, (chunk) => tx.insert(remittanceClaims).values(chunk));
    await insertInChunks(responseRows, (chunk) => tx.insert(promptPayResponses).values(chunk));
    await seedRevenueCycleDefaults(tx, tenantId, userIds[0]!);
    if (withActivity) {
      // The last three months of synthetic activity files, routed by the starter rules.
      const [year, month] = dataset.asOf.split("-").map(Number) as [number, number];
      const period = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
      const [firstSite] = await tx
        .select({ id: rcmSites.id })
        .from(rcmSites)
        .orderBy(asc(rcmSites.code))
        .limit(1);
      const months = generateMonthlyFiles({
        // Adjudicated claims only, so adding unsubmitted claims didn't change the demo files.
        seed: dataset.claims.filter((c) => !c.unsubmitted).length,
        periodYear: period.year,
        periodMonth: period.month,
        months: 3,
        facilities: dataset.locations.map((l) => l.name),
      });
      let latestFileId = "";
      for (const file of months) {
        latestFileId = await importMonthlyFile(tx, {
          tenantId,
          userId: userIds[0]!,
          periodYear: file.periodYear,
          periodMonth: file.periodMonth,
          defaultSiteId: firstSite?.id ?? null,
          lines: file.lines,
        });
      }
      // The bank side of those months, deposited by the first administrator or manager.
      const runner = options.users.findIndex((u) => u.role === "admin" || u.role === "manager");
      if (runner >= 0) {
        const deposits = generateDeposits(months, dataset.claims.length);
        await importDeposits(
          tx,
          { tenantId, userId: userIds[runner]!, role: options.users[runner]!.role },
          deposits.map((d, i) => ({ ...d, rowNumber: i + 2 })),
        );
      }
      const preparer = options.sampleVoucherBy;
      if (preparer !== undefined) {
        const role = options.users[preparer]!.role;
        await prepareVoucher(tx, { tenantId, userId: userIds[preparer]!, role }, latestFileId);
      }
    }
  });

  return { tenantId, userIds };
}
