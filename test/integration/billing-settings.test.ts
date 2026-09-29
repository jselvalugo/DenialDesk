import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, locations, payers, providers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { generateClaim837P } from "@/domain/claims/edi-837p";
import {
  BillingSettingsError,
  getLocationBilling,
  getProviderBilling,
  listBillingTargets,
  updateLocationPlaceOfService,
  updateProviderBilling,
  type BillingActor,
  type ProviderBillingInput,
} from "@/domain/settings/billing";
import { decryptField } from "@/lib/crypto/field";
import { decryptProviderTin } from "@/lib/crypto/provider-tin";
import { createTestTenant } from "./helpers";
import { manualPatient, newClaim, type Billing, type Ctx } from "./claim-837p-fixtures";

// docs/specs/claims.md C3a-S: provider billing details and location place of service, against the real
// tables. No migration and no GRANT: the app role already holds UPDATE on `providers` and `locations`
// (drizzle/0002) and the CHECKs are migration 0046's. Synthetic values only.
// R-7.2.2 (step-up), R-7.2.4 (tenant isolation), R-7.3.3 (TIN encrypted), R-7.5.1 (audit, field names only).

type Role = "admin" | "manager" | "specialist" | "compliance";
let auth: { tenantId: string; userId: string; role: Role; mfaVerifiedAt?: Date | null };

vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "en" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const { saveLocationPlaceOfServiceAction, saveProviderBillingAction } =
  await import("@/app/(app)/settings/billing/actions");

const TIN_A = "009182736";
// Area 666 is never issued as an SSN, and differs from TIN_A.
const TIN_B = "666827364";
const VALUES: ProviderBillingInput = {
  firstName: "Avery",
  lastName: "Synthprovider",
  addressLine1: "100 Synthetic Way",
  city: "Tampa",
  state: "FL",
  postalCode: "336020001",
  tinType: "EI",
  tin: TIN_A,
};
// Every value the tests write, for the "no value in any audit row" checks.
const SENSITIVE = ["AVERY", "SYNTHPROVIDER", "100 SYNTHETIC WAY", "TAMPA", "336020001", TIN_A, TIN_B];

type Practice = Ctx & { providerId: string; locationId: string };
let a: Practice;
let b: Practice;

const actorOf = (p: Ctx, options: { role?: Role; recentMfa?: boolean } = {}): BillingActor => ({
  tenantId: p.tenantId,
  userId: p.userId,
  role: options.role ?? "admin",
  recentMfa: options.recentMfa ?? true,
  stepUpVerifiedAt: "2026-09-29T14:00:00.000Z",
});

/** A practice with one provider and one location that have no billing details yet (as onboarding leaves them). */
async function bareTargets(ctx: Ctx): Promise<Practice> {
  const [provider] = await systemDb()
    .insert(providers)
    .values({
      tenantId: ctx.tenantId,
      name: "Dr. Avery Synthprovider (synthetic)",
      npi: "1234567893",
      taxonomy: "207R00000X",
    })
    .returning({ id: providers.id });
  const [location] = await systemDb()
    .insert(locations)
    .values({ tenantId: ctx.tenantId, name: "Bayshore Clinic (synthetic)", city: "Tampa" })
    .returning({ id: locations.id });
  return { ...ctx, providerId: provider!.id, locationId: location!.id };
}

const save = (
  p: Practice,
  options: Parameters<typeof actorOf>[1],
  input: Partial<ProviderBillingInput> = {},
) =>
  withTenant(p, (tx) =>
    updateProviderBilling(tx, actorOf(p, options), p.providerId, { ...VALUES, ...input }),
  );

const row = async (id: string) => (await systemDb().select().from(providers).where(eq(providers.id, id)))[0]!;

async function events(p: Ctx, entityId: string) {
  return systemDb()
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, p.tenantId), eq(auditEvents.entityId, entityId)))
    .orderBy(auditEvents.id);
}

async function refusedWith(promise: Promise<unknown>, kind: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BillingSettingsError);
    expect((error as BillingSettingsError).kind).toBe(kind);
    return error as BillingSettingsError;
  }
  throw new Error(`expected a ${kind} refusal, but it succeeded`);
}

