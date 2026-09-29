import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabase } from "@/db/client";
import { DatabaseError } from "@/db/errors";
import { auditEvents, claims } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { CHARGE_FILE_HEADER } from "@/domain/claims/charge-file";
import { hit, limitFor } from "@/lib/rate-limit";
import { createTestTenant, seedChargeImportPractice, type ChargeImportPractice } from "./helpers";

// docs/specs/claims.md C2: the importCharges server action, run against the real domain and database.
// Faked: the session, the request headers (the language), and Next's cache revalidation; and, for the two
// failure paths only, the import itself (to raise a unique violation or a database failure that the real
// import can't be made to produce on demand). R-7.5.1 (every refusal audited, counts only), R-5.1.2.

type Role = "admin" | "manager" | "specialist" | "compliance";
let auth: { tenantId: string; userId: string; role: Role };
const control = vi.hoisted(() => ({ fail: null as Error | null }));

vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "en" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/domain/claims/charge-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/claims/charge-import")>();
  return {
    ...actual,
    importChargeClaims: (...args: Parameters<typeof actual.importChargeClaims>) =>
      control.fail ? Promise.reject(control.fail) : actual.importChargeClaims(...args),
  };
});

const { importCharges } = await import("@/app/(app)/claims/import/actions");

const FIXTURE = readFileSync(
  new URL("../fixtures/synthetic/charge-import-sample.csv", import.meta.url),
  "utf8",
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterAll(() => closeDatabase());
beforeEach(() => {
  control.fail = null;
});

async function signedIn(role: Role = "specialist"): Promise<ChargeImportPractice> {
  const practice = await seedChargeImportPractice(await createTestTenant("Charge import action"));
  auth = { tenantId: practice.tenantId, userId: practice.userId, role };
  return practice;
}

function form(
  practice: ChargeImportPractice,
  text: string,
  options: { attest?: boolean; name?: string } = {},
): FormData {
  const data = new FormData();
  data.set("file", new File([text], options.name ?? "charges.csv", { type: "text/csv" }));
  data.set("providerId", practice.providerId);
  data.set("locationId", practice.locationId);
  if (options.attest !== false) data.set("syntheticAttestation", "on");
  return data;
}

function csvRow(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    "Claim number": "SYN-A-1",
    MRN: "SYN-901004",
    Payer: "Gulf Coast Mutual (synthetic)",
    "Service date": "2026-09-14",
    "Diagnosis codes": "E11.9",
    "Procedure code": "99213",
    Modifiers: "",
    Units: "1",
    Charge: "145.00",
    "Provider NPI": "",
    Location: "",
    ...overrides,
  };
  return CHARGE_FILE_HEADER.map((h) => base[h] ?? "").join(",");
}
const file = (...rows: string[]) => [CHARGE_FILE_HEADER.join(","), ...rows].join("\n");

async function eventsOf(practice: ChargeImportPractice, action: string) {
  return withTenant(practice, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.action, action)));
}

async function claimCount(practice: ChargeImportPractice): Promise<number> {
  return withTenant(practice, async (tx) => {
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(claims);
    return row!.n;
  });
}

const init = {};

/**
 * Runs `fn` with the clock fixed in the middle of a rate-limit window, so a ten-minute boundary can't fall
 * between the hits and the action (`hit()` reads `new Date()` for its fixed window). Only Date is faked.
 */
async function midWindow<T>(fn: () => Promise<T>): Promise<T> {
  const windowMs = limitFor("import_charges").windowSeconds * 1000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Math.floor(Date.now() / windowMs) * windowMs + windowMs / 2);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

describe("importCharges: success", () => {
  it("creates the claims and audits the import with the batch ID that names the claims", async () => {
    const practice = await signedIn();
    const state = await importCharges(init, form(practice, FIXTURE));
    expect(state).toMatchObject({ result: { claims: 3, lines: 4 } });
    expect(await claimCount(practice)).toBe(3);
    const [completed] = await eventsOf(practice, "claim.import_completed");
    expect(completed!.entityType).toBe("claim_import");
    expect(completed!.entityId).toMatch(UUID);
    const created = await withTenant(practice, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "claim.created"),
            sql`${auditEvents.metadata}->>'batchId' = ${completed!.entityId}`,
          ),
        ),
    );
    expect(created).toHaveLength(3);
    expect(await eventsOf(practice, "claim.import_rejected")).toHaveLength(0);
  });
});

