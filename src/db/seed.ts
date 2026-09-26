import { randomBytes, randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { addCalendarDays } from "@rules/calendar";
import { appealDeadline } from "@rules/deadlines";
import { hashPassword } from "@/auth/password";
import { generateDataset, type SyntheticDataset } from "@/domain/synthetic/generator";
import { importMonthlyFile } from "@/domain/revenue-cycle/imports";
import { seedRevenueCycleDefaults } from "@/domain/revenue-cycle/setup";
import { generateMonthlyLines } from "@/domain/revenue-cycle/synthetic-file";
import { encryptField } from "@/lib/crypto/field";
import { systemDb } from "./client";
import {
  claimLines,
  claims,
  denials,
  locations,
  memberships,
  patients,
  payers,
  providers,
  rcmSites,
  tenants,
  users,
} from "./schema";
import { withTenant } from "./tenant";

const minDate = (a: string, b: string) => (a < b ? a : b);

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
  kind?: "customer" | "demo";
  asOf: string;
  users: SeedUser[];
  dataset?: SyntheticDataset;
}): Promise<{ tenantId: string; userIds: string[] }> {
  if (process.env.APP_ENV === "production") {
    throw new Error("Refusing to seed synthetic data with APP_ENV=production");
  }
  const dataset = options.dataset ?? generateDataset({ asOf: options.asOf });
  const db = systemDb();

  const [tenant] = await db
    .insert(tenants)
    .values({ name: options.practiceName, kind: options.kind ?? "customer" })
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

  const claimRows: (typeof claims.$inferInsert)[] = [];
  const lineRows: (typeof claimLines.$inferInsert)[] = [];
  const denialRows: (typeof denials.$inferInsert)[] = [];
  for (const [index, c] of dataset.claims.entries()) {
    const billed = c.lines.reduce((sum, line) => sum + line.chargeCents, 0);
    const denied = c.denial?.deniedCents ?? 0;
    const claimId = idFor(c.key);
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
      paidCents: billed - denied,
      status: !c.denial ? "paid" : denied < billed ? "partially_paid" : "denied",
      electronic: c.electronic,
      submittedAt: new Date(`${c.serviceDate}T14:00:00Z`),
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
    await tx.insert(patients).values(
      dataset.patients.map((p) => ({
        id: idFor(p.key),
        tenantId,
        mrn: p.mrn,
        firstName: p.firstName,
        lastName: p.lastName,
        birthDate: p.birthDate,
        memberIdEnc: encryptField(p.memberId),
        memberIdLast4: p.memberId.slice(-4),
      })),
    );
    await insertInChunks(claimRows, (chunk) => tx.insert(claims).values(chunk));
    await insertInChunks(lineRows, (chunk) => tx.insert(claimLines).values(chunk));
    await insertInChunks(denialRows, (chunk) => tx.insert(denials).values(chunk));
    await seedRevenueCycleDefaults(tx, tenantId, userIds[0]!);
    // Last month's synthetic practice-management file, classified by the default rules.
    const [year, month] = dataset.asOf.split("-").map(Number) as [number, number];
    const period = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    const [firstSite] = await tx
      .select({ id: rcmSites.id })
      .from(rcmSites)
      .orderBy(asc(rcmSites.code))
      .limit(1);
    await importMonthlyFile(tx, {
      tenantId,
      userId: userIds[0]!,
      periodYear: period.year,
      periodMonth: period.month,
      defaultSiteId: firstSite?.id ?? null,
      lines: generateMonthlyLines({
        seed: dataset.claims.length,
        periodYear: period.year,
        periodMonth: period.month,
        facilities: dataset.locations.map((l) => l.name),
      }),
    });
  });

  return { tenantId, userIds };
}
