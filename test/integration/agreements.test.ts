import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import { ensureDemoPractice } from "@/auth/demo";
import type { OperatorContext } from "@/auth/operator";
import { setUpOperatorAccount } from "@/auth/operator-account";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, tenantAgreements, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  agreementDatesByTenant,
  listAgreements,
  openAgreementFile,
  recordAgreement as recordWithOptions,
  type AgreementInput,
} from "@/domain/platform/agreements";
import { createPractice, listPractices, PracticeError } from "@/domain/platform/practices";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/practice-agreements.md. Synthetic PDF bytes only; never a real agreement.
const pdf = (label: string) => Buffer.from(`%PDF-1.7\n% synthetic ${label}\n%%EOF\n`, "latin1");

let operator: OperatorContext;
let practice: { tenantId: string; userId: string };

// Real-environment rules by default; the synthetic-only guard has its own test.
const recordAgreement = (
  agreement: AgreementInput,
  by: OperatorContext,
  options: { syntheticOnly: boolean } = { syntheticOnly: false },
) => recordWithOptions(agreement, by, options);

/** The input's column values (drops the attestation flag, which isn't stored). */
function columnsOf({ attestedSynthetic, ...columns }: AgreementInput) {
  void attestedSynthetic;
  return columns;
}

const input = (tenantId: string, overrides: Partial<AgreementInput> = {}): AgreementInput => ({
  tenantId,
  effectiveDate: "2026-09-01",
  expiresOn: "2027-08-31",
  signedOn: "2026-08-28",
  practiceSigner: "Synthetic Signer, Practice Administrator",
  ourSigner: "Synthetic Officer, DenialDesk",
  templateVersion: "BAA-2026.1",
  note: null,
  filename: "synthetic-baa.pdf",
  content: pdf("one"),
  attestedSynthetic: false,
  ...overrides,
});

beforeAll(async () => {
  const email = `operator-agreements-${Date.now()}@synthetic.test`;
  const { userId } = await setUpOperatorAccount({ email, password: "a synthetic operator passphrase" });
  operator = { sessionId: "00000000-0000-4000-8000-000000000000", userId, displayName: "Operator", email };
  practice = await createTestTenant("Agreements");
});

afterAll(() => closeDatabase());