beforeAll(async () => {
  const ctxA = await createTestTenant("Billing A");
  const ctxB = await createTestTenant("Billing B");
  a = await bareTargets(ctxA);
  b = await bareTargets(ctxB);
});

afterAll(() => closeDatabase());

describe("who can change billing details (R-5.1.2, HC-3.2)", () => {
  it.each(["manager", "specialist", "compliance"] as const)(
    "refuses a %s everywhere, writing nothing",
    async (role) => {
      const p = await bareTargets(await createTestTenant("Billing roles"));
      const actor = actorOf(p, { role });
      await refusedWith(
        withTenant(p, (tx) => updateProviderBilling(tx, actor, p.providerId, VALUES)),
        "forbidden",
      );
      await refusedWith(
        withTenant(p, (tx) => updateLocationPlaceOfService(tx, actor, p.locationId, "11")),
        "forbidden",
      );
      await refusedWith(
        withTenant(p, (tx) => getProviderBilling(tx, actor, p.providerId)),
        "forbidden",
      );
      await refusedWith(
        withTenant(p, (tx) => listBillingTargets(tx, actor)),
        "forbidden",
      );
      expect((await row(p.providerId)).firstName).toBeNull();
      expect((await row(p.providerId)).tinEnc).toBeNull();
      expect(
        (await systemDb().select().from(locations).where(eq(locations.id, p.locationId)))[0]!.placeOfService,
      ).toBeNull();
      expect(await events(p, p.providerId)).toEqual([]);
      expect(await events(p, p.locationId)).toEqual([]);
    },
  );

  it("refuses the server actions for a non-admin session with the role message", async () => {
    auth = { tenantId: a.tenantId, userId: a.userId, role: "manager", mfaVerifiedAt: new Date() };
    const data = new FormData();
    data.set("id", a.providerId);
    expect(await saveProviderBillingAction({}, data)).toEqual({
      error: "Only administrators can change billing details.",
    });
    expect(await saveLocationPlaceOfServiceAction({}, data)).toEqual({
      error: "Only administrators can change billing details.",
    });
  });
});

describe("step-up MFA for a TIN (R-7.2.2, HC-4.2)", () => {
  it("refuses setting a TIN without a recent MFA, writing and auditing nothing", async () => {
    const p = await bareTargets(await createTestTenant("Billing stepup"));
    const error = await refusedWith(save(p, { recentMfa: false }), "step_up");
    expect(error.issues).toEqual([]);
    const stored = await row(p.providerId);
    expect(stored.tinEnc).toBeNull();
    expect(stored.firstName).toBeNull();
    expect(await events(p, p.providerId)).toEqual([]);
  });

  it("saves everything but the TIN without a step-up, and then asks for it only for the TIN", async () => {
    const p = await bareTargets(await createTestTenant("Billing stepup 2"));
    await save(p, { recentMfa: false }, { tin: "", tinType: "" });
    const stored = await row(p.providerId);
    expect(stored).toMatchObject({ firstName: "AVERY", city: "TAMPA", state: "FL", postalCode: "336020001" });
    expect(stored.tinEnc).toBeNull();
    await refusedWith(save(p, { recentMfa: false }), "step_up");
    await save(p, { recentMfa: true });
    expect((await row(p.providerId)).tinEnc).not.toBeNull();
  });

  it("also asks for it to change the type of a stored TIN, and to replace it", async () => {
    const p = await bareTargets(await createTestTenant("Billing stepup 3"));
    await save(p, { recentMfa: true });
    await refusedWith(save(p, { recentMfa: false }, { tin: "", tinType: "SY" }), "step_up");
    await refusedWith(save(p, { recentMfa: false }, { tin: TIN_B }), "step_up");
    expect((await row(p.providerId)).tinType).toBe("EI");
    expect(decryptProviderTin((await row(p.providerId)).tinEnc!, p.tenantId, p.providerId)).toBe(TIN_A);
    // The same TIN and type, sent blank, is not a TIN change.
    await save(p, { recentMfa: false }, { tin: "", city: "Miami" });
    expect((await row(p.providerId)).city).toBe("MIAMI");
  });

  it("takes the step-up from the session in the server action (four minutes old passes, six minutes, none, and a forged field do not)", async () => {
    const p = await bareTargets(await createTestTenant("Billing stepup 4"));
    const data = (fields: Record<string, string>) => {
      const form = new FormData();
      form.set("id", p.providerId);
      for (const [name, value] of Object.entries({ ...VALUES, ...fields })) form.set(name, value);
      return form;
    };
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    for (const mfaVerifiedAt of [minutesAgo(6), null, undefined]) {
      auth = { tenantId: p.tenantId, userId: p.userId, role: "admin", mfaVerifiedAt };
      const state = await saveProviderBillingAction({}, data({}));
      expect(state).toEqual({
        error: "Verify your identity again before changing the tax ID.",
        stepUpRequired: true,
      });
      // The request can't claim a verification.
      const forged = data({ recentMfa: "true", mfaVerifiedAt: new Date().toISOString() });
      expect(await saveProviderBillingAction({}, forged)).toMatchObject({ stepUpRequired: true });
    }
    expect((await row(p.providerId)).tinEnc).toBeNull();
    auth = { tenantId: p.tenantId, userId: p.userId, role: "admin", mfaVerifiedAt: minutesAgo(4) };
    await expect(saveProviderBillingAction({}, data({}))).rejects.toMatchObject({
      to: "/settings/billing?saved=provider",
    });
    expect((await row(p.providerId)).tinEnc).not.toBeNull();
  });
});

