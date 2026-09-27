import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, claims, denials, locations, patients, payers, providers } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { OPEN_STATUSES } from "@/domain/denial-status";
import { createFormatters } from "@/i18n/format";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { defaultDateRange } from "@/domain/insight/filters";
import {
  fetchAppealOutcomes,
  fetchClaimsByStatus,
  fetchDenialRate,
  fetchDenialsByCategory,
  fetchDenialsByDeadlineBucket,
  fetchDenialsByPayer,
  recordReportExported,
  recordReportViewed,
} from "@/domain/insight/queries";
import { buildAllReportsWorkbookFor, buildSingleReportWorkbook } from "@/domain/insight/report";
import { denialsByDeadlineBucketSheet, denialsByPayerSheet } from "@/domain/insight/report-sheets";
import { isSuppressedCell } from "@/domain/insight/suppression";
import { generateDataset } from "@/domain/synthetic/generator";
import type { Actor } from "@/domain/revenue-cycle/vouchers";

let a: Actor;
let b: Actor;

// Named insightT/commonT (not t/tc) because many tests below shadow `t` with their own tenant Actor.
const insightT = createTranslator(en.insight, "en");
const commonT = createTranslator(en.common, "en");
const f = createFormatters("en");

async function practice(label: string, seed: number): Promise<Actor> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Insight reporting ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [
      { email: `insight-mgr-${suffix}@synthetic.test`, displayName: "Insight Manager", role: "manager" },
    ],
    dataset: generateDataset({ asOf: todayIn(), seed, patients: 6, claims: 30 }),
  });
  return { tenantId, userId: userIds[0]!, role: "manager" };
}

/** A tenant with only its setup rows (locations, providers, payers) — no synthetic activity — so
 * a test can insert exactly the claims/denials it wants and know every count precisely. */
async function bareTenant(label: string, seed: number): Promise<Actor> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Insight isolation ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [{ email: `insight-iso-${suffix}@synthetic.test`, displayName: "Iso Manager", role: "manager" }],
    withSampleActivity: false,
  });
  return { tenantId, userId: userIds[0]!, role: "manager" };
}

interface DenialFixture {
  payerName: string;
  category: "coding" | "eligibility" | "timely_filing" | "medical_necessity";
  carc?: string;
  deniedCents: number;
  noticeDate: string;
  appealDeadline?: string | null;
  status?: "new" | "in_review" | "overturned" | "upheld";
  claimStatus?: "draft" | "submitted" | "denied" | "paid";
  billedCents?: number;
  paidCents?: number;
  serviceDate?: string;
  submittedAt?: Date | null;
  /** Patient sensitivity tags (R-3.5.1) — drives small-cell suppression (R-8.7) when set. */
  sensitivityTags?: string[];
}

/** Inserts one payer (by name, not reused across calls — tests that want a shared name pass the
 * same string for each tenant) plus one claim and one denial built exactly from `fixture`. */
async function seedDenial(actor: Actor, fixture: DenialFixture) {
  return withTenant(actor, async (tx) => {
    const [provider] = await tx.select({ id: providers.id }).from(providers).limit(1);
    const [location] = await tx.select({ id: locations.id }).from(locations).limit(1);
    // Reuse an existing payer of this name within this tenant (so two seedDenial calls with the
    // same name group under one payer, as they would from real data entry) rather than always
    // inserting a fresh row.
    const [existingPayer] = await tx
      .select({ id: payers.id })
      .from(payers)
      .where(eq(payers.name, fixture.payerName))
      .limit(1);
    const payer =
      existingPayer ??
      (await tx
        .insert(payers)
        .values({ tenantId: actor.tenantId, name: fixture.payerName })
        .returning()
        .then((rows) => rows[0]!));
    const mrn = `SYN-INS-${Math.random().toString(36).slice(2, 10)}`;
    const [patient] = await tx
      .insert(patients)
      .values({
        tenantId: actor.tenantId,
        mrn,
        firstName: "Synthetic",
        lastName: "Patient",
        birthDate: "1990-01-01",
        memberIdEnc: "x",
        memberIdLast4: "",
        sensitivityTags: fixture.sensitivityTags ?? [],
      })
      .returning();
    const patientId = patient!.id;
    const [claim] = await tx
      .insert(claims)
      .values({
        tenantId: actor.tenantId,
        claimNumber: `INS-${Math.random().toString(36).slice(2, 10)}`,
        patientId,
        providerId: provider!.id,
        locationId: location!.id,
        payerId: payer!.id,
        serviceDate: fixture.serviceDate ?? fixture.noticeDate,
        diagnosisCodes: ["Z00.00"],
        billedCents: fixture.billedCents ?? fixture.deniedCents,
        paidCents: fixture.paidCents ?? 0,
        status: fixture.claimStatus ?? "denied",
        submittedAt: fixture.submittedAt ?? new Date(`${fixture.noticeDate}T12:00:00Z`),
      })
      .returning();
    const [denial] = await tx
      .insert(denials)
      .values({
        tenantId: actor.tenantId,
        claimId: claim!.id,
        groupCode: "CO",
        carc: fixture.carc ?? "11",
        category: fixture.category,
        deniedCents: fixture.deniedCents,
        noticeDate: fixture.noticeDate,
        appealDeadline: fixture.appealDeadline ?? null,
        status: fixture.status ?? "new",
      })
      .returning();
    return { payerId: payer!.id, claimId: claim!.id, denialId: denial!.id };
  });
}

