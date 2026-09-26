import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import {
  auditEvents,
  claims,
  claimVersions,
  payers,
  promptPayResponses,
  remittanceClaims,
  remittanceEvents,
  remittances,
} from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { getClaim } from "@/domain/claims/queries";
import { getPromptPayClock, promptPayOverview } from "@/domain/prompt-pay/queries";
import { PromptPayError, recordContest, voidResponse } from "@/domain/prompt-pay/responses";
import { getRemittance, remittanceList } from "@/domain/remittances/queries";
import {
  loadRemittance,
  postRemittance,
  RemittanceError,
  voidRemittance,
} from "@/domain/remittances/records";
import { generateDataset } from "@/domain/synthetic/generator";
import { build835, parse835, type Remittance835 } from "@/edi/x12/835";
import { expectDbError } from "./helpers";

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;
const today = todayIn();

async function practice(label: string, seed: number): Promise<Ctx> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Remittances ${suffix} (synthetic)`,
    asOf: today,
    users: [{ email: `remit-${suffix}@synthetic.test`, displayName: `Remit ${label}`, role: "manager" }],
    dataset: generateDataset({ asOf: today, seed, patients: 6, claims: 30 }),
  });
  return { tenantId, userId: userIds[0]! };
}

/** A sent Florida claim and its payer, for building a synthetic 835 against. */
async function floridaClaim(ctx: Ctx) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ claim: claims, ediPayerId: payers.ediPayerId })
      .from(claims)
      .innerJoin(payers, eq(payers.id, claims.payerId))
      .where(
        and(
          inArray(payers.regime, ["fl_insurer", "fl_hmo"]),
          inArray(claims.status, ["acknowledged", "paid"]),
        ),
      )
      .orderBy(asc(claims.claimNumber))
      .limit(1);
    // Seeded payers all carry an EDI payer ID.
    return { ...row!, ediPayerId: row!.ediPayerId! };
  });
}

function remit835(input: {
  ediPayerId: string;
  claimNumber: string;
  trace: string;
  paid: number;
  charge: number;
}) {
  const parsed: Remittance835 = {
    payment: { method: "eft", totalPaidCents: input.paid, paymentDate: today, traceNumber: input.trace },
    payer: { name: "SYNTHETIC PAYER", ediPayerId: input.ediPayerId },
    claims: [
      {
        claimNumber: input.claimNumber,
        statusCode: "2",
        chargeCents: input.charge,
        paidCents: input.paid,
        patientResponsibilityCents: 0,
        payerControlNumber: "SYNICN1",
        adjustments: [{ group: "CO", carc: "45", cents: input.charge - input.paid }],
        rarcs: [],
      },
    ],
  };
  // Through the real parser, as an upload would be.
  return parse835(build835(parsed));
}

beforeAll(async () => {
  a = await practice("alpha", 41);
  b = await practice("beta", 42);
});

afterAll(() => closeDatabase());

describe("seeded remittances", () => {
  it("posts one synthetic remittance per payer and payment date, with its history", async () => {
    const list = await withTenant(a, (tx) => remittanceList(tx, { page: 1 }));
    expect(list.total).toBeGreaterThan(0);
    expect(list.rows.every((r) => r.status === "posted")).toBe(true);
    const detail = await withTenant(a, (tx) => getRemittance(tx, list.rows[0]!.id));
    expect(detail!.history.map((h) => h.event).sort()).toEqual(["posted", "received"]);
    expect(detail!.lines.length).toBe(list.rows[0]!.claims);
  });

  it("puts the seeded payments and denials on prompt-pay clocks", async () => {
    const overview = await withTenant(a, (tx) => promptPayOverview(tx, { page: 1 }, today));
    expect(overview.total).toBeGreaterThan(0);
    expect(overview.rows.every((r) => r.clock.applies)).toBe(true);
  });
});

describe("loading and posting an 835 (R1)", () => {
  it("loads as ready to post, posts with a claim version and a prompt-pay payment, and audits IDs", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const parsed = remit835({
      ediPayerId,
      claimNumber: claim.claimNumber,
      trace: `SYN-T-${Date.now()}`,
      paid: 1_250,
      charge: 2_000,
    });
    const { id } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }));
    const unchanged = await withTenant(a, (tx) => getClaim(tx, claim.id));
    expect(unchanged!.claim.paidCents).toBe(claim.paidCents);

    const result = await withTenant(a, (tx) => postRemittance(tx, { ...a, remittanceId: id }));
    expect(result).toEqual({ claims: 1, denialsCaptured: 0 });

    const after = await withTenant(a, (tx) => getClaim(tx, claim.id));
    expect(after!.claim.paidCents).toBe(claim.paidCents + 1_250);
    expect(after!.claim.version).toBe(claim.version + 1);
    expect(after!.history[0]).toMatchObject({ version: claim.version + 1, author: "Remit alpha" });
    expect(after!.history[0]!.reason).toContain(parsed.payment.traceNumber);
    expect(after!.history[0]!.snapshot.paidCents).toBe(claim.paidCents + 1_250);

    const detail = await withTenant(a, (tx) => getRemittance(tx, id));
    expect(detail!.remittance.status).toBe("posted");
    expect(detail!.history.map((h) => h.event)).toEqual(["posted", "received"]);

    const clock = await withTenant(a, (tx) => getPromptPayClock(tx, claim.id, today));
    expect(
      clock!.history.some((h) => h.remittanceId === id && h.kind === "payment" && h.cents === 1_250),
    ).toBe(true);

    const events = await withTenant(a, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.entityId, id)).orderBy(asc(auditEvents.occurredAt)),
    );
    expect(events.map((e) => e.action)).toEqual(["remittance.uploaded", "remittance.posted"]);
    expect(JSON.stringify(events.map((e) => e.metadata))).not.toMatch(/SYN-T-/);

    await expect(withTenant(a, (tx) => postRemittance(tx, { ...a, remittanceId: id }))).rejects.toThrow(
      /already posted/,
    );
  });

  it("refuses unknown payers, unknown claims, duplicate traces, and reversals", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const base = { ediPayerId, claimNumber: claim.claimNumber, paid: 500, charge: 1_000 };
    const load = (parsed: Remittance835) => withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }));

    await expect(load(remit835({ ...base, ediPayerId: "NOPE1", trace: "SYN-X1" }))).rejects.toThrow(
      /No payer in this practice/,
    );
    await expect(load(remit835({ ...base, claimNumber: "CLM-NOT-HERE", trace: "SYN-X2" }))).rejects.toThrow(
      /No claim to this payer matches CLM-NOT-HERE/,
    );
    const trace = `SYN-DUP-${Date.now()}`;
    await load(remit835({ ...base, trace }));
    await expect(load(remit835({ ...base, trace }))).rejects.toThrow(/already on file/);
    const reversal = remit835({ ...base, trace: "SYN-X3" });
    reversal.claims[0]!.statusCode = "22";
    await expect(load(reversal)).rejects.toBeInstanceOf(RemittanceError);
  });

  it("voids only with a reason, keeps the remittance, and makes it final", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const parsed = remit835({
      ediPayerId,
      claimNumber: claim.claimNumber,
      trace: `SYN-V-${Date.now()}`,
      paid: 100,
      charge: 200,
    });
    const { id } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }));
    await expect(
      withTenant(a, (tx) => voidRemittance(tx, { ...a, remittanceId: id, reason: " " })),
    ).rejects.toThrow(/Say why/);
    await withTenant(a, (tx) =>
      voidRemittance(tx, { ...a, remittanceId: id, reason: "Loaded the wrong payer file" }),
    );
    const detail = await withTenant(a, (tx) => getRemittance(tx, id));
    expect(detail!.remittance.status).toBe("void");
    expect(detail!.history[0]).toMatchObject({ event: "void", reason: "Loaded the wrong payer file" });
    await expect(withTenant(a, (tx) => postRemittance(tx, { ...a, remittanceId: id }))).rejects.toThrow(
      /void/,
    );
  });
});

describe("remittance history is enforced by the database", () => {
  // No UPDATE grant for the app role, and a trigger behind it for any role that has one.
  it("refuses edits to claim payments, events, and responses", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.update(remittanceClaims).set({ paidCents: 1 })),
      /permission denied|append-only/,
    );
    await expectDbError(
      withTenant(a, (tx) => tx.update(remittanceEvents).set({ reason: "rewritten" })),
      /permission denied|append-only/,
    );
    await expectDbError(
      withTenant(a, (tx) => tx.update(promptPayResponses).set({ cents: 1 })),
      /permission denied|append-only/,
    );
  });

  it("refuses changing a remittance's amounts or status without a history row", async () => {
    const [row] = await withTenant(a, (tx) => tx.select().from(remittances).limit(1));
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(remittances).set({ totalPaidCents: 1 }).where(eq(remittances.id, row!.id)),
      ),
      /only its status changes/,
    );
    const { claim, ediPayerId } = await floridaClaim(a);
    const parsed = remit835({
      ediPayerId,
      claimNumber: claim.claimNumber,
      trace: `SYN-S-${Date.now()}`,
      paid: 100,
      charge: 200,
    });
    const { id } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }));
    await expectDbError(
      withTenant(a, (tx) => tx.update(remittances).set({ status: "posted" }).where(eq(remittances.id, id))),
      /without a history row/,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(remittances).set({ status: "received" }).where(eq(remittances.id, row!.id)),
      ),
      /is final/,
    );
  });

  it("refuses adding claim payments after loading, and recording as another user", async () => {
    const [remit] = await withTenant(a, (tx) => tx.select().from(remittances).limit(1));
    const [line] = await withTenant(a, (tx) => tx.select().from(remittanceClaims).limit(1));
    await expectDbError(
      withTenant(a, (tx) =>
        tx
          .insert(remittanceClaims)
          .values({ ...line!, id: undefined, remittanceId: remit!.id, createdAt: undefined }),
      ),
      /only be added while the remittance is loaded/,
    );
    const { claim, ediPayerId } = await floridaClaim(a);
    const ready = await withTenant(a, (tx) =>
      loadRemittance(tx, {
        ...a,
        parsed: remit835({
          ediPayerId,
          claimNumber: claim.claimNumber,
          trace: `SYN-A-${Date.now()}`,
          paid: 100,
          charge: 200,
        }),
      }),
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(remittanceEvents).values({
          tenantId: a.tenantId,
          remittanceId: ready.id,
          event: "void",
          reason: "Spoofed",
          actorId: b.userId,
        }),
      ),
      /recording user must be the current user/,
    );
  });
});

describe("tenant isolation on remittance and prompt-pay tables (R-7.2.4)", () => {
  const tables = { remittances, remittanceClaims, remittanceEvents, promptPayResponses };

  it.each(Object.entries(tables))("%s shows a tenant only its own rows", async (_name, table) => {
    const own = await withTenant(a, (tx) => tx.select({ tenantId: table.tenantId }).from(table));
    expect(own.length).toBeGreaterThan(0);
    expect(new Set(own.map((r) => r.tenantId))).toEqual(new Set([a.tenantId]));
    const other = await withTenant(a, (tx) =>
      tx.select({ id: table.id }).from(table).where(eq(table.tenantId, b.tenantId)),
    );
    expect(other).toHaveLength(0);
  });

  it.each(Object.entries(tables))("%s can't be deleted", async (_name, table) => {
    await expectDbError(
      withTenant(a, (tx) => tx.delete(table)),
      /permission denied/,
    );
  });

  it("rejects a remittance stamped with another tenant, or pointing at another tenant's payer", async () => {
    const [payerB] = await withTenant(b, (tx) => tx.select({ id: payers.id }).from(payers).limit(1));
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(remittances).values({
          tenantId: b.tenantId,
          payerId: payerB!.id,
          method: "eft",
          traceNumber: "SYN-CROSS",
          paymentDate: today,
          totalPaidCents: 0,
          source: "upload",
        }),
      ),
      /row-level security/,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(remittances).values({
          tenantId: a.tenantId,
          payerId: payerB!.id,
          method: "eft",
          traceNumber: "SYN-CROSS",
          paymentDate: today,
          totalPaidCents: 0,
          source: "upload",
        }),
      ),
      /remittances_payer_fk/,
    );
  });

  it("can't load a remittance against another practice's claims", async () => {
    const { claim, ediPayerId } = await floridaClaim(b);
    const parsed = remit835({
      ediPayerId,
      claimNumber: claim.claimNumber,
      trace: "SYN-B1",
      paid: 100,
      charge: 200,
    });
    // Payer IDs are the same synthetic set in both practices; B's claim number isn't A's.
    await expect(withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }))).rejects.toThrow(
      /No claim to this payer/,
    );
  });
});

describe("prompt-pay responses (PP1)", () => {
  it("records a contest, then marks it recorded in error without losing it", async () => {
    const { claim } = await floridaClaim(a);
    const { id } = await withTenant(a, (tx) =>
      recordContest(tx, {
        ...a,
        claimId: claim.id,
        responseDate: claim.payerReceivedDate!,
        note: "Payer asked for the visit note",
        today,
      }),
    );
    let clock = await withTenant(a, (tx) => getPromptPayClock(tx, claim.id, today));
    expect(clock!.history.find((h) => h.id === id)).toMatchObject({
      kind: "contest",
      recordedByName: "Remit alpha",
    });

    await expect(
      withTenant(a, (tx) => voidResponse(tx, { ...a, responseId: id, reason: "no" })),
    ).rejects.toBeInstanceOf(PromptPayError);
    await withTenant(a, (tx) => voidResponse(tx, { ...a, responseId: id, reason: "Wrong claim selected" }));
    clock = await withTenant(a, (tx) => getPromptPayClock(tx, claim.id, today));
    expect(clock!.history.filter((h) => h.id === id || h.voidsResponseId === id)).toHaveLength(2);
    await expect(
      withTenant(a, (tx) => voidResponse(tx, { ...a, responseId: id, reason: "Twice is not allowed" })),
    ).rejects.toThrow(/already marked/);
  });

  it("refuses contests dated before receipt or in the future, and voiding remittance payments", async () => {
    const { claim } = await floridaClaim(a);
    const record = (responseDate: string) =>
      withTenant(a, (tx) =>
        recordContest(tx, { ...a, claimId: claim.id, responseDate, note: "Request for records", today }),
      );
    await expect(record("2000-01-01")).rejects.toThrow(/before the payer received/);
    await expect(record("2999-01-01")).rejects.toThrow(/future/);
    const [payment] = await withTenant(a, (tx) =>
      tx
        .select({ id: promptPayResponses.id })
        .from(promptPayResponses)
        .where(sql`${promptPayResponses.remittanceId} is not null`)
        .limit(1),
    );
    await expect(
      withTenant(a, (tx) => voidResponse(tx, { ...a, responseId: payment!.id, reason: "Should not work" })),
    ).rejects.toThrow(/come from remittances/);
  });

  it("claim versions from posting are readable in the claim history", async () => {
    const rows = await withTenant(a, (tx) =>
      tx
        .select()
        .from(claimVersions)
        .where(sql`${claimVersions.reason} like 'Posted from remittance %'`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.changedFields.includes("paidCents"))).toBe(true);
  });
});

describe("reversals and denial capture (R2)", () => {
  function file(ediPayerId: string, trace: string, claims: Remittance835["claims"]): Remittance835 {
    const total = claims.reduce((sum, c) => sum + c.paidCents, 0);
    return parse835(
      build835({
        payment: {
          method: total > 0 ? "eft" : "non_payment",
          totalPaidCents: total,
          paymentDate: today,
          traceNumber: trace,
        },
        payer: { name: "SYNTHETIC PAYER", ediPayerId },
        claims,
      }),
    );
  }
  const line = (claimNumber: string, over: Partial<Remittance835["claims"][number]>) => ({
    claimNumber,
    statusCode: "1",
    chargeCents: 2_000,
    paidCents: 0,
    patientResponsibilityCents: 0,
    payerControlNumber: null,
    adjustments: [],
    rarcs: [],
    ...over,
  });

  it("captures unexpected adjustments as denials linked to the remittance, not CO-45 or PR", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const parsed = file(ediPayerId, `SYN-D-${Date.now()}`, [
      line(claim.claimNumber, {
        statusCode: "2",
        paidCents: 800,
        adjustments: [
          { group: "CO", carc: "45", cents: 400 },
          { group: "PR", carc: "2", cents: 300 },
          { group: "CO", carc: "97", cents: 500 },
        ],
        rarcs: ["M15"],
      }),
    ]);
    const { id } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }));
    const result = await withTenant(a, (tx) => postRemittance(tx, { ...a, remittanceId: id }));
    expect(result.denialsCaptured).toBe(1);
    const captureAudit = await withTenant(a, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, "denial.captured")),
    );
    expect(captureAudit.some((e) => (e.metadata as Record<string, string>).remittanceId === id)).toBe(true);
    const detail = await withTenant(a, (tx) => getRemittance(tx, id));
    expect(detail!.captured).toEqual([
      expect.objectContaining({
        groupCode: "CO",
        carc: "97",
        category: "bundling",
        deniedCents: 500,
        status: "new",
      }),
    ]);
  });

  it("posts a reversal and its corrected claim: paid total, clock correction, and claim history", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const first = file(ediPayerId, `SYN-R1-${Date.now()}`, [
      line(claim.claimNumber, { statusCode: "2", paidCents: 1_500 }),
    ]);
    const { id: firstId } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed: first }));
    await withTenant(a, (tx) => postRemittance(tx, { ...a, remittanceId: firstId }));
    const before = await withTenant(a, (tx) => getClaim(tx, claim.id));

    const trace = `SYN-R2-${Date.now()}`;
    const second = file(ediPayerId, trace, [
      line(claim.claimNumber, { statusCode: "22", chargeCents: -2_000, paidCents: -1_500 }),
      line(claim.claimNumber, { statusCode: "2", paidCents: 1_200 }),
    ]);
    const { id } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed: second }));
    await withTenant(a, (tx) => postRemittance(tx, { ...a, remittanceId: id }));

    const after = await withTenant(a, (tx) => getClaim(tx, claim.id));
    expect(after!.claim.paidCents).toBe(before!.claim.paidCents - 1_500 + 1_200);
    expect(after!.claim.version).toBe(before!.claim.version + 2);
    const clock = await withTenant(a, (tx) => getPromptPayClock(tx, claim.id, today));
    const reversed = clock!.history.find((h) => h.note === `Reversed by remittance ${trace}`);
    expect(reversed).toBeDefined();
    const original = clock!.history.find((h) => h.id === reversed!.voidsResponseId);
    expect(original).toMatchObject({ kind: "payment", cents: 1_500, remittanceId: firstId });
  });

  it("refuses negative payments that aren't marked as reversals", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const parsed = file(ediPayerId, `SYN-N-${Date.now()}`, [
      line(claim.claimNumber, { statusCode: "1", paidCents: -100 }),
    ]);
    await expect(withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }))).rejects.toThrow(
      /must be reversals/,
    );
  });

  it("refuses a second posted event or a late loaded event", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const own = file(ediPayerId, `SYN-E-${Date.now()}`, [
      line(claim.claimNumber, { statusCode: "2", paidCents: 50 }),
    ]);
    const { id: postedId } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed: own }));
    await withTenant(a, (tx) => postRemittance(tx, { ...a, remittanceId: postedId }));
    const posted = { id: postedId };
    const spoof = (event: "received" | "posted") =>
      withTenant(a, (tx) =>
        tx.insert(remittanceEvents).values({
          tenantId: a.tenantId,
          remittanceId: posted!.id,
          event,
          reason: "Spoofed",
          actorId: a.userId,
        }),
      );
    await expectDbError(spoof("posted"), /already has this history event/);
    await expectDbError(spoof("received"), /already has this history event/);
  });

  it("refuses a history row without the signed-in user", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const parsed = file(ediPayerId, `SYN-U-${Date.now()}`, [
      line(claim.claimNumber, { statusCode: "2", paidCents: 50 }),
    ]);
    const { id } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }));
    await expectDbError(
      withTenant(a, (tx) =>
        tx
          .insert(remittanceEvents)
          .values({ tenantId: a.tenantId, remittanceId: id, event: "void", reason: "No actor" }),
      ),
      /needs the signed-in user/,
    );
  });

  it("refuses reversals with no matching payment, reversals larger than paid, and $0 reversals", async () => {
    const { claim, ediPayerId } = await floridaClaim(a);
    const fresh = await withTenant(a, (tx) => getClaim(tx, claim.id));
    const post = async (claims: Remittance835["claims"]) => {
      const parsed = file(ediPayerId, `SYN-X-${Date.now()}-${Math.random()}`, claims);
      const { id } = await withTenant(a, (tx) => loadRemittance(tx, { ...a, parsed }));
      return withTenant(a, (tx) => postRemittance(tx, { ...a, remittanceId: id }));
    };
    await expect(
      post([
        line(claim.claimNumber, {
          statusCode: "22",
          chargeCents: -2_000,
          paidCents: -(fresh!.claim.paidCents + 1),
        }),
      ]),
    ).rejects.toThrow(/more than was paid/);
    await expect(
      post([line(claim.claimNumber, { statusCode: "22", chargeCents: -2_000, paidCents: -7 })]),
    ).rejects.toThrow(/doesn't match an earlier payment/);
    await expect(
      withTenant(a, (tx) =>
        loadRemittance(tx, {
          ...a,
          parsed: file(ediPayerId, `SYN-Z-${Date.now()}`, [
            line(claim.claimNumber, { statusCode: "22", chargeCents: -2_000, paidCents: 0 }),
            line(claim.claimNumber, { statusCode: "2", paidCents: 10 }),
          ]),
        }),
      ),
    ).rejects.toThrow(/reverse \$0/);
    const after = await withTenant(a, (tx) => getClaim(tx, claim.id));
    expect(after!.claim.paidCents).toBe(fresh!.claim.paidCents);
  });

  it("returns a fully reversed claim to accepted-by-payer and audits the reversal", async () => {
    const { claim, ediPayerId } = await floridaClaim(b);
    const start = await withTenant(b, (tx) => getClaim(tx, claim.id));
    const pay = file(ediPayerId, `SYN-P-${Date.now()}`, [
      line(claim.claimNumber, { statusCode: "2", paidCents: 900 }),
    ]);
    const { id: payId } = await withTenant(b, (tx) => loadRemittance(tx, { ...b, parsed: pay }));
    await withTenant(b, (tx) => postRemittance(tx, { ...b, remittanceId: payId }));
    // Take back everything paid so far: the seeded payment (if any) is reversed separately first.
    const clock = await withTenant(b, (tx) => getPromptPayClock(tx, claim.id, today));
    const payments = clock!.history.filter((h) => h.kind === "payment" && !h.voidsResponseId);
    const reversal = file(
      ediPayerId,
      `SYN-RV-${Date.now()}`,
      payments
        .map((p) => line(claim.claimNumber, { statusCode: "22", chargeCents: -2_000, paidCents: -p.cents }))
        .slice(0, 1),
    );
    const { id } = await withTenant(b, (tx) => loadRemittance(tx, { ...b, parsed: reversal }));
    await withTenant(b, (tx) => postRemittance(tx, { ...b, remittanceId: id }));
    const after = await withTenant(b, (tx) => getClaim(tx, claim.id));
    expect(after!.claim.paidCents).toBe(start!.claim.paidCents + 900 - payments[0]!.cents);
    if (after!.claim.paidCents === 0) expect(after!.claim.status).toBe("acknowledged");
    const audits = await withTenant(b, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, "prompt_pay.response_voided")),
    );
    expect(audits.some((e) => (e.metadata as Record<string, string>).remittanceId === id)).toBe(true);
  });
});