describe("the TIN is encrypted, bound to its provider, and write-only (R-7.3.3, HC-7.3)", () => {
  it("round-trips through the AAD binding and fails for any other provider or practice", async () => {
    await save(a, { recentMfa: true });
    const stored = await row(a.providerId);
    expect(stored.tinType).toBe("EI");
    expect(stored.tinEnc!.startsWith("v1.")).toBe(true);
    expect(stored.tinEnc).not.toContain(TIN_A);
    expect(decryptProviderTin(stored.tinEnc!, a.tenantId, a.providerId)).toBe(TIN_A);
    expect(() => decryptProviderTin(stored.tinEnc!, b.tenantId, a.providerId)).toThrow();
    expect(() => decryptProviderTin(stored.tinEnc!, a.tenantId, b.providerId)).toThrow();
    expect(() => decryptField(stored.tinEnc!)).toThrow();
  });

  it("uses a fresh ciphertext each time and accepts hyphens typed in the TIN", async () => {
    const before = (await row(a.providerId)).tinEnc;
    await save(a, { recentMfa: true }, { tin: "00-9182736" });
    const after = await row(a.providerId);
    expect(after.tinEnc).not.toBe(before);
    expect(decryptProviderTin(after.tinEnc!, a.tenantId, a.providerId)).toBe(TIN_A);
  });

  it("gives back only the last four digits, audits that read, and never the TIN", async () => {
    const view = await withTenant(a, (tx) => getProviderBilling(tx, actorOf(a), a.providerId));
    expect(view).toMatchObject({ tinType: "EI", tinLast4: "2736", firstName: "AVERY" });
    expect(JSON.stringify(view)).not.toContain(TIN_A);
    const viewed = (await events(a, a.providerId)).filter(
      (e) => e.action === "settings.provider_billing_viewed",
    );
    expect(viewed).toHaveLength(1);
    expect(viewed[0]).toMatchObject({
      actorUserId: a.userId,
      entityType: "provider",
      metadata: { phi: "tin_last4" },
    });
    // The list returns no TIN, only what is missing.
    const list = await withTenant(a, (tx) => listBillingTargets(tx, actorOf(a)));
    expect(JSON.stringify(list)).not.toContain(TIN_A);
    expect(list.providers[0]!.missing).toEqual([]);
  });

  it("lists a five-digit ZIP and an unreadable TIN as missing, by field, and audits the readability check", async () => {
    const p = await bareTargets(await createTestTenant("Billing list"));
    await save(p, { recentMfa: true }, { postalCode: "33602" });
    const listed = () => withTenant(p, (tx) => listBillingTargets(tx, actorOf(p)));
    expect((await listed()).providers[0]!.missing).toEqual(["postalCode"]);
    const other = await row(a.providerId);
    await systemDb().update(providers).set({ tinEnc: other.tinEnc }).where(eq(providers.id, p.providerId));
    expect((await listed()).providers[0]!.missing).toEqual(["postalCode", "tin"]);
    const checks = (await events(p, p.providerId)).filter(
      (e) => e.action === "settings.provider_billing_viewed",
    );
    expect(checks.at(-1)!.metadata).toEqual({ phi: "tin_readable_check", provider_count: 1 });
    // A bare provider has nothing to decrypt, so its list view writes no event.
    const bare = await bareTargets(await createTestTenant("Billing list bare"));
    const bareList = await withTenant(bare, (tx) => listBillingTargets(tx, actorOf(bare)));
    expect(bareList.providers[0]!.missing).toHaveLength(7);
    expect(await events(bare, bare.providerId)).toEqual([]);
  });

  it("treats typing the stored TIN again as no change: no write, no audit", async () => {
    const p = await bareTargets(await createTestTenant("Billing same tin"));
    await save(p, { recentMfa: true });
    const before = await row(p.providerId);
    const eventCount = (await events(p, p.providerId)).length;
    // Typing a TIN is still a TIN action, so it needs the step-up first.
    await refusedWith(save(p, { recentMfa: false }), "step_up");
    expect(await save(p, { recentMfa: true }, { tin: "009-18-2736" })).toEqual({ changed: [] });
    expect(await row(p.providerId)).toEqual(before);
    expect((await events(p, p.providerId)).length).toBe(eventCount);
  });

  it("says a stored TIN that fails to decrypt is unreadable, audits that, and still lets its type change or a new TIN replace it", async () => {
    const p = await bareTargets(await createTestTenant("Billing unreadable"));
    await save(p, { recentMfa: true });
    // A ciphertext copied from another provider fails its AAD check.
    const other = await row(a.providerId);
    await systemDb().update(providers).set({ tinEnc: other.tinEnc }).where(eq(providers.id, p.providerId));
    const view = await withTenant(p, (tx) => getProviderBilling(tx, actorOf(p), p.providerId));
    expect(view!.tinLast4).toBe("unreadable");
    const viewed = (await events(p, p.providerId)).filter(
      (e) => e.action === "settings.provider_billing_viewed",
    );
    expect(viewed.at(-1)!.metadata).toEqual({ phi: "tin_unreadable" });
    // The AAD doesn't include the type, so a type-only change sets the type and never decrypts.
    expect(await save(p, { recentMfa: true }, { tin: "", tinType: "SY" })).toEqual({ changed: ["tin_type"] });
    const afterType = await row(p.providerId);
    expect(afterType.tinType).toBe("SY");
    expect(afterType.tinEnc).toBe(other.tinEnc);
    await save(p, { recentMfa: true }, { tin: TIN_B, tinType: "SY" });
    expect(decryptProviderTin((await row(p.providerId)).tinEnc!, p.tenantId, p.providerId)).toBe(TIN_B);
  });

  it("keeps the ciphertext when only the type changes, and needs the step-up for it", async () => {
    const p = await bareTargets(await createTestTenant("Billing type only"));
    await save(p, { recentMfa: true });
    const before = await row(p.providerId);
    await refusedWith(save(p, { recentMfa: false }, { tin: "", tinType: "SY" }), "step_up");
    await save(p, { recentMfa: true }, { tin: "", tinType: "SY" });
    const after = await row(p.providerId);
    expect(after).toMatchObject({ tinType: "SY", tinEnc: before.tinEnc });
    expect(decryptProviderTin(after.tinEnc!, p.tenantId, p.providerId)).toBe(TIN_A);
  });

  it("shows a field error for a value over its bound, without the value", async () => {
    auth = { tenantId: a.tenantId, userId: a.userId, role: "admin", mfaVerifiedAt: new Date() };
    const form = new FormData();
    form.set("id", a.providerId);
    for (const [name, value] of Object.entries({ ...VALUES, firstName: "A".repeat(201) }))
      form.set(name, value);
    expect(await saveProviderBillingAction({}, form)).toEqual({
      error: "Fix the fields marked below and save again.",
      fieldErrors: { firstName: "Use at most 200 characters." },
    });
  });

  it("never puts the TIN in a form state, even for a refused save", async () => {
    auth = { tenantId: a.tenantId, userId: a.userId, role: "admin", mfaVerifiedAt: new Date() };
    const form = new FormData();
    form.set("id", a.providerId);
    for (const [name, value] of Object.entries({ ...VALUES, state: "F", tin: TIN_B })) form.set(name, value);
    const state = await saveProviderBillingAction({}, form);
    expect(state.fieldErrors).toEqual({ state: "Enter the two-letter state code." });
    expect(JSON.stringify(state)).not.toContain(TIN_B);
  });
});