describe("recordAgreement", () => {
  it("stores the signed copy with its hash as the active agreement, audited", async () => {
    const { tenantId } = await createTestTenant("BAA first");
    const { agreementId, supersededId } = await recordAgreement(input(tenantId), operator);
    expect(supersededId).toBeNull();

    const [row] = await systemDb()
      .select()
      .from(tenantAgreements)
      .where(eq(tenantAgreements.id, agreementId));
    expect(row).toMatchObject({
      tenantId,
      kind: "baa",
      status: "active",
      contentType: "application/pdf",
      sizeBytes: pdf("one").length,
      sha256: createHash("sha256").update(pdf("one")).digest("hex"),
      recordedBy: operator.userId,
      supersededById: null,
    });
    expect(Buffer.from(row!.content).equals(pdf("one"))).toBe(true);

    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, "operator.agreement_recorded"), eq(auditEvents.entityId, agreementId)),
      );
    expect(event).toMatchObject({ actorUserId: operator.userId, tenantId, entityType: "tenant_agreement" });
    expect(event!.metadata).toEqual({
      supersededId: null,
      templateVersion: "BAA-2026.1",
      sizeBytes: pdf("one").length,
    });
  });

  it("a renewal supersedes the active agreement and keeps it on file", async () => {
    const { tenantId } = await createTestTenant("BAA renewal");
    const first = await recordAgreement(input(tenantId), operator);
    const nextYear = addCalendarDays(todayIn(), 365);
    const second = await recordAgreement(
      input(tenantId, { effectiveDate: nextYear, expiresOn: null, signedOn: todayIn(), content: pdf("two") }),
      operator,
    );
    expect(second.supersededId).toBe(first.agreementId);

    const rows = await listAgreements(tenantId);
    expect(rows.map((r) => [r.id, r.status, r.supersededById])).toEqual([
      [second.agreementId, "active", null],
      [first.agreementId, "superseded", second.agreementId],
    ]);
    expect(rows[0]).not.toHaveProperty("content");
    expect((await agreementDatesByTenant()).get(tenantId)).toEqual([
      { status: "active", effectiveDate: nextYear, expiresOn: null },
      { status: "superseded", effectiveDate: "2026-09-01", expiresOn: "2027-08-31" },
    ]);

    // The renewal starts next year and the superseded agreement still covers today, so the
    // practice reads as active (the boundaries and the gap warning are unit-tested).
    const practices = await listPractices(operator);
    expect(practices.find((p) => p.id === tenantId)?.baa).toBe("active");
  });

  it("rejects bad dates, non-PDF content, and practices that can't hold a BAA", async () => {
    const { tenantId } = practice;
    await expect(recordAgreement(input(tenantId, { expiresOn: "2026-08-31" }), operator)).rejects.toThrow(
      /expiration date/,
    );
    await expect(recordAgreement(input(tenantId, { signedOn: "2999-01-01" }), operator)).rejects.toThrow(
      /future/,
    );
    await expect(
      recordAgreement(input(tenantId, { content: Buffer.from("not a pdf") }), operator),
    ).rejects.toBeInstanceOf(PracticeError);
    await expect(recordAgreement(input("00000000-0000-4000-8000-00000000dead"), operator)).rejects.toThrow(
      /no longer exists/,
    );
    const demo = await ensureDemoPractice();
    await expect(recordAgreement(input(demo.tenantId), operator)).rejects.toThrow(/customer practice/);
    expect(await listAgreements(tenantId)).toEqual([]);
  });

  it("accepts an agreement that expires on its effective date and one signed today", async () => {
    const { tenantId } = await createTestTenant("BAA one-day");
    const today = todayIn();
    const { agreementId } = await recordAgreement(
      input(tenantId, { effectiveDate: today, expiresOn: today, signedOn: today }),
      operator,
    );
    expect((await listAgreements(tenantId))[0]?.id).toBe(agreementId);
  });

  it("in a synthetic-only environment takes only attested SYN- files (ADR 0003)", async () => {
    const { tenantId } = await createTestTenant("BAA synthetic guard");
    const syntheticOnly = { syntheticOnly: true };
    await expect(
      recordAgreement(input(tenantId, { attestedSynthetic: true }), operator, syntheticOnly),
    ).rejects.toThrow(/SYN-/);
    await expect(
      recordAgreement(
        input(tenantId, { filename: "SYN-baa.pdf", attestedSynthetic: false }),
        operator,
        syntheticOnly,
      ),
    ).rejects.toThrow(/Confirm/);
    const { agreementId } = await recordAgreement(
      input(tenantId, { filename: "SYN-baa.pdf", attestedSynthetic: true }),
      operator,
      syntheticOnly,
    );
    expect((await listAgreements(tenantId))[0]?.id).toBe(agreementId);
  });

  it("two recordings racing for one practice: one wins, the other gets a plain message with no file bytes", async () => {
    const { tenantId } = await createTestTenant("BAA race");
    const results = await Promise.allSettled([
      recordAgreement(
        input(tenantId, { content: pdf("racer A"), practiceSigner: "Synthetic Racer A" }),
        operator,
      ),
      recordAgreement(
        input(tenantId, { content: pdf("racer B"), practiceSigner: "Synthetic Racer B" }),
        operator,
      ),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = (rejected[0] as PromiseRejectedResult).reason as Error;
    expect(error).toBeInstanceOf(PracticeError);
    expect(error.message).toMatch(/just recorded/);
    expect(error.message).not.toMatch(/Racer|%PDF/);
    expect(await listAgreements(tenantId)).toHaveLength(1);
  });

  it("records the audit event in the same transaction as the agreement", async () => {
    const { tenantId } = await createTestTenant("BAA audit");
    const { agreementId } = await recordAgreement(input(tenantId), operator);
    const [event] = await systemDb()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, "operator.agreement_recorded"), eq(auditEvents.entityId, agreementId)),
      );
    expect(event).toBeDefined();
  });

  it("only customer practices carry a BAA status on the practices list", async () => {
    const { tenantId } = await createPractice(
      {
        name: "Synthetic No-BAA Clinic",
        adminName: "Synthetic Admin",
        adminEmail: `nobaa-${Date.now()}@synthetic.test`,
      },
      operator,
    );
    const practices = await listPractices(operator);
    expect(practices.find((p) => p.id === tenantId)?.baa).toBe("missing");
    expect(practices.find((p) => p.kind === "demo")?.baa).toBeNull();
  });
});

