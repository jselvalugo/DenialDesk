import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { appeals, auditEvents, claims, denials, patients, payers } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { getAppeal } from "@/domain/appeals/queries";
import { getClaim } from "@/domain/claims/queries";
import { getDenial } from "@/domain/denials/queries";
import { generateDataset } from "@/domain/synthetic/generator";

// R-5.1.2 (minimum necessary), R-7.5.1 (reveal audited): the member ID on file is the patient's primary
// payer's. A denial or appeal on a claim billed to another payer neither shows its last four nor reveals
// it, and a refused reveal writes no `patient.member_id_revealed` event. Faked: the session, the request
// headers (the language), and Next's cache revalidation.

const today = todayIn();
let auth: { tenantId: string; userId: string; role: "specialist" };

vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "en" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const denialActions = await import("@/app/(app)/denials/[id]/actions");
const appealActions = await import("@/app/(app)/appeals/[id]/actions");

interface Case {
  denialId: string;
  appealId: string;
  claimId: string;
  patientId: string;
}

let samePayer: Case;
let otherPayer: Case;

async function makeCase(): Promise<Case> {
  return withTenant(auth, async (tx) => {
    const [row] = await tx
      .select({ denialId: denials.id, claimId: claims.id, patientId: patients.id })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .where(and(isNotNull(patients.memberIdEnc), eq(patients.primaryPayerId, claims.payerId)))
      .orderBy(sql`random()`)
      .limit(1);
    if (!row) throw new Error("Seeded practice has no denial billed to the patient's primary payer.");
    const [appeal] = await tx
      .insert(appeals)
      .values({
        tenantId: auth.tenantId,
        denialId: row.denialId,
        claimId: row.claimId,
        level: "first_level",
        filedBy: auth.userId,
        deadline: addCalendarDays(today, 10),
        deadlineBasis: "payer_contract",
        deadlineCitation: "Payer contract",
      })
      .returning({ id: appeals.id });
    return { ...row, appealId: appeal!.id };
  });
}

async function revealEvents(patientId: string): Promise<number> {
  return withTenant(auth, async (tx) => {
    const rows = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "patient.member_id_revealed"), eq(auditEvents.entityId, patientId)));
    return rows.length;
  });
}

beforeAll(async () => {
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Member ID reveal ${Date.now()} (synthetic)`,
    asOf: today,
    users: [
      { email: `reveal-${Date.now()}@synthetic.test`, displayName: "Reveal Tester", role: "specialist" },
    ],
    dataset: generateDataset({ asOf: today, seed: 43, patients: 20, claims: 80 }),
  });
  auth = { tenantId, userId: userIds[0]!, role: "specialist" };
  samePayer = await makeCase();
  otherPayer = await makeCase();
  while (otherPayer.patientId === samePayer.patientId) otherPayer = await makeCase();
  // Move the second patient's primary payer to another payer: their member ID on file is now that
  // payer's, not the one this claim was billed to.
  await withTenant(auth, async (tx) => {
    const [claim] = await tx
      .select({ payerId: claims.payerId })
      .from(claims)
      .where(eq(claims.id, otherPayer.claimId));
    const [other] = await tx
      .select({ id: payers.id })
      .from(payers)
      .where(ne(payers.id, claim!.payerId))
      .limit(1);
    if (!other) throw new Error("Seeded practice has only one payer.");
    await tx.update(patients).set({ primaryPayerId: other.id }).where(eq(patients.id, otherPayer.patientId));
  });
});

afterAll(() => closeDatabase());

describe("member ID on the claim's own payer", () => {
  it("shows the last four on the claim, denial, and appeal pages", async () => {
    await withTenant(auth, async (tx) => {
      const denial = await getDenial(tx, samePayer.denialId);
      const appeal = await getAppeal(tx, samePayer.appealId);
      const claim = await getClaim(tx, samePayer.claimId);
      for (const patient of [denial!.patient, appeal!.patient, claim!.patient]) {
        expect(patient.memberIdLast4).toMatch(/^.{4}$/);
        expect(patient.memberIdForOtherPayer).toBe(false);
      }
    });
  });

  it("reveals it from a denial and an appeal, and audits each reveal", async () => {
    const before = await revealEvents(samePayer.patientId);
    const fromDenial = await denialActions.revealMemberId(samePayer.denialId, "payer_call");
    const fromAppeal = await appealActions.revealMemberId(samePayer.appealId, "appeal");
    expect(fromDenial.error).toBeUndefined();
    expect(fromDenial.value).toMatch(/^SYN/);
    expect(fromAppeal.value).toBe(fromDenial.value);
    expect(await revealEvents(samePayer.patientId)).toBe(before + 2);
  });
});

describe("member ID on file for a different payer", () => {
  it("hides the last four and flags it on the claim, denial, and appeal pages", async () => {
    await withTenant(auth, async (tx) => {
      const denial = await getDenial(tx, otherPayer.denialId);
      const appeal = await getAppeal(tx, otherPayer.appealId);
      const claim = await getClaim(tx, otherPayer.claimId);
      for (const patient of [denial!.patient, appeal!.patient, claim!.patient]) {
        expect(patient.memberIdLast4).toBe("");
        expect(patient.memberIdForOtherPayer).toBe(true);
      }
    });
  });

  it("refuses to reveal it from a denial or an appeal and writes no reveal event", async () => {
    const before = await revealEvents(otherPayer.patientId);
    const fromDenial = await denialActions.revealMemberId(otherPayer.denialId, "payer_call");
    const fromAppeal = await appealActions.revealMemberId(otherPayer.appealId, "appeal");
    for (const result of [fromDenial, fromAppeal]) {
      expect(result.value).toBeUndefined();
      expect(result.error).toBe("The member ID on file is for a different payer than this claim's.");
    }
    expect(await revealEvents(otherPayer.patientId)).toBe(before);
  });
});
