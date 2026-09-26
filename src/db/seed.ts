import { randomBytes } from "node:crypto";
import { appealDeadline } from "@rules/deadlines";
import { hashPassword } from "@/auth/password";
import { generateDataset, type SyntheticDataset } from "@/domain/synthetic/generator";
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
  tenants,
  users,
} from "./schema";
import { withTenant } from "./tenant";

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
}): Promise<{ tenantId: string; userIds: string[] }> {
  if (process.env.APP_ENV === "production") {
    throw new Error("Refusing to seed synthetic data with APP_ENV=production");
  }
  const dataset = options.dataset ?? generateDataset({ asOf: options.asOf });
  const db = systemDb();

  const [tenant] = await db.insert(tenants).values({ name: options.practiceName }).returning();
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

  await withTenant({ tenantId, userId: userIds[0]! }, async (tx) => {
    const ids = new Map<string, string>();
    const put = (key: string, id: string) => ids.set(key, id);
    const get = (key: string) => ids.get(key)!;

    for (const l of dataset.locations) {
      const [row] = await tx.insert(locations).values({ tenantId, name: l.name, city: l.city }).returning();
      put(l.key, row!.id);
    }
    for (const p of dataset.providers) {
      const [row] = await tx
        .insert(providers)
        .values({ tenantId, name: p.name, npi: p.npi, taxonomy: p.taxonomy, flLicense: p.flLicense })
        .returning();
      put(p.key, row!.id);
    }
    const payerRegime = new Map<string, (typeof dataset.payers)[number]>();
    for (const p of dataset.payers) {
      const [row] = await tx
        .insert(payers)
        .values({
          tenantId,
          name: p.name,
          ediPayerId: p.ediPayerId,
          regime: p.regime,
          appealWindowDays: p.appealWindowDays,
          appealWindowSource: p.appealWindowSource,
        })
        .returning();
      put(p.key, row!.id);
      payerRegime.set(p.key, p);
    }
    for (const p of dataset.patients) {
      const [row] = await tx
        .insert(patients)
        .values({
          tenantId,
          mrn: p.mrn,
          firstName: p.firstName,
          lastName: p.lastName,
          birthDate: p.birthDate,
          memberIdEnc: encryptField(p.memberId),
          memberIdLast4: p.memberId.slice(-4),
        })
        .returning();
      put(p.key, row!.id);
    }

    const specialists = userIds.slice(1);
    for (const [index, c] of dataset.claims.entries()) {
      const billed = c.lines.reduce((sum, line) => sum + line.chargeCents, 0);
      const denied = c.denial?.deniedCents ?? 0;
      const [claim] = await tx
        .insert(claims)
        .values({
          tenantId,
          claimNumber: c.claimNumber,
          patientId: get(c.patientKey),
          providerId: get(c.providerKey),
          locationId: get(c.locationKey),
          payerId: get(c.payerKey),
          serviceDate: c.serviceDate,
          diagnosisCodes: c.diagnosisCodes,
          billedCents: billed,
          paidCents: billed - denied,
          status: !c.denial ? "paid" : denied < billed ? "partially_paid" : "denied",
          electronic: c.electronic,
          submittedAt: new Date(`${c.serviceDate}T14:00:00Z`),
          payerReceivedDate: c.payerReceivedDate,
        })
        .returning();
      const lineIds: string[] = [];
      for (const [lineIndex, line] of c.lines.entries()) {
        const [row] = await tx
          .insert(claimLines)
          .values({ tenantId, claimId: claim!.id, lineNumber: lineIndex + 1, ...line })
          .returning();
        lineIds.push(row!.id);
      }
      if (c.denial) {
        const payer = payerRegime.get(c.payerKey)!;
        const deadline = appealDeadline({
          regime: payer.regime,
          noticeDate: c.denial.noticeDate,
          payerAppealWindowDays: payer.appealWindowDays,
        });
        const assignee =
          c.denial.status === "new" || specialists.length === 0
            ? null
            : specialists[index % specialists.length]!;
        await tx.insert(denials).values({
          tenantId,
          claimId: claim!.id,
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
          assigneeId: assignee,
        });
      }
    }
  });

  return { tenantId, userIds };
}
