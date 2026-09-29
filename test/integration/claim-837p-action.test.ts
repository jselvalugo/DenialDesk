import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, providers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { hit, limitFor } from "@/lib/rate-limit";
import { createTestTenant } from "./helpers";
import { MEMBER_ID, newClaim, seedBilling, TIN, type Billing, type Ctx } from "./claim-837p-fixtures";

// docs/specs/claims.md C3a: the generateClaim837PAction server action, run against the real domain and
// database. Faked: the session, the request headers (the language), and nothing else.
// R-5.1.2 (roles), R-7.5.1 (every refusal audited, codes only), R-7.4.6 (no value in a refusal).

type Role = "admin" | "manager" | "specialist" | "compliance";
let auth: { tenantId: string; userId: string; role: Role };

vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "en" }),
}));

const { generateClaim837PAction } = await import("@/app/(app)/claims/[id]/edi-actions");

let practice: Ctx & Billing;

beforeAll(async () => {
  const ctx = await createTestTenant("837P action");
  practice = { ...ctx, ...(await seedBilling(ctx)) };
});

afterAll(() => closeDatabase());

function signIn(role: Role = "specialist") {
  auth = { tenantId: practice.tenantId, userId: practice.userId, role };
}

function form(claimId: string, pointers: Record<number, number[]> = {}): FormData {
  const data = new FormData();
  data.set("claimId", claimId);
  for (const [line, positions] of Object.entries(pointers))
    for (const position of positions) data.append(`pointer-${line}`, String(position));
  return data;
}

async function eventsOf(action: string, claimId: string) {
  return withTenant(practice, (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, action as "claim.837p_refused"), eq(auditEvents.entityId, claimId))),
  );
}

describe("generateClaim837PAction", () => {
  it("returns the file and a masked preview to a person who bills, and audits it", async () => {
    signIn("specialist");
    const claimId = await newClaim(practice, practice);
    const state = await generateClaim837PAction({}, form(claimId));
    expect(state.error).toBeUndefined();
    expect(state.result).toMatchObject({ segmentCount: 31, lineCount: 2, pastFilingDeadline: false });
    expect(state.result!.text).toContain(`MI*${MEMBER_ID}~`);
    expect(state.result!.preview).not.toContain(MEMBER_ID);
    expect(state.result!.preview).not.toContain(TIN);
    expect(state.result!.filename).toMatch(/^837p-\d{9}\.x12$/);
    expect(await eventsOf("claim.837p_generated", claimId)).toHaveLength(1);
  });

  it("reads the diagnosis pointers the person ticked, and asks when there are none", async () => {
    signIn("manager");
    const claimId = await newClaim(practice, practice, { diagnosisCodes: ["E11.9", "I10"] });
    const refused = await generateClaim837PAction({}, form(claimId));
    expect(refused.result).toBeUndefined();
    expect(refused.error).toBe("The 837P was not generated. Fix the items below and try again.");
    expect(refused.issues).toEqual([
      "Line 1: choose which diagnoses support this line.",
      "Line 2: choose which diagnoses support this line.",
    ]);
    const accepted = await generateClaim837PAction({}, form(claimId, { 1: [1, 2], 2: [2] }));
    expect(accepted.result!.text).toContain("SV1*HC:99213:25*125.00*UN*1***1:2~");
    expect(accepted.result!.text).toContain("SV1*HC:36415*30.00*UN*1***2~");
    // Junk in the form is bounded, not trusted: positions past 12, non-numbers, and repeats are dropped.
    const junk = form(claimId, { 1: [1, 1, 99], 2: [2] });
    junk.append("pointer-1", "abc");
    const cleaned = await generateClaim837PAction({}, junk);
    expect(cleaned.result!.text).toContain("SV1*HC:99213:25*125.00*UN*1***1~");
  });

  it("refuses compliance, audits the attempt, and builds nothing", async () => {
    signIn("compliance");
    const claimId = await newClaim(practice, practice);
    const state = await generateClaim837PAction({}, form(claimId));
    expect(state).toEqual({ error: "Your role can view claims but not generate claim files." });
    const [event] = await eventsOf("claim.837p_refused", claimId);
    expect(event).toMatchObject({ actorUserId: practice.userId, metadata: { refusal: "forbidden" } });
    expect(await eventsOf("claim.837p_generated", claimId)).toHaveLength(0);
  });

  it("refuses a malformed claim ID before touching anything", async () => {
    signIn();
    expect(await generateClaim837PAction({}, form("not-a-uuid"))).toEqual({
      error: "Reload the page and try again.",
    });
  });

  it("refuses a claim that isn't the practice's as not found", async () => {
    signIn();
    const other = await createTestTenant("837P action other");
    const otherBilling = await seedBilling(other);
    const claimId = await newClaim(other, otherBilling);
    expect(await generateClaim837PAction({}, form(claimId))).toEqual({
      error: "This claim could not be found.",
    });
  });

  it("says what is missing in sentences that hold no value, and takes no number", async () => {
    signIn();
    const [bare] = await systemDb()
      .insert(providers)
      .values({
        tenantId: practice.tenantId,
        name: "Dr. Bare (synthetic)",
        npi: "1999999992",
        taxonomy: "207R00000X",
      })
      .returning({ id: providers.id });
    const claimId = await newClaim(practice, practice, { providerId: bare!.id });
    const state = await generateClaim837PAction({}, form(claimId));
    expect(state.issues).toEqual([
      "The provider's first and last name for billing are missing.",
      "The provider's tax ID or its type is missing, or the tax ID is not nine digits.",
      "The provider's billing address is incomplete: it needs a street, city, state, and nine-digit ZIP code.",
    ]);
    const text = JSON.stringify(state);
    for (const secret of [MEMBER_ID, "Synthpatient", "Jane", "1999999992", "99213", "E11"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("generateClaim837PAction: rate limit (generate_837p, per practice)", () => {
  it("refuses the thirty-first attempt in ten minutes, audits it, and builds nothing", async () => {
    const ctx = await createTestTenant("837P action limit");
    const limited = { ...ctx, ...(await seedBilling(ctx)) };
    auth = { tenantId: ctx.tenantId, userId: ctx.userId, role: "specialist" };
    const claimId = await newClaim(limited, limited);
    // Fix the clock in the middle of the window so a boundary can't fall between the hits and the action.
    const windowMs = limitFor("generate_837p").windowSeconds * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Math.floor(Date.now() / windowMs) * windowMs + windowMs / 2);
    try {
      for (let i = 0; i < 30; i++) await hit("generate_837p", `practice:${ctx.tenantId}`);
      const state = await generateClaim837PAction({}, form(claimId));
      expect(state).toEqual({
        error: "Too many files were generated in a short time. Wait a few minutes and try again.",
      });
    } finally {
      vi.useRealTimers();
    }
    const events = await withTenant(limited, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, "security.rate_limited")),
    );
    expect(events[0]).toMatchObject({
      reason: "generate_837p",
      entityType: "claim",
      entityId: claimId,
      metadata: { bucket: "generate_837p" },
    });
    const generated = await withTenant(limited, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.action, "claim.837p_generated")),
    );
    expect(generated).toHaveLength(0);
  });
});