beforeAll(async () => {
  a = await practice("alpha", 71);
  b = await practice("beta", 72);
});

afterAll(() => closeDatabase());

const filters = { ...defaultDateRange(), payerId: null as string | null, error: null };
// Widen the window generously so seeded synthetic denials/claims fall inside it.
const wideFilters = {
  dateFrom: "2000-01-01",
  dateTo: "2100-01-01",
  payerId: null as string | null,
  error: null,
};

describe("Insight reports — tenant isolation", () => {
  it("denials-by-category sees only its own tenant's denials, even with matching CARC codes", async () => {
    const [mine, theirs] = await Promise.all([
      withTenant(a, (tx) => fetchDenialsByCategory(tx, wideFilters)),
      withTenant(b, (tx) => fetchDenialsByCategory(tx, wideFilters)),
    ]);
    const myTotal = mine.reduce((t, g) => t + g.count, 0);
    const theirTotal = theirs.reduce((t, g) => t + g.count, 0);
    expect(myTotal).toBeGreaterThan(0);
    expect(theirTotal).toBeGreaterThan(0);

    const [myRows, theirRows] = await Promise.all([
      withTenant(a, (tx) =>
        tx.select({ id: denials.id }).from(denials).where(eq(denials.tenantId, a.tenantId)),
      ),
      withTenant(b, (tx) =>
        tx.select({ id: denials.id }).from(denials).where(eq(denials.tenantId, b.tenantId)),
      ),
    ]);
    expect(myTotal).toBe(myRows.length);
    expect(theirTotal).toBe(theirRows.length);
  });

  it("claims-by-status only counts each tenant's own claims", async () => {
    const [mine, theirs, myClaims, theirClaims] = await Promise.all([
      withTenant(a, (tx) => fetchClaimsByStatus(tx, wideFilters)),
      withTenant(b, (tx) => fetchClaimsByStatus(tx, wideFilters)),
      withTenant(a, (tx) => tx.select({ id: claims.id }).from(claims)),
      withTenant(b, (tx) => tx.select({ id: claims.id }).from(claims)),
    ]);
    expect(mine.reduce((t, g) => t + g.count, 0)).toBe(myClaims.length);
    expect(theirs.reduce((t, g) => t + g.count, 0)).toBe(theirClaims.length);
  });

  it("denials-by-payer never merges an unverified payer's row with another payer's", async () => {
    const mine = await withTenant(a, (tx) => fetchDenialsByPayer(tx, wideFilters));
    expect(mine.length).toBeGreaterThan(0);
    // Every payer id maps to exactly one row (no merging across payers).
    const ids = mine.map((g) => g.payerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("with a same-named payer in both tenants", () => {
    it("every fetch* keeps each tenant's rows and totals separate", async () => {
      const t1 = await bareTenant("shared1", 81);
      const t2 = await bareTenant("shared2", 82);
      const sharedName = "Shared Test Payer (synthetic)";
      const today = todayIn();

      // t1: one open denial (feeds category/payer/deadline-bucket/denial-rate), one decided
      // (feeds appeal outcomes).
      await seedDenial(t1, {
        payerName: sharedName,
        category: "coding",
        deniedCents: 11_100,
        noticeDate: today,
        appealDeadline: null,
        status: "new",
        claimStatus: "denied",
      });
      await seedDenial(t1, {
        payerName: sharedName,
        category: "coding",
        deniedCents: 5_000,
        noticeDate: today,
        status: "upheld",
        claimStatus: "denied",
      });

      // t2: different amounts entirely, same payer name.
      await seedDenial(t2, {
        payerName: sharedName,
        category: "eligibility",
        deniedCents: 22_200,
        noticeDate: today,
        appealDeadline: null,
        status: "new",
        claimStatus: "denied",
      });
      await seedDenial(t2, {
        payerName: sharedName,
        category: "eligibility",
        deniedCents: 7_000,
        noticeDate: today,
        status: "overturned",
        claimStatus: "denied",
      });

      const [t1Category, t2Category] = await Promise.all([
        withTenant(t1, (tx) => fetchDenialsByCategory(tx, wideFilters)),
        withTenant(t2, (tx) => fetchDenialsByCategory(tx, wideFilters)),
      ]);
      expect(t1Category.reduce((s, g) => s + g.sumCents, 0)).toBe(16_100);
      expect(t2Category.reduce((s, g) => s + g.sumCents, 0)).toBe(29_200);

      const [t1Payer, t2Payer] = await Promise.all([
        withTenant(t1, (tx) => fetchDenialsByPayer(tx, wideFilters)),
        withTenant(t2, (tx) => fetchDenialsByPayer(tx, wideFilters)),
      ]);
      expect(t1Payer).toHaveLength(1);
      expect(t1Payer[0]!.payerName).toBe(sharedName);
      expect(t1Payer[0]!.sumCents).toBe(16_100);
      expect(t2Payer).toHaveLength(1);
      expect(t2Payer[0]!.sumCents).toBe(29_200);
      expect(t1Payer[0]!.payerId).not.toBe(t2Payer[0]!.payerId);

      const [t1Rate, t2Rate] = await Promise.all([
        withTenant(t1, (tx) => fetchDenialRate(tx, wideFilters)),
        withTenant(t2, (tx) => fetchDenialRate(tx, wideFilters)),
      ]);
      expect(t1Rate.submittedClaims).toBe(2);
      expect(t1Rate.deniedClaims).toBe(2);
      expect(t2Rate.submittedClaims).toBe(2);
      expect(t2Rate.deniedClaims).toBe(2);

      const [t1Bucket, t2Bucket] = await Promise.all([
        withTenant(t1, (tx) => fetchDenialsByDeadlineBucket(tx, wideFilters, today)),
        withTenant(t2, (tx) => fetchDenialsByDeadlineBucket(tx, wideFilters, today)),
      ]);
      // Only the open (status "new") denial counts here — the decided one is excluded (OPEN_STATUSES).
      expect(t1Bucket.find((bkt) => bkt.bucket === "no_deadline")!.sumCents).toBe(11_100);
      expect(t2Bucket.find((bkt) => bkt.bucket === "no_deadline")!.sumCents).toBe(22_200);

      const [t1Status, t2Status] = await Promise.all([
        withTenant(t1, (tx) => fetchClaimsByStatus(tx, wideFilters)),
        withTenant(t2, (tx) => fetchClaimsByStatus(tx, wideFilters)),
      ]);
      expect(t1Status.reduce((s, g) => s + g.count, 0)).toBe(2);
      expect(t2Status.reduce((s, g) => s + g.count, 0)).toBe(2);

      const [t1Outcomes, t2Outcomes] = await Promise.all([
        withTenant(t1, (tx) => fetchAppealOutcomes(tx, wideFilters)),
        withTenant(t2, (tx) => fetchAppealOutcomes(tx, wideFilters)),
      ]);
      expect(t1Outcomes.byPayer[0]!.upheld).toBe(1);
      expect(t1Outcomes.byPayer[0]!.overturned).toBe(0);
      expect(t2Outcomes.byPayer[0]!.overturned).toBe(1);
      expect(t2Outcomes.byPayer[0]!.upheld).toBe(0);
    });
  });
});

describe("Insight reports — calculations against seeded data", () => {
  it("denial rate matches a hand-computed count, counting a denial even if its notice is after the range", async () => {
    const t = await bareTenant("rate", 91);
    const today = todayIn();
    // Claim submitted "in range" but its denial's notice date is far in the future — still counts
    // toward the numerator (spec #3: the denial counts by its own notice date, which may fall
    // after the claim's submission range boundary).
    await seedDenial(t, {
      payerName: "Rate Test Payer (synthetic)",
      category: "coding",
      deniedCents: 1_000,
      noticeDate: "2099-01-01",
      claimStatus: "denied",
      submittedAt: new Date(`${today}T12:00:00Z`),
    });
    const narrowFilters = { dateFrom: today, dateTo: today, payerId: null, error: null };
    const result = await withTenant(t, (tx) => fetchDenialRate(tx, narrowFilters));
    expect(result.submittedClaims).toBe(1);
    expect(result.deniedClaims).toBe(1);
    expect(result.rate).toBe(1);
  });

  it("denial rate matches a hand-computed count from a wide window", async () => {
    const result = await withTenant(a, (tx) => fetchDenialRate(tx, wideFilters));
    const [submitted] = await withTenant(a, (tx) =>
      tx
        .select({ count: sql<number>`count(distinct ${claims.id})::int` })
        .from(claims)
        .where(sql`${claims.status} <> 'draft'`),
    );
    expect(result.submittedClaims).toBe(submitted!.count);
    if (result.submittedClaims === 0) {
      expect(result.rate).toBeNull();
    } else {
      expect(result.rate).toBe(result.deniedClaims / result.submittedClaims);
    }
  });

  it("open denials by deadline bucket always includes the no_deadline bucket, even at zero", async () => {
    const buckets = await withTenant(a, (tx) => fetchDenialsByDeadlineBucket(tx, wideFilters, todayIn()));
    expect(buckets.map((bkt) => bkt.bucket)).toContain("no_deadline");
    const totalCount = buckets.reduce((t, bkt) => t + bkt.count, 0);
    const [openCount] = await withTenant(a, (tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(denials)
        .innerJoin(claims, eq(claims.id, denials.claimId))
        .where(
          and(
            inArray(denials.status, OPEN_STATUSES),
            gte(denials.noticeDate, wideFilters.dateFrom),
            lte(denials.noticeDate, wideFilters.dateTo),
          ),
        ),
    );
    expect(totalCount).toBe(openCount!.count);
  });

  it("appeal outcomes matches a hand-computed overturn rate and reversed amount", async () => {
    const t = await bareTenant("outcomes", 92);
    const today = todayIn();
    const payerName = "Outcomes Test Payer (synthetic)";
    await seedDenial(t, {
      payerName,
      category: "coding",
      deniedCents: 1_000,
      noticeDate: today,
      status: "overturned",
    });
    await seedDenial(t, {
      payerName,
      category: "coding",
      deniedCents: 2_000,
      noticeDate: today,
      status: "overturned",
    });
    await seedDenial(t, {
      payerName,
      category: "coding",
      deniedCents: 4_000,
      noticeDate: today,
      status: "upheld",
    });
    const report = await withTenant(t, (tx) => fetchAppealOutcomes(tx, wideFilters));
    const group = report.byPayer[0]!;
    expect(group.overturned).toBe(2);
    expect(group.upheld).toBe(1);
    expect(group.overturnRate).toBeCloseTo(2 / 3);
    expect(group.reversedCents).toBe(3_000); // sum of the two overturned rows only
  });
});

describe("Insight reports — filters", () => {
  it("restricts every row to the selected payer", async () => {
    const t = await bareTenant("payerfilter", 93);
    const today = todayIn();
    const kept = await seedDenial(t, {
      payerName: "Keep Me (synthetic)",
      category: "coding",
      deniedCents: 1_000,
      noticeDate: today,
    });
    await seedDenial(t, {
      payerName: "Not This One (synthetic)",
      category: "coding",
      deniedCents: 9_000,
      noticeDate: today,
    });
    const filtered = { ...wideFilters, payerId: kept.payerId };
    const result = await withTenant(t, (tx) => fetchDenialsByCategory(tx, filtered));
    expect(result.reduce((s, g) => s + g.sumCents, 0)).toBe(1_000);
  });
});

describe("Insight reports — small-cell suppression (R-8.7)", () => {
  it("suppresses a small, sensitive-tagged row's count and dollars, on-screen and in the export, while leaving a much larger non-sensitive row visible", async () => {
    const t = await bareTenant("suppress", 94);
    const today = todayIn();
    const sensitivePayer = "Suppress Sensitive Payer (synthetic)";
    const mediumPayer = "Suppress Medium Payer (synthetic)";
    const hugePayer = "Suppress Huge Payer (synthetic)";

    // One denial for a sensitive-tagged patient (count 1, under the threshold of 11).
    await seedDenial(t, {
      payerName: sensitivePayer,
      category: "coding",
      deniedCents: 12_345,
      noticeDate: today,
      sensitivityTags: ["hiv"],
    });
    // A medium, non-sensitive group — expected to pick up complementary suppression as the
    // next-smallest visible row once the sensitive row above is suppressed on its own.
    for (let i = 0; i < 5; i++) {
      await seedDenial(t, {
        payerName: mediumPayer,
        category: "eligibility",
        deniedCents: 1_000,
        noticeDate: today,
      });
    }
    // A much larger, non-sensitive group that must stay visible — it is never the next-smallest
    // candidate, so complementary suppression never reaches it.
    for (let i = 0; i < 40; i++) {
      await seedDenial(t, {
        payerName: hugePayer,
        category: "eligibility",
        deniedCents: 1_000,
        noticeDate: today,
      });
    }

    const byPayer = await withTenant(t, (tx) => fetchDenialsByPayer(tx, wideFilters));
    const payerSheetSpec = denialsByPayerSheet(byPayer, insightT, commonT);
    const rowFor = (name: string) => payerSheetSpec.rows.find((r) => r.payerName === name)!;
    expect(isSuppressedCell(rowFor(sensitivePayer).count)).toBe(true);
    // complementary suppression (next-smallest visible, nonzero row)
    expect(isSuppressedCell(rowFor(mediumPayer).count)).toBe(true);
    expect(isSuppressedCell(rowFor(hugePayer).count)).toBe(false);
    expect(rowFor(hugePayer).count).toBe(40);
    // Since some rows are suppressed, the sheet's totals row must be too — otherwise Total minus
    // the visible rows (hugePayer's 40) would reconstruct the sensitive/medium rows' combined count.
    expect(isSuppressedCell(payerSheetSpec.totals!.count)).toBe(true);
    expect(isSuppressedCell(payerSheetSpec.totals!.sumCents)).toBe(true);

    const workbook = await withTenant(t, (tx) =>
      buildSingleReportWorkbook(
        tx,
        "denials-by-payer",
        wideFilters,
        { practiceName: "Insight suppression (synthetic)", userId: t.userId },
        insightT,
        commonT,
        f,
      ),
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(workbook.buffer as unknown as ArrayBuffer);
    const xlsxSheet = wb.getWorksheet("Denials by payer")!;
    const values = xlsxSheet.getSheetValues();
    const sensitiveExcelRow = values.find((row) => Array.isArray(row) && row.includes(sensitivePayer)) as
      unknown[] | undefined;
    expect(sensitiveExcelRow).toBeDefined();
    expect(sensitiveExcelRow!.some((v) => typeof v === "string" && v.startsWith("Suppressed"))).toBe(true);
    // Never a bare number (the raw count/deniedCents) for the suppressed payer's row.
    expect(sensitiveExcelRow!.some((v) => v === 12_345 || v === 123.45)).toBe(false);

    // The exported Total row is suppressed too, and never leaks the true grand totals.
    const totalExcelRow = values.find((row) => Array.isArray(row) && row.includes("Total")) as
      unknown[] | undefined;
    expect(totalExcelRow).toBeDefined();
    expect(totalExcelRow!.some((v) => typeof v === "string" && v.startsWith("Suppressed"))).toBe(true);
    expect(totalExcelRow!.some((v) => v === 46)).toBe(false); // true count total (1 + 5 + 40)

    const about = wb.getWorksheet("About")!;
    const aboutText = about
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    expect(aboutText).toContain("Small-cell suppression");
    expect(aboutText).not.toContain("Totals still reflect every row");
  });

  it("complementary suppression hides the next-smallest row when exactly one row would otherwise be suppressed alone", async () => {
    const t = await bareTenant("complement", 95);
    const today = todayIn();
    // Two payer rows: one sensitive at count 1 (suppressed), one non-sensitive at count 3. With
    // only these two rows, if only the sensitive one were suppressed, the total minus the visible
    // row would reveal it — so the non-sensitive row must be suppressed too.
    await seedDenial(t, {
      payerName: "Complement Sensitive Payer (synthetic)",
      category: "coding",
      deniedCents: 500,
      noticeDate: today,
      sensitivityTags: ["mental_health"],
    });
    for (let i = 0; i < 3; i++) {
      await seedDenial(t, {
        payerName: "Complement Other Payer (synthetic)",
        category: "coding",
        deniedCents: 900,
        noticeDate: today,
      });
    }
    const byPayer = await withTenant(t, (tx) => fetchDenialsByPayer(tx, wideFilters));
    expect(byPayer).toHaveLength(2);
    const sheet = denialsByPayerSheet(byPayer, insightT, commonT);
    expect(sheet.rows.every((r) => isSuppressedCell(r.count))).toBe(true);
    // With every row suppressed, the totals row must be too.
    expect(isSuppressedCell(sheet.totals!.count)).toBe(true);
  });

  it("suppresses the totals row for a single-row sheet whose lone row is suppressed", async () => {
    const t = await bareTenant("single-row", 96);
    const today = todayIn();
    await seedDenial(t, {
      payerName: "Single Row Sensitive Payer (synthetic)",
      category: "coding",
      deniedCents: 700,
      noticeDate: today,
      sensitivityTags: ["genetic"],
    });
    const byPayer = await withTenant(t, (tx) => fetchDenialsByPayer(tx, wideFilters));
    expect(byPayer).toHaveLength(1);
    const sheet = denialsByPayerSheet(byPayer, insightT, commonT);
    expect(isSuppressedCell(sheet.rows[0]!.count)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.count)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.sumCents)).toBe(true);
  });

  it("never chooses a zero-count bucket as the complementary suppression target (deadline buckets)", async () => {
    const t = await bareTenant("zero-complement", 97);
    const today = todayIn();
    // One small, sensitive-tagged open denial with no deadline (goes to the "no_deadline"
    // bucket), and a much larger open group far out (goes to "31-plus"). Every other bucket
    // (past_deadline, 0-7, 8-30) is empty (count 0) and must never be chosen as the complement.
    await seedDenial(t, {
      payerName: "Zero Complement Sensitive Payer (synthetic)",
      category: "coding",
      deniedCents: 300,
      noticeDate: today,
      appealDeadline: null,
      sensitivityTags: ["hiv"],
    });
    for (let i = 0; i < 40; i++) {
      await seedDenial(t, {
        payerName: "Zero Complement Bulk Payer (synthetic)",
        category: "coding",
        deniedCents: 100,
        noticeDate: today,
        appealDeadline: "2099-01-01",
      });
    }
    const buckets = await withTenant(t, (tx) => fetchDenialsByDeadlineBucket(tx, wideFilters, today));
    const sheet = denialsByDeadlineBucketSheet(buckets, insightT, commonT);
    const rowFor = (label: string) => sheet.rows.find((r) => r.bucket === label)!;
    expect(isSuppressedCell(rowFor("No deadline configured").count)).toBe(true);
    // The zero-count buckets are never suppressed — there is nothing in them to hide, and
    // suppressing "0" would be misleading rather than protective.
    for (const emptyLabel of ["Past deadline", "0–7 days", "8–30 days"]) {
      const row = rowFor(emptyLabel);
      if (row) expect(isSuppressedCell(row.count)).toBe(false);
    }
    // "31+ days" (count 40) is the only nonzero, not-yet-suppressed bucket, so it becomes the
    // complement — the zero-count buckets were correctly skipped as candidates for it, but a
    // complement still has to be picked from whatever nonzero bucket remains.
    expect(isSuppressedCell(rowFor("31+ days").count)).toBe(true);
  });
});

describe("Insight reports — audit and export", () => {
  it("records insight.report_viewed and insight.report_exported with consistent filters, a route, and no patient/claim IDs", async () => {
    const baselineRows = await withTenant(a, (tx) =>
      tx.select({ id: auditEvents.id }).from(auditEvents).orderBy(desc(auditEvents.id)).limit(1),
    );
    const baselineId = baselineRows[0]?.id ?? 0;
    const route = "/insight/claims-by-status";
    const exportRoute = "/insight/claims-by-status/export";

    const result = await withTenant(a, async (tx) => {
      await recordReportViewed(tx, a, "claims-by-status", filters, route);
      const workbook = await buildSingleReportWorkbook(
        tx,
        "claims-by-status",
        filters,
        { practiceName: "Insight reporting alpha (synthetic)", userId: a.userId },
        insightT,
        commonT,
        f,
      );
      await recordReportExported(tx, a, "claims-by-status", filters, workbook.rowCount, exportRoute);
      return {
        events: await tx
          .select({ action: auditEvents.action, metadata: auditEvents.metadata })
          .from(auditEvents)
          .where(
            and(
              gt(auditEvents.id, baselineId),
              eq(auditEvents.actorUserId, a.userId),
              inArray(auditEvents.action, ["insight.report_viewed", "insight.report_exported"]),
            ),
          ),
        buffer: workbook.buffer,
        filename: workbook.filename,
        sheets: workbook,
      };
    });

    expect(result.events).toHaveLength(2);
    const viewed = result.events.find((e) => e.action === "insight.report_viewed")!;
    const exported = result.events.find((e) => e.action === "insight.report_exported")!;
    expect(viewed.metadata).toMatchObject({
      reportId: "claims-by-status",
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      route,
      purpose: "operational_reporting",
    });
    expect(exported.metadata).toMatchObject({
      reportId: "claims-by-status",
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      route: exportRoute,
      purpose: "operational_reporting",
      format: "xlsx",
    });
    for (const event of result.events) {
      const json = JSON.stringify(event.metadata);
      expect(json).not.toMatch(/patient|claimId|denialId|mrn/i);
    }
    // Filename carries no PHI — just the report id and the (matching) date range used for both events.
    expect(result.filename).toBe(`claims-by-status_${filters.dateFrom}_${filters.dateTo}.xlsx`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["About", "Claims by status"]);
    const about = workbook.getWorksheet("About")!;
    const aboutText = about
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    expect(aboutText).toContain("Contains confidential practice data");
  });

  it("exported totals match the on-screen totals on the money columns", async () => {
    const result = await withTenant(a, (tx) =>
      buildSingleReportWorkbook(
        tx,
        "claims-by-status",
        wideFilters,
        { practiceName: "Insight reporting alpha (synthetic)", userId: a.userId },
        insightT,
        commonT,
        f,
      ),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Claims by status")!;
    const lastRow = sheet.getRow(sheet.rowCount);
    expect(lastRow.getCell(1).value).toBe("Total");
    const billedTotalDollars = lastRow.getCell(3).value as number;

    // Independently recompute the same total from the on-screen calculation.
    const { fetchClaimsByStatus: fetchAgain } = await import("@/domain/insight/queries");
    const groups = await withTenant(a, (tx) => fetchAgain(tx, wideFilters));
    const expectedCents = groups.reduce((t, g) => t + g.billedCents, 0);
    expect(Math.round(billedTotalDollars * 100)).toBe(expectedCents);
  });

  it("builds an all-reports workbook with a unique sheet per report plus About, no collisions", async () => {
    const result = await withTenant(a, (tx) =>
      buildAllReportsWorkbookFor(
        tx,
        wideFilters,
        { practiceName: "Insight reporting alpha (synthetic)", userId: a.userId },
        insightT,
        commonT,
        f,
      ),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const names = workbook.worksheets.map((w) => w.name);
    expect(names[0]).toBe("About");
    // No duplicate sheet names (this is exactly what caused the 500: two truncated names colliding).
    expect(new Set(names).size).toBe(names.length);
    // One sheet per available report, plus the two appeal-outcomes sheets, plus About.
    expect(names.length).toBeGreaterThanOrEqual(7);
    const about = workbook.getWorksheet("About")!;
    const aboutText = about
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    // The combined workbook never claims a single payer filter applies to every report.
    expect(aboutText).not.toMatch(/Payer:/);
  });
});