describe("openAgreementFile", () => {
  it("returns the signed copy for its own practice only, and audits the download", async () => {
    const { tenantId } = await createTestTenant("BAA download");
    const { agreementId } = await recordAgreement(input(tenantId, { content: pdf("download") }), operator);
    const file = await openAgreementFile(tenantId, agreementId, operator);
    expect(file).toMatchObject({ tenantId, filename: "synthetic-baa.pdf", contentType: "application/pdf" });
    expect(file!.content.equals(pdf("download"))).toBe(true);
    expect(await openAgreementFile(practice.tenantId, agreementId, operator)).toBeNull();
    const events = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, "operator.agreement_downloaded"), eq(auditEvents.entityId, agreementId)),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: operator.userId,
      tenantId,
      entityType: "tenant_agreement",
    });
  });
});

describe("database guarantees", () => {
  it("the app role has no access to agreements, even inside the practice's own tenant context", async () => {
    const { tenantId, userId } = await createTestTenant("BAA isolation");
    await recordAgreement(input(tenantId), operator);
    await expectDbError(
      withTenant({ tenantId, userId }, (tx) => tx.select({ id: tenantAgreements.id }).from(tenantAgreements)),
      /permission denied/,
    );
    await expectDbError(
      withTenant({ tenantId, userId }, (tx) =>
        tx.update(tenantAgreements).set({ note: "x" }).where(eq(tenantAgreements.tenantId, tenantId)),
      ),
      /permission denied/,
    );
  });

  it("recorded fields are immutable and rows can't be deleted", async () => {
    const { tenantId } = await createTestTenant("BAA immutable");
    const { agreementId } = await recordAgreement(input(tenantId), operator);
    const where = eq(tenantAgreements.id, agreementId);
    await expectDbError(
      systemDb().update(tenantAgreements).set({ note: "edited" }).where(where),
      /immutable/,
    );
    await expectDbError(
      systemDb()
        .update(tenantAgreements)
        .set({ content: pdf("swapped"), sizeBytes: pdf("swapped").length })
        .where(where),
      /immutable/,
    );
    await expectDbError(systemDb().delete(tenantAgreements).where(where), /never deleted/);
    await expectDbError(systemDb().execute(sql`truncate tenant_agreements`), /never deleted/);
    // A superseded agreement is frozen entirely, and a practice can't have two active ones.
    const renewal = await recordAgreement(input(tenantId, { content: pdf("renewal") }), operator);
    await expectDbError(
      systemDb().update(tenantAgreements).set({ status: "active", supersededById: null }).where(where),
      /superseded agreement cannot change/,
    );
    await expectDbError(
      systemDb()
        .insert(tenantAgreements)
        .values({
          ...columnsOf(input(tenantId)),
          kind: "baa",
          status: "active",
          contentType: "application/pdf",
          sizeBytes: 3,
          sha256: "x",
          content: Buffer.from("%PD"),
          recordedBy: operator.userId,
        }),
      /tenant_agreements_one_active/,
    );
    expect(renewal.supersededId).toBe(agreementId);
    const [tenant] = await systemDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    expect(tenant).toBeDefined();
  });
});