describe("importCharges: every refusal is audited with a fixed reason, counts, and an attempt ID", () => {
  it("refuses compliance before reading anything", async () => {
    const practice = await signedIn("compliance");
    const state = await importCharges(init, form(practice, FIXTURE));
    expect(state.error).toBe("Your role can view claims but not import charges.");
    expect(await claimCount(practice)).toBe(0);
    const [event] = await eventsOf(practice, "claim.import_rejected");
    expect(event).toMatchObject({
      reason: "forbidden",
      entityType: "claim_import",
      actorUserId: practice.userId,
    });
    expect(event!.entityId).toMatch(UUID);
    expect(event!.metadata).toEqual({ rows: 0, problems: 0 });
  });

  it("refuses a missing synthetic attestation as an upload check", async () => {
    const practice = await signedIn();
    const state = await importCharges(init, form(practice, FIXTURE, { attest: false }));
    expect(state.error).toBe("Confirm that the file holds synthetic data only.");
    const [event] = await eventsOf(practice, "claim.import_rejected");
    expect(event).toMatchObject({ reason: "upload_check" });
    expect(event!.entityId).toMatch(UUID);
    expect(await claimCount(practice)).toBe(0);
  });

  it("refuses a file that isn't a .csv", async () => {
    const practice = await signedIn();
    const state = await importCharges(init, form(practice, FIXTURE, { name: "charges.xlsx" }));
    expect(state.error).toBe("The file must be a .csv file.");
    expect((await eventsOf(practice, "claim.import_rejected"))[0]).toMatchObject({ reason: "upload_check" });
  });

  it("reports row problems and audits the data-row and problem counts, never the values", async () => {
    const practice = await signedIn();
    const state = await importCharges(
      init,
      form(practice, file(csvRow(), csvRow({ "Claim number": "SYN-A-2", Units: "0", MRN: "SYN-SECRET-9" }))),
    );
    expect(state.error).toBe("Nothing was imported. Fix the rows below and upload the file again.");
    expect(state.totalProblems).toBe(1);
    expect(state.problems).toEqual([
      {
        row: 3,
        column: "Units",
        code: "units_invalid",
        message: "Units must be a whole number from 1 to 999.",
      },
    ]);
    const [event] = await eventsOf(practice, "claim.import_rejected");
    expect(event).toMatchObject({ reason: "validation" });
    expect(event!.metadata).toEqual({ rows: 2, problems: 1 });
    expect(JSON.stringify([event!.reason, event!.metadata])).not.toContain("SYN-SECRET");
    expect(await claimCount(practice)).toBe(0);
  });

  it("refuses the sample file pasted twice, names the repeats, and creates nothing", async () => {
    const practice = await signedIn();
    const [header, ...body] = FIXTURE.trim().split("\n");
    const state = await importCharges(init, form(practice, [header, ...body, ...body].join("\n")));
    const codes = new Set(state.problems?.map((p) => p.code));
    expect(codes.has("duplicate_line")).toBe(true);
    expect(codes.has("claim_rows_not_contiguous")).toBe(true);
    expect(state.result).toBeUndefined();
    expect(await claimCount(practice)).toBe(0);
    expect((await eventsOf(practice, "claim.import_rejected"))[0]).toMatchObject({ reason: "validation" });
  });

  it("refuses the whole file, header included, pasted twice", async () => {
    const practice = await signedIn();
    const state = await importCharges(init, form(practice, `${FIXTURE.trim()}\n${FIXTURE.trim()}`));
    expect(state.result).toBeUndefined();
    expect(await claimCount(practice)).toBe(0);
  });

  it("audits a re-upload of an imported file as a duplicate", async () => {
    const practice = await signedIn();
    expect((await importCharges(init, form(practice, FIXTURE))).result).toBeDefined();
    const again = await importCharges(init, form(practice, FIXTURE));
    expect(again.problems?.map((p) => p.code)).toEqual(["already_imported"]);
    const rejected = await eventsOf(practice, "claim.import_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: "duplicate" });
    expect(rejected[0]!.metadata).toEqual({ rows: 4, problems: 1 });
    expect(await claimCount(practice)).toBe(3);
  });

  it("turns a unique-index conflict into a plain message and audits it as a conflict", async () => {
    const practice = await signedIn();
    control.fail = new DatabaseError(
      "duplicate key value violates unique constraint",
      "23505",
      "claims_tenant_number_key",
    );
    const state = await importCharges(init, form(practice, file(csvRow())));
    expect(state.error).toBe(
      "A claim with one of these numbers was created while the file was being read. Nothing was imported; try again.",
    );
    const [event] = await eventsOf(practice, "claim.import_rejected");
    expect(event).toMatchObject({ reason: "conflict" });
    expect(event!.entityId).toMatch(UUID);
    expect(event!.metadata).toEqual({ rows: 1, problems: 0 });
    expect(await claimCount(practice)).toBe(0);
  });

  it("audits any other database failure with the fixed reason 'error', then lets it surface", async () => {
    const practice = await signedIn();
    control.fail = new DatabaseError("The database could not complete the request.", "XX000");
    await expect(importCharges(init, form(practice, file(csvRow())))).rejects.toThrow(DatabaseError);
    const [event] = await eventsOf(practice, "claim.import_rejected");
    expect(event).toMatchObject({ reason: "error", entityType: "claim_import" });
    expect(event!.entityId).toMatch(UUID);
    expect(event!.metadata).toEqual({ rows: 1, problems: 0 });
    // Counts and a fixed reason only: nothing of the file or the failure.
    expect(JSON.stringify([event!.reason, event!.metadata])).not.toMatch(/SYN-|99213|E11/);
    expect(await claimCount(practice)).toBe(0);
  });
});

describe("importCharges: rate limit (import_charges, per practice)", () => {
  it("refuses the eleventh attempt in ten minutes, audits it, and creates nothing", async () => {
    const practice = await signedIn();
    const state = await midWindow(async () => {
      for (let i = 0; i < 10; i++) await hit("import_charges", `practice:${practice.tenantId}`);
      return importCharges(init, form(practice, FIXTURE));
    });
    expect(state.error).toBe(
      "Too many imports in a short time for this practice. Wait a few minutes and try again.",
    );
    expect(state.result).toBeUndefined();
    expect(await claimCount(practice)).toBe(0);
    const [event] = await eventsOf(practice, "security.rate_limited");
    expect(event).toMatchObject({ reason: "import_charges", entityType: "claim_import" });
    expect(event!.entityId).toMatch(UUID);
    expect(event!.metadata).toEqual({ bucket: "import_charges" });
  });

  it("counts per practice: another practice is not limited by it", async () => {
    const limited = await signedIn();
    for (let i = 0; i < 10; i++) await hit("import_charges", `practice:${limited.tenantId}`);
    const other = await signedIn();
    expect((await importCharges(init, form(other, FIXTURE))).result).toBeDefined();
  });
});