describe("validation matches the database (migration 0046 CHECKs)", () => {
  it("refuses in the domain what the database would refuse, and writes nothing", async () => {
    const before = await row(a.providerId);
    const bad: Array<[Partial<ProviderBillingInput>, string]> = [
      [{ state: "fl1" }, "state"],
      [{ state: "F" }, "state"],
      [{ postalCode: "3360" }, "postalCode"],
      [{ postalCode: "336020" }, "postalCode"],
      [{ postalCode: "33602-000" }, "postalCode"],
      [{ tinType: "XX" }, "tinType"],
      [{ tin: "12345678" }, "tin"],
      [{ tin: "1234567890" }, "tin"],
      [{ tin: "12345678a" }, "tin"],
      [{ firstName: "" }, "firstName"],
      [{ city: "Tam*pa" }, "city"],
      [{ addressLine1: "PO Box 1" }, "addressLine1"],
    ];
    for (const [change, field] of bad) {
      const error = await refusedWith(save(a, { recentMfa: true }, change), "validation");
      expect(error.issues.map((i) => i.field)).toContain(field);
    }
    expect(await row(a.providerId)).toEqual(before);
  });

  it("accepts what the database accepts: five- and nine-digit ZIP, lower-case state, either type", async () => {
    const p = await bareTargets(await createTestTenant("Billing accepts"));
    await save(p, { recentMfa: true }, { postalCode: "33602", state: "fl", tinType: "SY", tin: TIN_B });
    expect(await row(p.providerId)).toMatchObject({ postalCode: "33602", state: "FL", tinType: "SY" });
    await save(p, { recentMfa: true }, { postalCode: "33602-0001" });
    expect((await row(p.providerId)).postalCode).toBe("336020001");
  });

  it("requires a TIN with a type, and a type with a TIN, and never clears a stored one", async () => {
    const p = await bareTargets(await createTestTenant("Billing pair"));
    const noType = await refusedWith(save(p, { recentMfa: true }, { tinType: "" }), "validation");
    expect(noType.issues).toEqual([{ field: "tinType", key: "billing.error.tinType" }]);
    const noTin = await refusedWith(save(p, { recentMfa: true }, { tin: "" }), "validation");
    expect(noTin.issues).toEqual([{ field: "tin", key: "billing.error.tinRequired" }]);
    await save(p, { recentMfa: true });
    const cleared = await refusedWith(save(p, { recentMfa: true }, { tin: "", tinType: "" }), "validation");
    expect(cleared.issues).toEqual([{ field: "tinType", key: "billing.error.tinType" }]);
    expect((await row(p.providerId)).tinEnc).not.toBeNull();
  });
});

