import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, claims, patients, payers } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import {
  createPatient,
  getPatientChart,
  getPatientForEdit,
  listPatients,
  PatientRecordError,
  revealPatientMemberIdFor,
  searchPatients,
  searchPatientsAudited,
  updatePatient,
  PATIENT_LIST_FIELDS,
} from "@/domain/patients/queries";
import { patientSchema } from "@/domain/patients/record";
import { generateDataset } from "@/domain/synthetic/generator";
import { decryptField } from "@/lib/crypto/field";
import { expectDbError } from "./helpers";

// docs/specs/patients.md: registry, chart, tenant isolation (R-7.2.4), audit (R-7.5.1).
type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;
const today = todayIn();
const schema = patientSchema({ today, syntheticOnly: true });

async function practice(label: string, seed: number): Promise<Ctx> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Patients ${suffix} (synthetic)`,
    asOf: today,
    users: [{ email: `patients-${suffix}@synthetic.test`, displayName: `Patients ${label}`, role: "admin" }],
    dataset: generateDataset({ asOf: today, seed, patients: 5, claims: 12 }),
  });
  return { tenantId, userId: userIds[0]! };
}

const actor = (ctx: Ctx, canTag = true) => ({ ...ctx, canTag, syntheticOnly: true });

async function firstPayer(ctx: Ctx) {
  return withTenant(ctx, async (tx) => (await tx.select({ id: payers.id }).from(payers).limit(1))[0]!.id);
}

function input(overrides: Record<string, unknown> = {}) {
  return schema.parse({
    mrn: "",
    firstName: "Quinn",
    lastName: "Zephyrine",
    birthDate: "1990-06-15",
    sex: "U",
    addressLine1: "1 Synthetic Way",
    city: "Tampa",
    state: "FL",
    postalCode: "33606",
    phone: "8135550100",
    primaryPayerId: "",
    memberId: "",
    sensitivityTags: [],
    ...overrides,
  });
}

beforeAll(async () => {
  a = await practice("alpha", 41);
  b = await practice("beta", 42);
});

afterAll(() => closeDatabase());

describe("seeded patients", () => {
  it("have a primary payer from their claims and a Florida address", async () => {
    const rows = await withTenant(a, (tx) =>
      tx.select({ id: patients.id, payerId: patients.primaryPayerId, state: patients.state }).from(patients),
    );
    const withClaims = await withTenant(a, (tx) =>
      tx.selectDistinct({ patientId: claims.patientId }).from(claims),
    );
    const billed = new Set(withClaims.map((r) => r.patientId));
    for (const row of rows) {
      expect(row.state).toBe("FL");
      expect(row.payerId !== null).toBe(billed.has(row.id));
    }
  });
});

describe("registering a patient", () => {
  it("generates the next synthetic MRN, encrypts the member ID, and audits without values", async () => {
    const payerId = await firstPayer(a);
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a), input({ primaryPayerId: payerId, memberId: "SYN700000123" })),
    );
    const [row] = await withTenant(a, (tx) => tx.select().from(patients).where(eq(patients.id, id)));
    expect(row!.mrn).toMatch(/^SYN-\d{6}$/);
    expect(row!.memberIdEnc).not.toContain("SYN700000123");
    expect(decryptField(row!.memberIdEnc!)).toBe("SYN700000123");
    expect(row!.memberIdLast4).toBe("0123");
    const [event] = await withTenant(a, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "patient.created"), eq(auditEvents.entityId, id))),
    );
    expect(event).toBeDefined();
    expect(JSON.stringify(event!.metadata)).not.toMatch(/Quinn|Zephyrine|SYN700000123/);
  });

  it("assigns distinct MRNs to consecutive registrations", async () => {
    const first = await withTenant(a, (tx) => createPatient(tx, actor(a), input()));
    const second = await withTenant(a, (tx) => createPatient(tx, actor(a), input()));
    const mrns = await withTenant(a, (tx) =>
      tx
        .select({ mrn: patients.mrn })
        .from(patients)
        .where(sql`${patients.id} in (${first.id}, ${second.id})`),
    );
    expect(new Set(mrns.map((m) => m.mrn)).size).toBe(2);
  });

  it("refuses a duplicate MRN in the same practice but allows it in another", async () => {
    await withTenant(a, (tx) => createPatient(tx, actor(a), input({ mrn: "SYN-DUP-1" })));
    await expect(
      withTenant(a, (tx) => createPatient(tx, actor(a), input({ mrn: "SYN-DUP-1" }))),
    ).rejects.toThrow(PatientRecordError);
    await expect(
      withTenant(b, (tx) => createPatient(tx, actor(b), input({ mrn: "SYN-DUP-1" }))),
    ).resolves.toHaveProperty("id");
  });

  it("refuses another practice's payer (code check and tenant-scoped FK)", async () => {
    const foreignPayer = await firstPayer(b);
    await expect(
      withTenant(a, (tx) =>
        createPatient(tx, actor(a), input({ primaryPayerId: foreignPayer, memberId: "SYN1234" })),
      ),
    ).rejects.toThrow("Choose a payer from the list.");
    const [patient] = await withTenant(a, (tx) => tx.select({ id: patients.id }).from(patients).limit(1));
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(patients).set({ primaryPayerId: foreignPayer }).where(eq(patients.id, patient!.id)),
      ),
      /patients_primary_payer_fk/,
    );
  });

  it("requires a member ID when a payer is chosen", async () => {
    const payerId = await firstPayer(a);
    await expect(
      withTenant(a, (tx) => createPatient(tx, actor(a), input({ primaryPayerId: payerId }))),
    ).rejects.toThrow("Enter the member ID");
  });

  it("drops sensitivity tags from non-administrators", async () => {
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a, false), input({ sensitivityTags: ["hiv"] })),
    );
    const record = await withTenant(a, (tx) => getPatientForEdit(tx, id));
    expect(record!.sensitivityTags).toEqual([]);
  });

  it("rejects invalid values in the database too", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(patients).values({
          tenantId: a.tenantId,
          mrn: "SYN-CHK-1",
          firstName: "A",
          lastName: "B",
          birthDate: "1990-01-01",
          memberIdEnc: "x",
          memberIdLast4: "",
          state: "Florida",
        }),
      ),
      /patients_state_valid/,
    );
  });
});

describe("updating a patient", () => {
  it("saves changes, keeps the member ID when left blank, and audits field names with the reason", async () => {
    const payerId = await firstPayer(a);
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a), input({ primaryPayerId: payerId, memberId: "SYN7777" })),
    );
    const before = await withTenant(a, (tx) => getPatientForEdit(tx, id));
    const result = await withTenant(a, (tx) =>
      updatePatient(
        tx,
        actor(a),
        id,
        before!.updatedAt.toISOString(),
        input({ mrn: before!.mrn, city: "Orlando", primaryPayerId: payerId, sensitivityTags: ["sud"] }),
        "Patient moved; front desk update",
      ),
    );
    expect(result.changedFields).toEqual(["city", "sensitivityTags"]);
    const after = await withTenant(a, (tx) => tx.select().from(patients).where(eq(patients.id, id)));
    expect(after[0]!.city).toBe("Orlando");
    expect(decryptField(after[0]!.memberIdEnc!)).toBe("SYN7777");
    const [event] = await withTenant(a, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "patient.updated"), eq(auditEvents.entityId, id)))
        .orderBy(desc(auditEvents.id))
        .limit(1),
    );
    expect(event!.reason).toBe("Patient moved; front desk update");
    expect(event!.metadata).toEqual({ changedFields: "city,sensitivityTags" });
  });

  it("refuses another tenant's payer on save too (code check and tenant-scoped FK)", async () => {
    const payerId = await firstPayer(a);
    const foreignPayer = await firstPayer(b);
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a), input({ primaryPayerId: payerId, memberId: "SYN5551" })),
    );
    const record = await withTenant(a, (tx) => getPatientForEdit(tx, id));
    await expect(
      withTenant(a, (tx) =>
        updatePatient(
          tx,
          actor(a),
          id,
          record!.updatedAt.toISOString(),
          input({ mrn: record!.mrn, primaryPayerId: foreignPayer, memberId: "SYN5552" }),
          "Attempted cross-tenant payer",
        ),
      ),
    ).rejects.toThrow("Choose a payer from the list.");
    const unchanged = await withTenant(a, (tx) => tx.select().from(patients).where(eq(patients.id, id)));
    expect(unchanged[0]!.primaryPayerId).toBe(payerId);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(patients).set({ primaryPayerId: foreignPayer }).where(eq(patients.id, id)),
      ),
      /patients_primary_payer_fk/,
    );
  });

  it("requires a new member ID when the payer changes, and clears it for self-pay", async () => {
    const payerIds = await withTenant(a, async (tx) =>
      (await tx.select({ id: payers.id }).from(payers)).map((p) => p.id),
    );
    const [first, second] = payerIds as [string, string];
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a), input({ primaryPayerId: first, memberId: "SYN4444" })),
    );
    const record = await withTenant(a, (tx) => getPatientForEdit(tx, id));
    const stamp = record!.updatedAt.toISOString();
    await expect(
      withTenant(a, (tx) =>
        updatePatient(
          tx,
          actor(a),
          id,
          stamp,
          input({ mrn: record!.mrn, primaryPayerId: second }),
          "New plan",
        ),
      ),
    ).rejects.toThrow("Enter the member ID");
    const result = await withTenant(a, (tx) =>
      updatePatient(tx, actor(a), id, stamp, input({ mrn: record!.mrn }), "Now self-pay"),
    );
    expect(result.changedFields).toEqual(["primaryPayerId", "memberId"]);
    const after = await withTenant(a, (tx) => getPatientForEdit(tx, id));
    expect(after!.memberIdLast4).toBe("");
  });

  it("records sensitivity tag changes as their own audit event", async () => {
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a), input({ sensitivityTags: ["hiv"] })),
    );
    const record = await withTenant(a, (tx) => getPatientForEdit(tx, id));
    await withTenant(a, (tx) =>
      updatePatient(
        tx,
        actor(a),
        id,
        record!.updatedAt.toISOString(),
        input({ mrn: record!.mrn, sensitivityTags: ["sud"] }),
        "Tag review by administrator",
      ),
    );
    const [event] = await withTenant(a, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "patient.sensitivity_changed"), eq(auditEvents.entityId, id))),
    );
    expect(event!.metadata).toEqual({ added: "sud", removed: "hiv" });
  });

  it("rejects an edit from a stale page", async () => {
    const { id } = await withTenant(a, (tx) => createPatient(tx, actor(a), input()));
    const record = await withTenant(a, (tx) => getPatientForEdit(tx, id));
    const stamp = record!.updatedAt.toISOString();
    await withTenant(a, (tx) =>
      updatePatient(tx, actor(a), id, stamp, input({ mrn: record!.mrn, city: "Brandon" }), "First edit"),
    );
    await expect(
      withTenant(a, (tx) =>
        updatePatient(
          tx,
          actor(a),
          id,
          stamp,
          input({ mrn: record!.mrn, city: "Clearwater" }),
          "Second edit",
        ),
      ),
    ).rejects.toThrow("changed since you opened");
  });

  it("can't update another practice's patient", async () => {
    const { id } = await withTenant(b, (tx) => createPatient(tx, actor(b), input()));
    await expect(
      withTenant(a, (tx) =>
        updatePatient(tx, actor(a), id, new Date().toISOString(), input(), "Cross-tenant attempt"),
      ),
    ).rejects.toThrow("Patient not found.");
  });
});

describe("patient chart and search", () => {
  it("connects the patient to their claims and denials with totals", async () => {
    const [claim] = await withTenant(a, (tx) =>
      tx.select({ patientId: claims.patientId }).from(claims).limit(1),
    );
    const chart = await withTenant(a, (tx) => getPatientChart(tx, claim!.patientId));
    expect(chart!.claims.length).toBeGreaterThan(0);
    expect(chart!.totals.billedCents).toBe(chart!.claims.reduce((s, c) => s + c.billedCents, 0));
    for (const denial of chart!.denials) {
      expect(chart!.claims.map((c) => c.id)).toContain(denial.claimId);
    }
  });

  it("returns nothing for another practice's patient", async () => {
    const [foreign] = await withTenant(b, (tx) => tx.select({ id: patients.id }).from(patients).limit(1));
    expect(await withTenant(a, (tx) => getPatientChart(tx, foreign!.id))).toBeNull();
    expect(await withTenant(a, (tx) => getPatientForEdit(tx, foreign!.id))).toBeNull();
  });

  it("finds by last name, 'Last, First', and MRN, only within the practice", async () => {
    await withTenant(b, (tx) => createPatient(tx, actor(b), input({ lastName: "Xylophonist" })));
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a), input({ firstName: "Marlowe", lastName: "Xylophonist" })),
    );
    const record = await withTenant(a, (tx) => getPatientForEdit(tx, id));
    for (const term of ["xylo", "Xylophonist, Mar", "Marlowe Xylo", record!.mrn]) {
      const results = await withTenant(a, (tx) => searchPatients(tx, term));
      expect(results.map((r) => r.id)).toContain(id);
    }
    // Practice B's Xylophonist is invisible to practice A.
    const hits = await withTenant(a, (tx) => searchPatients(tx, "Xylophonist"));
    expect(hits.map((r) => r.id)).toEqual([id]);
  });

  it("treats LIKE wildcards literally", async () => {
    expect(await withTenant(a, (tx) => searchPatients(tx, "%%"))).toEqual([]);
  });

  it("lists patients alphabetically", async () => {
    const { rows, total } = await withTenant(a, (tx) => listPatients(tx, 1));
    expect(total).toBeGreaterThanOrEqual(rows.length);
    const names = rows.map((r) => `${r.lastName}\u0000${r.firstName}`);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base" })));
  });

  it("sorts by name descending when asked (P4)", async () => {
    const { rows } = await withTenant(a, (tx) => listPatients(tx, 1, "name", "desc"));
    const names = rows.map((r) => `${r.lastName}\u0000${r.firstName}`);
    expect(names).toEqual([...names].sort((x, y) => y.localeCompare(x, "en", { sensitivity: "base" })));
  });

  it("keeps the pre-P4 default tie-break (MRN, then id) when two patients share a name (P4 review)", async () => {
    // A lastName that sorts before any realistic synthetic surname, so both land at the very top of
    // page 1 regardless of how many other patients this tenant has accumulated.
    const lastName = "Aaaaaaaaaa";
    const { lowerId, higherId } = await withTenant(a, async (tx) => {
      const higher = await createPatient(
        tx,
        actor(a),
        input({ lastName, firstName: "Zed", mrn: "SYN-TIE-B" }),
      );
      const lower = await createPatient(
        tx,
        actor(a),
        input({ lastName, firstName: "Zed", mrn: "SYN-TIE-A" }),
      );
      return { lowerId: lower.id, higherId: higher.id };
    });
    const { rows } = await withTenant(a, (tx) => listPatients(tx, 1));
    expect(rows[0]?.id).toBe(lowerId);
    expect(rows[1]?.id).toBe(higherId);
  });

  it("finds by 'Last,' with a blank first name", async () => {
    const { id } = await withTenant(a, (tx) => createPatient(tx, actor(a), input({ lastName: "Wolfsbane" })));
    for (const term of ["Wolfsbane,", "Wolfsbane, "]) {
      const results = await withTenant(a, (tx) => searchPatients(tx, term));
      expect(results.map((r) => r.id)).toEqual([id]);
    }
  });
});

describe("generated MRNs", () => {
  it("skip past hand-entered MRNs that sort above the numbered ones", async () => {
    const c = await practice("gamma", 43);
    for (let i = 0; i < 21; i++) {
      await withTenant(c, (tx) => createPatient(tx, actor(c), input({ mrn: `SYN-Z${i}` })));
    }
    const { id } = await withTenant(c, (tx) => createPatient(tx, actor(c), input()));
    const record = await withTenant(c, (tx) => getPatientForEdit(tx, id));
    // The seeded practice has SYN-001000…SYN-001004.
    expect(record!.mrn).toBe("SYN-001005");
  });
});

describe("audited reads", () => {
  it("search audits result IDs and count, never the terms", async () => {
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a), input({ lastName: "Umbrafield" })),
    );
    const results = await withTenant(a, (tx) => searchPatientsAudited(tx, a, "Umbrafield"));
    expect(results.map((r) => r.id)).toEqual([id]);
    const [event] = await withTenant(a, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "patient.searched"))
        .orderBy(desc(auditEvents.id))
        .limit(1),
    );
    expect(event!.metadata).toEqual({ patientIds: id, count: 1, fields: PATIENT_LIST_FIELDS });
    expect(JSON.stringify(event)).not.toContain("Umbrafield");
  });

  it("reveal decrypts, audits the reason, and stays inside the practice", async () => {
    const payerId = await firstPayer(a);
    const { id } = await withTenant(a, (tx) =>
      createPatient(tx, actor(a), input({ primaryPayerId: payerId, memberId: "SYN9990001" })),
    );
    expect(await withTenant(a, (tx) => revealPatientMemberIdFor(tx, a, id, "eligibility"))).toEqual({
      value: "SYN9990001",
    });
    const [event] = await withTenant(a, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "patient.member_id_revealed"), eq(auditEvents.entityId, id))),
    );
    expect(event!.reason).toBe("eligibility");
    expect(await withTenant(b, (tx) => revealPatientMemberIdFor(tx, b, id, "other"))).toEqual({
      error: "Not found.",
    });
  });
});
