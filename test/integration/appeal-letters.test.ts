import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import {
  appealLetterAttestations,
  appealLetterTemplates,
  appealLetterVersions,
  appeals,
  auditEvents,
  claims,
  denials,
  patients,
} from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { getAppeal, APPEAL_ACTIVITY_ACTIONS } from "@/domain/appeals/queries";
import { getLetterState, getTemplateBody, listTemplateStatus } from "@/domain/appeals/letter/queries";
import { starterTemplate } from "@/domain/appeals/letter/starter-templates";
import {
  attestLetter,
  prepareExport,
  recordExportRoleRefused,
  saveLetterVersion,
  saveTemplate,
} from "@/domain/appeals/letter/service";
import { generateDataset } from "@/domain/synthetic/generator";

// Synthetic data only. Docs: docs/specs/appeals.md "Acceptance criteria (A2)".
const today = todayIn();
const MARKER = "SYNTHETIC-LETTER-MARKER-7431";
const GOOD_BODY = `Re claim {{claim.number}} for {{patient.fullName}}, member {{patient.memberIdMasked}}, payer {{payer.name}}. ${MARKER}`;
let ctx: { tenantId: string; userId: string };

beforeAll(async () => {
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Appeal letters test ${Date.now()} (synthetic)`,
    asOf: today,
    users: [
      { email: `letters-${Date.now()}@synthetic.test`, displayName: "Letters Tester", role: "specialist" },
    ],
    dataset: generateDataset({ asOf: today, seed: 43, patients: 12, claims: 40 }),
  });
  ctx = { tenantId, userId: userIds[0]! };
});

afterAll(() => closeDatabase());

async function newAppeal(): Promise<string> {
  return withTenant(ctx, async (tx) => {
    // Only patients with no sensitivity tag, label or restriction: the fail-closed test marks some patients
    // sensitive, and letters for those are refused by design.
    const [denial] = await tx
      .select({ id: denials.id, claimId: denials.claimId })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .where(
        and(
          sql`cardinality(${patients.sensitivityTags}) = 0`,
          sql`cardinality(${patients.sourceSensitivity}) = 0`,
          eq(patients.sourceRestricted, false),
        ),
      )
      .orderBy(sql`random()`)
      .limit(1);
    const [inserted] = await tx
      .insert(appeals)
      .values({
        tenantId: ctx.tenantId,
        denialId: denial!.id,
        claimId: denial!.claimId,
        level: "first_level",
        filedBy: ctx.userId,
      })
      .returning({ id: appeals.id });
    return inserted!.id;
  });
}

/** Renames the appeal's patient (a synthetic record change after review). */
async function renamePatient(appealId: string, lastName: string) {
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ patientId: claims.patientId })
      .from(appeals)
      .innerJoin(claims, eq(claims.id, appeals.claimId))
      .where(eq(appeals.id, appealId));
    await tx.update(patients).set({ lastName }).where(eq(patients.id, row!.patientId));
  });
}

const save = (appealId: string, body: string, baseVersion: number) =>
  withTenant(ctx, (tx) => saveLetterVersion(tx, ctx, { appealId, body, baseVersion }));
const attest = (appealId: string, version: number) =>
  withTenant(ctx, (tx) => attestLetter(tx, ctx, { appealId, version }));
const exportLetter = (appealId: string) => withTenant(ctx, (tx) => prepareExport(tx, ctx, appealId));

describe("letter versions (append-only history)", () => {
  it("stores each save as the next version, with who and when, and keeps the tokens", async () => {
    const appealId = await newAppeal();
    expect(await save(appealId, GOOD_BODY, 0)).toEqual({ ok: true, version: 1 });
    expect(await save(appealId, `${GOOD_BODY} edited`, 1)).toEqual({ ok: true, version: 2 });

    const state = await withTenant(ctx, (tx) => getLetterState(tx, appealId));
    expect(state.history.map((h) => h.version)).toEqual([2, 1]);
    expect(state.history[0]!.author).toBe("Letters Tester");
    expect(state.latest?.body).toBe(`${GOOD_BODY} edited`);
    // The stored body holds merge tokens, never resolved patient values.
    expect(state.latest?.body).toContain("{{patient.fullName}}");
  });

  it("refuses a stale edit, an unchanged save, and unknown or malformed merge fields", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    expect(await save(appealId, `${GOOD_BODY} again`, 0)).toMatchObject({ errorKey: "letter.error.stale" });
    expect(await save(appealId, GOOD_BODY, 1)).toMatchObject({ errorKey: "letter.error.unchanged" });
    expect(await save(appealId, "Hello {{patient.ssn}}", 1)).toMatchObject({
      errorKey: "letter.error.unknownField",
      params: { names: "patient.ssn" },
    });
    expect(await save(appealId, "Hello {{claim.number", 1)).toMatchObject({
      errorKey: "letter.error.malformed",
    });
    expect(await save(appealId, "   ", 1)).toMatchObject({ errorKey: "letter.error.empty" });
    const state = await withTenant(ctx, (tx) => getLetterState(tx, appealId));
    expect(state.history).toHaveLength(1);
  });

  it("refuses an unknown appeal", async () => {
    const result = await save("00000000-0000-4000-8000-000000000000", GOOD_BODY, 0);
    expect(result).toMatchObject({ errorKey: "error.notFound" });
  });

  it("locks the letter once the appeal is submitted", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    await withTenant(ctx, (tx) =>
      tx
        .update(appeals)
        .set({ status: "submitted", submittedMethod: "portal", submittedOn: today })
        .where(eq(appeals.id, appealId)),
    );
    expect(await save(appealId, `${GOOD_BODY} late`, 1)).toMatchObject({ errorKey: "letter.error.locked" });
  });

  it("after submission the letter can still be re-reviewed: data changes refuse export until re-attested", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    expect(await attest(appealId, 1)).toEqual({ ok: true });
    await withTenant(ctx, (tx) =>
      tx
        .update(appeals)
        .set({ status: "submitted", submittedMethod: "portal", submittedOn: today })
        .where(eq(appeals.id, appealId)),
    );
    expect((await exportLetter(appealId)).ok).toBe(true);

    await renamePatient(appealId, "Changed");
    expect(await exportLetter(appealId)).toEqual({ ok: false, reason: "changed_since_review" });
    // Same rendering as the old attestation would be refused as a duplicate; this one is new, so it is allowed.
    expect(await attest(appealId, 1)).toEqual({ ok: true });
    const again = await exportLetter(appealId);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.text).toContain("Changed");
    // The history keeps both attestations, and saving is still locked.
    const rows = await withTenant(ctx, (tx) =>
      tx.select().from(appealLetterAttestations).where(eq(appealLetterAttestations.appealId, appealId)),
    );
    expect(rows).toHaveLength(2);
    expect(await save(appealId, `${GOOD_BODY} late`, 1)).toMatchObject({ errorKey: "letter.error.locked" });
  });

  it("the app role cannot rewrite or delete history", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    await expect(
      withTenant(ctx, (tx) =>
        tx
          .update(appealLetterVersions)
          .set({ body: "tampered" })
          .where(eq(appealLetterVersions.appealId, appealId)),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(ctx, (tx) =>
        tx.delete(appealLetterVersions).where(eq(appealLetterVersions.appealId, appealId)),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("human review (R-7.11.2) and the export gate", () => {
  it("refuses export with no letter and with no attestation, and audits each refusal", async () => {
    const appealId = await newAppeal();
    expect(await exportLetter(appealId)).toEqual({ ok: false, reason: "no_letter" });
    await save(appealId, GOOD_BODY, 0);
    expect(await exportLetter(appealId)).toEqual({ ok: false, reason: "not_attested" });

    const refusals = await withTenant(ctx, (tx) =>
      tx
        .select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(eq(auditEvents.entityId, appealId), eq(auditEvents.action, "appeal.letter_export_refused")),
        ),
    );
    expect(refusals.map((r) => r.metadata)).toEqual(
      expect.arrayContaining([{ reason: "no_letter" }, { reason: "not_attested", version: 1 }]),
    );
  });

  it("exports the rendered letter only after the named user attests the current version", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    expect(await attest(appealId, 1)).toEqual({ ok: true });

    const result = await exportLetter(appealId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toBe(1);
    expect(result.attestedBy).toBe("Letters Tester");
    // Values were merged in; the member ID is masked to its last four.
    expect(result.text).not.toContain("{{");
    expect(result.text).toContain(MARKER);
    expect(result.text).toMatch(/member \*{4}\d{4},/);

    const [claim] = await withTenant(ctx, (tx) =>
      tx
        .select({ claimNumber: claims.claimNumber })
        .from(appeals)
        .innerJoin(claims, eq(claims.id, appeals.claimId))
        .where(eq(appeals.id, appealId)),
    );
    expect(result.text).toContain(`Re claim ${claim!.claimNumber} for `);
  });

  it("a new version needs its own attestation", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    await attest(appealId, 1);
    await save(appealId, `${GOOD_BODY} v2`, 1);
    expect(await exportLetter(appealId)).toEqual({ ok: false, reason: "not_attested" });
    // Only the latest version can be attested.
    expect(await attest(appealId, 1)).toMatchObject({ errorKey: "letter.error.stale" });
    expect(await attest(appealId, 2)).toEqual({ ok: true });
    expect((await exportLetter(appealId)).ok).toBe(true);
  });

  it("refuses to attest twice, with nothing saved, or with a placeholder left in", async () => {
    const appealId = await newAppeal();
    expect(await attest(appealId, 1)).toMatchObject({ errorKey: "letter.error.noLetter" });
    await save(appealId, `${GOOD_BODY} [⚠️ VERIFY: cite the policy]`, 0);
    expect(await attest(appealId, 1)).toMatchObject({ errorKey: "letter.error.unresolvedPlaceholder" });
    await save(appealId, `${GOOD_BODY} [FILL IN: documents]`, 1);
    expect(await attest(appealId, 2)).toMatchObject({ errorKey: "letter.error.unresolvedPlaceholder" });
    await save(appealId, GOOD_BODY, 2);
    expect(await attest(appealId, 3)).toEqual({ ok: true });
    expect(await attest(appealId, 3)).toMatchObject({ errorKey: "letter.error.alreadyAttested" });
  });

  it("the starter templates cannot be attested until the placeholders are replaced", async () => {
    const appealId = await newAppeal();
    await save(appealId, starterTemplate("medical_necessity"), 0);
    expect(await attest(appealId, 1)).toMatchObject({ errorKey: "letter.error.unresolvedPlaceholder" });
  });

  it("refuses export when the claim or patient data changed after the review", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    await attest(appealId, 1);
    expect((await exportLetter(appealId)).ok).toBe(true);

    await withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ patientId: claims.patientId })
        .from(appeals)
        .innerJoin(claims, eq(claims.id, appeals.claimId))
        .where(eq(appeals.id, appealId));
      await tx.update(patients).set({ lastName: "Renamed" }).where(eq(patients.id, row!.patientId));
    });
    expect(await exportLetter(appealId)).toEqual({ ok: false, reason: "changed_since_review" });
  });

  it("the attestation records the user and a SHA-256 digest, and cannot be rewritten", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    await attest(appealId, 1);
    const [row] = await withTenant(ctx, (tx) =>
      tx.select().from(appealLetterAttestations).where(eq(appealLetterAttestations.appealId, appealId)),
    );
    expect(row).toMatchObject({ version: 1, attestedBy: ctx.userId, tenantId: ctx.tenantId });
    expect(row!.renderedSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      withTenant(ctx, (tx) =>
        tx
          .update(appealLetterAttestations)
          .set({ attestedBy: ctx.userId })
          .where(eq(appealLetterAttestations.appealId, appealId)),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("audit trail holds IDs only, never letter content", () => {
  it("records save, attest, and export without the body or any field value", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    await attest(appealId, 1);
    await exportLetter(appealId);

    const rows = await withTenant(ctx, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.entityId, appealId)),
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(["appeal.letter_saved", "appeal.letter_attested", "appeal.letter_exported"]),
    );
    for (const row of rows.filter((r) => r.action.startsWith("appeal.letter_"))) {
      expect(row.actorUserId).toBe(ctx.userId);
      expect(row.metadata).toEqual(
        row.action === "appeal.letter_exported"
          ? { version: 1, attestationId: expect.stringMatching(/^[0-9a-f-]{36}$/) }
          : { version: 1 },
      );
      expect(JSON.stringify(row)).not.toContain(MARKER);
    }
  });
});

describe("templates", () => {
  it("falls back to the starter, then uses the practice's own template, and audits without content", async () => {
    const before = await withTenant(ctx, (tx) => getTemplateBody(tx, "eligibility"));
    expect(before).toEqual({ body: starterTemplate("eligibility"), source: "starter" });

    const body = `Our own wording for {{payer.name}}. ${MARKER}`;
    const created = await withTenant(ctx, (tx) => saveTemplate(tx, ctx, { category: "eligibility", body }));
    expect(created).toEqual({ ok: true, created: true });
    const updated = await withTenant(ctx, (tx) =>
      saveTemplate(tx, ctx, { category: "eligibility", body: `${body} v2` }),
    );
    expect(updated).toEqual({ ok: true, created: false });

    const after = await withTenant(ctx, (tx) => getTemplateBody(tx, "eligibility"));
    expect(after).toEqual({ body: `${body} v2`, source: "practice" });
    const status = await withTenant(ctx, (tx) => listTemplateStatus(tx));
    expect(status.find((s) => s.category === "eligibility")?.source).toBe("practice");
    expect(status.find((s) => s.category === "duplicate")?.source).toBe("starter");
    expect(status).toHaveLength(11);

    const rows = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(inArray(auditEvents.action, ["appeal.template_created", "appeal.template_updated"])),
    );
    expect(rows.map((r) => r.action).sort()).toEqual(["appeal.template_created", "appeal.template_updated"]);
    for (const row of rows) {
      expect(row.entityType).toBe("appeal_letter_template");
      expect(row.metadata).toEqual({ category: "eligibility" });
      expect(JSON.stringify(row)).not.toContain(MARKER);
    }
    const stored = await withTenant(ctx, (tx) => tx.select().from(appealLetterTemplates));
    expect(stored.filter((t) => t.category === "eligibility")).toHaveLength(1);
  });

  it("refuses an unknown merge field at save", async () => {
    const result = await withTenant(ctx, (tx) =>
      saveTemplate(tx, ctx, { category: "coding", body: "Hello {{patient.mbi}}" }),
    );
    expect(result).toMatchObject({ errorKey: "letter.error.unknownField", params: { names: "patient.mbi" } });
    const status = await withTenant(ctx, (tx) => listTemplateStatus(tx));
    expect(status.find((s) => s.category === "coding")?.source).toBe("starter");
  });
});

describe("attestation and export refusals are audited with fixed reason codes", () => {
  async function refusals(appealId: string, action: string) {
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select({ metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(eq(auditEvents.entityId, appealId), eq(auditEvents.action, action as "appeal.letter_saved")),
        ),
    );
    return rows.map((r) => r.metadata);
  }

  it("refuses a letter whose fields have no value on file", async () => {
    const appealId = await newAppeal();
    // Every synthetic claim has a payer name, so blank the rendered value with a literal marker instead.
    await save(appealId, `${GOOD_BODY} [not on file]`, 0);
    expect(await attest(appealId, 1)).toMatchObject({ errorKey: "letter.error.missingValues" });
    expect(await refusals(appealId, "appeal.letter_attest_refused")).toEqual([
      { reason: "missing_values", version: 1 },
    ]);
  });

  it("audits the placeholder, stale, and no-letter refusals", async () => {
    const appealId = await newAppeal();
    await attest(appealId, 1);
    await save(appealId, `${GOOD_BODY} [FILL IN: x]`, 0);
    await attest(appealId, 1);
    await attest(appealId, 5);
    const reasons = (await refusals(appealId, "appeal.letter_attest_refused")).map(
      (m) => (m as { reason: string }).reason,
    );
    expect(reasons.sort()).toEqual(["no_letter", "stale", "unresolved_placeholder"]);
  });

  it("fails closed for a patient with a sensitivity tag", async () => {
    // Source labels and restrictions can only be set on EHR-synced patients (patients_manual_defaults), so the
    // integration path uses a practice tag; isSensitivePatient's unit tests cover the other two signals.
    for (const change of [{ sensitivityTags: ["hiv"] }]) {
      const appealId = await newAppeal();
      await save(appealId, GOOD_BODY, 0);
      expect(await attest(appealId, 1)).toEqual({ ok: true });
      expect((await exportLetter(appealId)).ok).toBe(true);

      await withTenant(ctx, async (tx) => {
        const [row] = await tx
          .select({ patientId: claims.patientId })
          .from(appeals)
          .innerJoin(claims, eq(claims.id, appeals.claimId))
          .where(eq(appeals.id, appealId));
        await tx.update(patients).set(change).where(eq(patients.id, row!.patientId));
      });
      // Export is refused even though it was attested; a new attestation is refused too.
      expect(await exportLetter(appealId)).toEqual({ ok: false, reason: "sensitive_patient" });
      expect(await attest(appealId, 1)).toMatchObject({ errorKey: "letter.error.sensitivePatient" });
      expect(await refusals(appealId, "appeal.letter_export_refused")).toContainEqual({
        reason: "sensitive_patient",
        version: 1,
      });
      expect(await refusals(appealId, "appeal.letter_attest_refused")).toContainEqual({
        reason: "sensitive_patient",
        version: 1,
      });
    }
  });

  it("audits a role refusal", async () => {
    const appealId = await newAppeal();
    await withTenant(ctx, (tx) => recordExportRoleRefused(tx, ctx, appealId));
    expect(await refusals(appealId, "appeal.letter_export_refused")).toEqual([{ reason: "role" }]);
  });
});

describe("template create race", () => {
  it("two creators at once end as one row, one create and one update", async () => {
    const results = await Promise.all([
      withTenant(ctx, (tx) =>
        saveTemplate(tx, ctx, { category: "bundling", body: "First {{claim.number}}" }),
      ),
      withTenant(ctx, (tx) =>
        saveTemplate(tx, ctx, { category: "bundling", body: "Second {{claim.number}}" }),
      ),
    ]);
    expect(results.every((r) => "ok" in r && r.ok)).toBe(true);
    expect(results.filter((r) => "created" in r && r.created)).toHaveLength(1);
    const rows = await withTenant(ctx, (tx) =>
      tx.select().from(appealLetterTemplates).where(eq(appealLetterTemplates.category, "bundling")),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("activity list", () => {
  it("shows only actions that have a label, not views or refusals", async () => {
    const appealId = await newAppeal();
    await save(appealId, GOOD_BODY, 0);
    await exportLetter(appealId); // refused: audited but not listed
    const detail = await withTenant(ctx, (tx) => getAppeal(tx, appealId));
    const actions = detail!.activity.map((a) => a.action);
    expect(actions).toContain("appeal.letter_saved");
    expect(actions.every((a) => APPEAL_ACTIVITY_ACTIONS.includes(a))).toBe(true);
  });
});