describe("audit: field names only (R-7.5.1, HC-5.3)", () => {
  it("writes one event per change with column names, and no value, name, address, or TIN", async () => {
    const p = await bareTargets(await createTestTenant("Billing audit"));
    await save(p, { recentMfa: true });
    // Saves 2 and 3 send no TIN (blank), so only the city is a change, and the third changes nothing.
    await save(p, { recentMfa: true }, { city: "Miami", tin: "" });
    await save(p, { recentMfa: true }, { city: "Miami", tin: "" });
    // Sending the same TIN again is not a change either.
    await save(p, { recentMfa: true }, { city: "Miami" });
    await updateLocationPlaceOfService_(p, "11");
    const providerEvents = (await events(p, p.providerId)).filter(
      (e) => e.action === "settings.provider_billing_updated",
    );
    expect(providerEvents).toHaveLength(2);
    expect(providerEvents[0]).toMatchObject({
      actorUserId: p.userId,
      entityType: "provider",
      reason: "billing_settings",
      metadata: {
        fields: "first_name,last_name,address_line1,city,state,postal_code,tin,tin_type",
        tin_changed: true,
        step_up_verified_at: "2026-09-29T14:00:00.000Z",
      },
    });
    expect(providerEvents[1]!.metadata).toEqual({
      fields: "city",
      tin_changed: false,
      step_up_verified_at: null,
    });
    const all = [...(await events(p, p.providerId)), ...(await events(p, p.locationId))];
    const text = JSON.stringify(all).toUpperCase();
    for (const value of [...SENSITIVE, "MIAMI"]) expect(text).not.toContain(value.toUpperCase());
    // The POS code is checked against the metadata values only (an ID could contain "11").
    const metadataValues = all.flatMap((e) => Object.values(e.metadata ?? {}));
    expect(metadataValues).not.toContain("11");
    expect(all.filter((e) => e.action === "settings.location_pos_updated")).toHaveLength(1);
  });

  it("commits the change and its audit event together, so a failure leaves neither (HC-5.2)", async () => {
    const p = await bareTargets(await createTestTenant("Billing failclosed"));
    await expect(
      withTenant(p, async (tx) => {
        await updateProviderBilling(tx, actorOf(p), p.providerId, VALUES);
        throw new Error("audit write failed");
      }),
    ).rejects.toThrow("audit write failed");
    expect((await row(p.providerId)).firstName).toBeNull();
    expect(await events(p, p.providerId)).toEqual([]);
  });
});

function updateLocationPlaceOfService_(p: Practice, pos: string) {
  return withTenant(p, (tx) => updateLocationPlaceOfService(tx, actorOf(p), p.locationId, pos));
}

describe("place of service (format only, VERIFY against the CMS set)", () => {
  it("saves two digits, audits the field name, and writes nothing for the same value", async () => {
    const p = await bareTargets(await createTestTenant("Billing pos"));
    expect(await updateLocationPlaceOfService_(p, "11")).toEqual({ changed: ["place_of_service"] });
    expect(await updateLocationPlaceOfService_(p, "11")).toEqual({ changed: [] });
    const [location] = await systemDb().select().from(locations).where(eq(locations.id, p.locationId));
    expect(location!.placeOfService).toBe("11");
    const logged = await events(p, p.locationId);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      action: "settings.location_pos_updated",
      entityType: "location",
      metadata: { fields: "place_of_service" },
    });
  });

  it.each(["1", "111", "1a", "", " ", "1 1"])("refuses %j, as the database would", async (value) => {
    const p = await bareTargets(await createTestTenant("Billing pos bad"));
    const error = await refusedWith(updateLocationPlaceOfService_(p, value), "validation");
    expect(error.issues).toEqual([{ field: "placeOfService", key: "billing.error.pos" }]);
    expect(await events(p, p.locationId)).toEqual([]);
  });

  it("goes through the server action and sends the person back to the list", async () => {
    const p = await bareTargets(await createTestTenant("Billing pos action"));
    auth = { tenantId: p.tenantId, userId: p.userId, role: "admin", mfaVerifiedAt: null };
    const form = new FormData();
    form.set("id", p.locationId);
    form.set("placeOfService", "9");
    expect(await saveLocationPlaceOfServiceAction({}, form)).toEqual({
      error: "Fix the fields marked below and save again.",
      fieldErrors: { placeOfService: "Enter a two-digit code." },
    });
    form.set("placeOfService", "22");
    await expect(saveLocationPlaceOfServiceAction({}, form)).rejects.toMatchObject({
      to: "/settings/billing?saved=location",
    });
    form.set("id", "not-a-uuid");
    expect(await saveLocationPlaceOfServiceAction({}, form)).toEqual({ error: "That record was not found." });
  });
});

describe("tenant isolation (R-7.2.4)", () => {
  it("cannot read, change, or audit another practice's provider or location", async () => {
    const beforeProvider = await row(b.providerId);
    const [beforeLocation] = await systemDb().select().from(locations).where(eq(locations.id, b.locationId));
    const eventsBefore = (await events(b, b.providerId)).length;

    await refusedWith(
      withTenant(a, (tx) => updateProviderBilling(tx, actorOf(a), b.providerId, VALUES)),
      "not_found",
    );
    await refusedWith(
      withTenant(a, (tx) => updateLocationPlaceOfService(tx, actorOf(a), b.locationId, "11")),
      "not_found",
    );
    expect(await withTenant(a, (tx) => getProviderBilling(tx, actorOf(a), b.providerId))).toBeNull();
    expect(await withTenant(a, (tx) => getLocationBilling(tx, actorOf(a), b.locationId))).toBeNull();

    const listed = await withTenant(a, (tx) => listBillingTargets(tx, actorOf(a)));
    expect(listed.providers.map((r) => r.id)).toEqual([a.providerId]);
    expect(listed.locations.map((r) => r.id)).toEqual([a.locationId]);

    expect(await row(b.providerId)).toEqual(beforeProvider);
    expect((await systemDb().select().from(locations).where(eq(locations.id, b.locationId)))[0]).toEqual(
      beforeLocation,
    );
    expect(await events(a, b.providerId)).toEqual([]);
    expect(await events(a, b.locationId)).toEqual([]);
    expect((await events(b, b.providerId)).length).toBe(eventsBefore);
  });

  it("treats a malformed or unknown ID as not found", async () => {
    await refusedWith(
      withTenant(a, (tx) => updateProviderBilling(tx, actorOf(a), "not-a-uuid", VALUES)),
      "not_found",
    );
    await refusedWith(
      withTenant(a, (tx) => updateProviderBilling(tx, actorOf(a), randomUUID(), VALUES)),
      "not_found",
    );
  });
});

describe("end to end: a provider configured through this page lets the 837P service generate", () => {
  it("refuses billing_tin and missing_place_of_service before, and generates after, with the TIN in the file", async () => {
    const ctx = await createTestTenant("Billing e2e");
    const p = await bareTargets(ctx);
    const [payer] = await systemDb()
      .insert(payers)
      .values({
        tenantId: ctx.tenantId,
        name: "Gulf Coast Mutual (synthetic)",
        ediPayerId: "SYNTH01",
        regime: "fl_insurer",
      })
      .returning({ id: payers.id });
    const base: Billing = {
      providerId: p.providerId,
      locationId: p.locationId,
      payerId: payer!.id,
      patientId: await manualPatient(ctx, payer!.id, "SYN123456789"),
    };
    const claimId = await newClaim(ctx, base);
    const generate = () =>
      withTenant(ctx, (tx) =>
        generateClaim837P(tx, { ...ctx, role: "specialist" }, claimId, {
          now: new Date("2026-09-29T14:30:00Z"),
          today: "2026-09-29",
          pointers: {},
        }),
      );

    const before = await generate();
    expect(before.ok).toBe(false);
    if (before.ok) return;
    const refused = before.issues.map((i) => i.code);
    expect(refused).toEqual(
      expect.arrayContaining(["billing_name", "billing_address", "billing_tin", "missing_place_of_service"]),
    );

    // The administrator enters the details through the same functions the server actions call.
    auth = { tenantId: ctx.tenantId, userId: ctx.userId, role: "admin", mfaVerifiedAt: new Date() };
    const form = new FormData();
    form.set("id", p.providerId);
    for (const [name, value] of Object.entries(VALUES)) form.set(name, value);
    await expect(saveProviderBillingAction({}, form)).rejects.toMatchObject({
      to: "/settings/billing?saved=provider",
    });
    const pos = new FormData();
    pos.set("id", p.locationId);
    pos.set("placeOfService", "11");
    await expect(saveLocationPlaceOfServiceAction({}, pos)).rejects.toMatchObject({
      to: "/settings/billing?saved=location",
    });

    const after = await generate();
    if (!after.ok) throw new Error(`expected a file, got ${JSON.stringify(after)}`);
    expect(after.text).toContain(`REF*EI*${TIN_A}~`);
    expect(after.text).toContain("NM1*85*1*SYNTHPROVIDER*AVERY");
    expect(after.text).toContain("N3*100 SYNTHETIC WAY~");
    expect(after.text).toContain("N4*TAMPA*FL*336020001~");
    expect(after.text).toContain("CLM*");
    expect(after.text).toMatch(/\*11:B:1\*/);
  });
});
