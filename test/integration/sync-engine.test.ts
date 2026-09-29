import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { claims, integrationConnections, patients, payers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { pauseConnection } from "@/domain/integrations/connections";
import { INTEGRATION_SERVICE_PRINCIPAL_ID } from "@/domain/integrations/principal";
import { isSyncStoredCode } from "@/domain/integrations/sync-codes";
import { executeSyncRun } from "@/domain/integrations/sync";
import { decryptField, encryptField } from "@/lib/crypto/field";
import { TransportError } from "@/integrations/fhir/errors";
import {
  SANDBOX_FIXTURES,
  SANDBOX_PATIENT_COUNT,
  SANDBOX_SKIPPED_FIXTURES,
  sandboxMemberId,
  sandboxMrn,
  sandboxPatientId,
} from "@/integrations/fhir/sandbox/dataset";
import type { TransportResponse } from "@/integrations/fhir/transport";
import {
  activeSandbox,
  adminActor,
  auditRows,
  connectionRow,
  harness,
  issueRows,
  mappingRows,
  patientRows,
  queueRun,
  runRow,
  runSync,
  stampOf,
  type Ctx,
  type Harness,
} from "../support/sandbox-sync";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI2b: the sync run against the built-in synthetic sandbox, end to
// end, in a real PostgreSQL: the run's own transaction context (`withTenantAsSystem`), the read-only
// trigger, page-by-page commits, the watermark, retries, the guards, the audit trail. Synthetic only.

const EXPECTED_STORED = SANDBOX_PATIENT_COUNT - SANDBOX_SKIPPED_FIXTURES.length;
const status = (code: number, retryAfterSeconds?: number): TransportResponse => ({
  status: code,
  contentType: "text/html",
  body: "",
  ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
});
const path = (init: { url: URL }) => new URL(init.url).pathname;

let ctx: Ctx;
beforeEach(async () => {
  ctx = await createTestTenant("Sync engine");
});
afterAll(() => closeDatabase());

async function byExternalId(n: number) {
  return (await patientRows(ctx)).find((row) => row.externalId === sandboxPatientId(n));
}

async function pauseFromInside(id: string) {
  await withTenant(ctx, async (tx) => pauseConnection(tx, adminActor(ctx), id, await stampOf(ctx, id)));
}

describe("a full sandbox sync", () => {
  it("stores the whole synthetic population, skips only what a required rule refuses, and records the run", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const { runId, result } = await runSync(ctx, id, h);

    expect(result).toMatchObject({
      status: "succeeded",
      created: EXPECTED_STORED,
      updated: 0,
      linked: 0,
      unchanged: 0,
      skipped: 2,
    });
    const rows = await patientRows(ctx);
    expect(rows).toHaveLength(EXPECTED_STORED);
    for (const row of rows) {
      expect(row).toMatchObject({ source: "fhir", sourceConnectionId: id, sensitivityTags: [], phone: null });
      expect(row.mrn.startsWith("SYN-")).toBe(true);
      expect(row.syncedAt).not.toBeNull();
      expect(row.state).toBe("FL");
    }

    // The two required-rule failures are skipped with codes, and nothing is guessed.
    expect(await byExternalId(SANDBOX_FIXTURES.partialBirthDate)).toBeUndefined();
    expect(await byExternalId(SANDBOX_FIXTURES.ssnShapedMrn)).toBeUndefined();
    const issues = await issueRows(runId);
    expect(issues.map((issue) => issue.code).sort()).toEqual([
      "birthdate_incomplete",
      "mrn_looks_like_ssn",
      "review_required",
    ]);
    const minor = await byExternalId(SANDBOX_FIXTURES.minor);
    expect(issues.find((issue) => issue.code === "review_required")!.patientId).toBe(minor!.id);
    // The suggested minor tag is never set by the sync.
    expect(minor!.sensitivityTags).toEqual([]);

    // Source status and labels.
    expect((await byExternalId(SANDBOX_FIXTURES.inactive))!.sourceStatus).toBe("inactive");
    expect((await byExternalId(SANDBOX_FIXTURES.replacedBy))!.sourceStatus).toBe("merged");
    expect(await byExternalId(SANDBOX_FIXTURES.restrictedLabel)).toMatchObject({
      sourceRestricted: true,
      sourceSensitivity: ["R"],
    });
    expect(await byExternalId(SANDBOX_FIXTURES.hivLabel)).toMatchObject({
      sourceRestricted: true,
      sourceSensitivity: ["HIV"],
    });
    expect(await byExternalId(SANDBOX_FIXTURES.unknownLabel)).toMatchObject({
      sourceRestricted: true,
      sourceSensitivity: ["unknown"],
    });
    expect(await byExternalId(1)).toMatchObject({ sourceRestricted: false, sourceSensitivity: [] });

    // Coverage: a usable coverage is `unmapped` (no payer is ever guessed), and its member ID is
    // field-encrypted; review outcomes carry neither payer nor member ID.
    const first = (await byExternalId(1))!;
    expect(first).toMatchObject({
      coverageStatus: "unmapped",
      coveragePayorKey: "Organization/syn-org-1",
      primaryPayerId: null,
      memberIdLast4: "0001",
    });
    expect(first.memberIdEnc!.startsWith("v1.")).toBe(true);
    expect(first.memberIdEnc).not.toContain("SYN");
    expect(decryptField(first.memberIdEnc!)).toBe(sandboxMemberId(1));
    for (const n of [SANDBOX_FIXTURES.dependentCoverage, SANDBOX_FIXTURES.nonOrganizationPayor]) {
      expect(await byExternalId(n)).toMatchObject({
        coverageStatus: "needs_review",
        coveragePayorKey: null,
        primaryPayerId: null,
        memberIdEnc: null,
        memberIdLast4: null,
      });
    }
    expect(await byExternalId(SANDBOX_FIXTURES.noCoverage)).toMatchObject({
      coverageStatus: "none",
      memberIdEnc: null,
    });
    expect(await byExternalId(SANDBOX_FIXTURES.unmappedPayor)).toMatchObject({
      coverageStatus: "unmapped",
      coveragePayorKey: "Organization/syn-org-9",
    });
    const secondary = (await byExternalId(SANDBOX_FIXTURES.secondaryCoverage))!;
    expect(decryptField(secondary.memberIdEnc!)).toBe(sandboxMemberId(SANDBOX_FIXTURES.secondaryCoverage));

    // The payor keys it met are recorded for the payer-mapping page, unmapped, by the service principal.
    const mappings = await mappingRows(id);
    expect(mappings.map((row) => row.payorKey)).toEqual([
      "Organization/syn-org-1",
      "Organization/syn-org-2",
      "Organization/syn-org-3",
      "Organization/syn-org-9",
    ]);
    for (const mapping of mappings) {
      expect(mapping).toMatchObject({ payerId: null, updatedBy: INTEGRATION_SERVICE_PRINCIPAL_ID });
      expect(mapping.payorName).toMatch(/^Synthetic /);
    }

    // The run row.
    const run = await runRow(runId);
    expect(run).toMatchObject({
      status: "succeeded",
      createdCount: EXPECTED_STORED,
      updatedCount: 0,
      linkedCount: 0,
      skippedCount: 2,
      httpStatus: null,
      issueCodes: ["birthdate_incomplete", "mrn_looks_like_ssn", "review_required"],
    });
    expect(run.startedAt).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    expect(run.heartbeatAt).not.toBeNull();
    for (const code of run.issueCodes) expect(isSyncStoredCode(code)).toBe(true);

    // The connection: locked to its endpoint, the watermark is the first page's server time minus five
    // minutes, and the last success is stamped.
    const connection = await connectionRow(id);
    expect(connection).toMatchObject({
      status: "active",
      hasSynced: true,
      updatedBy: INTEGRATION_SERVICE_PRINCIPAL_ID,
    });
    expect(connection.patientWatermark).toEqual(new Date(h.clock.current.getTime() - 5 * 60_000));
    expect(run.patientWatermark).toEqual(connection.patientWatermark);
    expect(connection.lastSuccessAt).not.toBeNull();
  });

  it("requests what the spec says: a _count=1 probe first, then pages of 100 by same-origin next, Coverage by POST with no ids in a URL", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    h.transport.requests.length = 0;
    await runSync(ctx, id, h);

    const searches = h.transport.to("Patient");
    expect(searches.map((request) => new URL(request.url).searchParams.get("_count"))).toEqual([
      "1",
      "100",
      "100",
    ]);
    expect(searches.map((request) => new URL(request.url).searchParams.get("_offset"))).toEqual([
      null,
      null,
      "100",
    ]);
    // The initial load has no watermark to filter by.
    expect(searches.every((request) => !new URL(request.url).searchParams.has("_lastUpdated"))).toBe(true);
    const coverage = h.transport.to("Coverage/_search");
    expect(coverage).toHaveLength(4);
    expect(coverage.every((request) => request.method === "POST")).toBe(true);
    expect(h.transport.requests.every((request) => !request.url.href.includes("syn-pat-"))).toBe(true);
    expect(h.transport.to("Coverage")).toHaveLength(0);
    // Every FHIR request carries the bearer token in the Authorization header, and only there.
    for (const request of [...searches, ...coverage]) {
      expect(request.headers?.authorization).toMatch(/^Bearer sandbox-token-/);
      expect(request.url.href).not.toContain("sandbox-token");
    }
  });

  it("audits every patient write as the service principal, reason ehr_sync, with IDs only", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const { runId } = await runSync(ctx, id, h);
    const events = await auditRows(ctx.tenantId);
    const created = events.filter((event) => event.action === "patient.synced_created");
    expect(created).toHaveLength(EXPECTED_STORED);
    const ids = new Set((await patientRows(ctx)).map((row) => row.id));
    for (const event of created) {
      expect(event).toMatchObject({
        actorUserId: INTEGRATION_SERVICE_PRINCIPAL_ID,
        tenantId: ctx.tenantId,
        entityType: "patient",
        reason: "ehr_sync",
        ipAddress: null,
        userAgent: null,
      });
      expect(ids.has(event.entityId!)).toBe(true);
      expect(event.metadata).toMatchObject({
        connection_id: id,
        run_id: runId,
        triggered_by: ctx.userId,
      });
      expect(event.metadata!.runtime_function).toEqual(expect.any(String));
      expect(event.metadata!.runtime_host).toEqual(expect.any(String));
    }
    // No MRN, member ID, name, external id, or address in any sync audit row.
    const sample = (await patientRows(ctx))[0]!;
    const text = JSON.stringify(
      events.filter(
        (event) => event.action.startsWith("patient.") || event.action.startsWith("integration.sync"),
      ),
    );
    for (const secret of ["SYN-", "syn-pat", sample.firstName, sample.lastName, "Palm Way", "555-01"]) {
      expect(text).not.toContain(secret);
    }
    // Run-level records: started once, completed once, with the receipt of everything unchanged or skipped.
    const started = events.filter((event) => event.action === "integration.sync_started");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      actorUserId: INTEGRATION_SERVICE_PRINCIPAL_ID,
      entityId: id,
      reason: "ehr_sync",
    });
    const completed = events.filter((event) => event.action === "integration.sync_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.metadata).toMatchObject({
      run_id: runId,
      created: EXPECTED_STORED,
      updated: 0,
      linked: 0,
      unchanged: 0,
      skipped: 2,
      conflicts: 0,
    });
  });

  it("never writes claims or claim versions, and never stores what isn't in the billing minimum", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await runSync(ctx, id, h);
    const claimRows = await systemDb()
      .select({ id: claims.id })
      .from(claims)
      .where(eq(claims.tenantId, ctx.tenantId));
    expect(claimRows).toEqual([]);
    const versions = await systemDb().execute<{ n: string }>(
      sql`select count(*) as n from claim_versions where tenant_id = ${ctx.tenantId}::uuid`,
    );
    expect(versions.rows[0]!.n).toBe("0");
    // The sandbox sends telecom and marital status on every patient; nothing of them is stored.
    const dump = JSON.stringify(await patientRows(ctx));
    expect(dump).not.toContain("555-01");
    expect(dump).not.toContain('Synthetic"');
  });

  it("writes no resource content, token, identifier, URL path, or ZodError to any log", async () => {
    const writes: string[] = [];
    const capture = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as never;
    const out = vi.spyOn(process.stdout, "write").mockImplementation(capture);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(capture);
    try {
      const h = harness();
      const id = await activeSandbox(ctx, h);
      // A conflict and a failing page too, so the error paths log as well.
      await systemDb()
        .insert(patients)
        .values({
          tenantId: ctx.tenantId,
          mrn: sandboxMrn(21),
          firstName: "Manual",
          lastName: "Conflict",
          birthDate: "1900-02-02",
          memberIdEnc: encryptField("X"),
          memberIdLast4: "X",
        });
      await runSync(ctx, id, h);
      h.dataset.patch(
        sandboxPatientId(70),
        (resource) => {
          (resource.identifier as { value: string }[])[0]!.value = "PLAIN-70";
        },
        new Date(h.clock.current.getTime()),
      );
      await runSync(ctx, id, h);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    const logs = writes.join("");
    for (const forbidden of [
      "SYN-",
      "syn-pat",
      "sandbox-token",
      "Bearer",
      "ZodError",
      "sandbox.fhir",
      "PLAIN-70",
      "Palm Way",
      "Manual",
    ]) {
      expect(logs, forbidden).not.toContain(forbidden);
    }
    // What is logged is IDs, counts, and codes.
    expect(logs).toContain("integration.sync_finished");
  });
});

describe("the watermark", () => {
  it("advances only on success, trailing the first page's server time by five minutes, and never regresses", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const first = await runSync(ctx, id, h);
    const afterFirst = (await connectionRow(id)).patientWatermark!;
    expect(afterFirst).toEqual(new Date(h.clock.current.getTime() - 5 * 60_000));

    // Ten minutes later a run with nothing new: the watermark moves forward with the server's clock.
    h.clock.current = new Date(h.clock.current.getTime() + 10 * 60_000);
    const second = await runSync(ctx, id, h);
    expect(second.result).toMatchObject({ status: "succeeded", created: 0, updated: 0 });
    const afterSecond = (await connectionRow(id)).patientWatermark!;
    expect(afterSecond).toEqual(new Date(h.clock.current.getTime() - 5 * 60_000));
    expect(afterSecond.getTime()).toBeGreaterThan(afterFirst.getTime());
    // The second run's search filtered by the first run's watermark: `ge<watermark>`.
    const requests = h.transport
      .to("Patient")
      .filter((request) => new URL(request.url).searchParams.has("_lastUpdated"));
    expect(new URL(requests[0]!.url).searchParams.get("_lastUpdated")).toBe(`ge${afterFirst.toISOString()}`);
    expect((await runRow(second.runId)).patientWatermark).toEqual(afterSecond);
    expect((await runRow(first.runId)).patientWatermark).toEqual(afterFirst);

    // A run that fails leaves the watermark, and the last success, where they were.
    const lastSuccess = (await connectionRow(id)).lastSuccessAt;
    h.clock.current = new Date(h.clock.current.getTime() + 10 * 60_000);
    h.transport.intercept = async (init, next) => (path(init).endsWith("/Patient") ? status(500) : next());
    const failed = await runSync(ctx, id, h);
    expect(failed.result).toMatchObject({ status: "failed", failure: "unreachable" });
    const afterFailure = await connectionRow(id);
    expect(afterFailure.patientWatermark).toEqual(afterSecond);
    expect(afterFailure.lastSuccessAt).toEqual(lastSuccess);
    expect((await runRow(failed.runId)).patientWatermark).toBeNull();

    // A clock that runs backwards can't move it backwards.
    h.transport.intercept = undefined;
    h.clock.current = new Date(h.clock.current.getTime() - 3 * 60 * 60_000);
    await runSync(ctx, id, h);
    expect((await connectionRow(id)).patientWatermark).toEqual(afterSecond);
  });

  it.each([
    ["two minutes ahead (inside the skew allowance)", 2 * 60_000],
    ["an hour ahead (clamped to our own clock)", 60 * 60_000],
  ])("never runs ahead of our own clock when the server's time is %s", async (_name, aheadMs) => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    h.transport.intercept = async (init, next) => {
      const response = await next();
      if (!path(init).endsWith("/Patient")) return response;
      const body = JSON.parse(response.body) as { meta: { lastUpdated: string } };
      body.meta.lastUpdated = new Date(h.clock.current.getTime() + aheadMs).toISOString();
      return { ...response, body: JSON.stringify(body) };
    };
    await runSync(ctx, id, h);
    const watermark = (await connectionRow(id)).patientWatermark!;
    expect(watermark).toEqual(new Date(h.clock.current.getTime() - 5 * 60_000));
  });

  it("re-fetches only what changed since, and applies an EHR edit as an update with the changed column named", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await runSync(ctx, id, h);
    const before = (await byExternalId(30))!;
    h.clock.current = new Date(h.clock.current.getTime() + 60_000);
    h.dataset.patch(
      sandboxPatientId(30),
      (resource) => {
        resource.gender = before.sex === "M" ? "female" : "male";
      },
      h.clock.current,
    );
    const second = await runSync(ctx, id, h);
    expect(second.result).toMatchObject({
      status: "succeeded",
      created: 0,
      updated: 1,
      unchanged: 0,
      skipped: 0,
    });
    const after = (await byExternalId(30))!;
    expect(after.sex).not.toBe(before.sex);
    expect(after.sourceVersionId).toBe("2");
    expect(after.id).toBe(before.id);
    const updates = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "patient.synced_updated",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]!.metadata).toMatchObject({ changed_fields: "sex", run_id: second.runId });
    expect(updates[0]!.entityId).toBe(before.id);
  });
});

describe("upsert, no regression, and matching", () => {
  it("a full re-read changes nothing: same content is unchanged, an older copy never overwrites a newer one", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await runSync(ctx, id, h);
    const before = await patientRows(ctx);
    const auditsBefore = (await auditRows(ctx.tenantId)).length;
    // Force a full re-read: no watermark. Patient 40 comes back as an older copy with a different value.
    await withTenant(ctx, (tx) =>
      tx.execute(sql`update integration_connections set patient_watermark = null where id = ${id}::uuid`),
    );
    const stored = before.find((row) => row.externalId === sandboxPatientId(40))!;
    h.dataset.patch(
      sandboxPatientId(40),
      (resource) => {
        resource.gender = stored.sex === "M" ? "female" : "male";
      },
      new Date(stored.sourceLastUpdated!.getTime() - 24 * 60 * 60_000),
    );
    const second = await runSync(ctx, id, h);
    expect(second.result).toMatchObject({
      status: "succeeded",
      created: 0,
      updated: 0,
      unchanged: EXPECTED_STORED,
      skipped: 2,
    });
    expect(await patientRows(ctx)).toEqual(before);
    // No patient write, so no patient audit event: only the run's own started and completed records.
    const events = (await auditRows(ctx.tenantId)).slice(auditsBefore);
    expect(events.map((event) => event.action)).toEqual([
      "integration.sync_started",
      "integration.sync_completed",
    ]);
    expect(events[1]!.metadata).toMatchObject({ unchanged: EXPECTED_STORED, updated: 0 });
  });

  it("links a manual patient with the same MRN and birth date, keeping what the practice owns", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const source = h.dataset.patient(sandboxPatientId(20))!;
    const [manual] = await systemDb()
      .insert(patients)
      .values({
        tenantId: ctx.tenantId,
        mrn: sandboxMrn(20),
        firstName: "Old",
        lastName: "Manual",
        birthDate: source.resource.birthDate as string,
        memberIdEnc: encryptField("OLD-MEMBER"),
        memberIdLast4: "MBER",
        sensitivityTags: ["minor"],
        phone: "555-0199",
      })
      .returning();
    const { runId, result } = await runSync(ctx, id, h);
    expect(result).toMatchObject({ status: "succeeded", linked: 1, created: EXPECTED_STORED - 1 });
    const linked = (await patientRows(ctx)).find((row) => row.id === manual!.id)!;
    expect(linked).toMatchObject({
      source: "fhir",
      sourceConnectionId: id,
      externalId: sandboxPatientId(20),
      sensitivityTags: ["minor"],
      phone: "555-0199",
    });
    expect(linked.firstName).not.toBe("Old");
    expect(decryptField(linked.memberIdEnc!)).toBe(sandboxMemberId(20));
    const events = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "patient.linked_to_source",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityId: manual!.id, reason: "ehr_sync" });
    expect(events[0]!.metadata!.changed_fields).toEqual(expect.stringContaining("first_name"));
    expect((await runRow(runId)).linkedCount).toBe(1);
    const linkIssue = (await issueRows(runId)).find((issue) => issue.code === "linked_to_source");
    expect(linkIssue!.patientId).toBe(manual!.id);
  });

  it("an MRN with a different birth date is a conflict naming the manual patient, and nothing is merged", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const [manual] = await systemDb()
      .insert(patients)
      .values({
        tenantId: ctx.tenantId,
        mrn: sandboxMrn(21),
        firstName: "Other",
        lastName: "Person",
        birthDate: "1900-02-02",
        memberIdEnc: encryptField("OTHER"),
        memberIdLast4: "HER0",
      })
      .returning();
    const { runId, result } = await runSync(ctx, id, h);
    expect(result).toMatchObject({
      status: "succeeded",
      created: EXPECTED_STORED - 1,
      skipped: 3,
      linked: 0,
    });
    expect(await byExternalId(21)).toBeUndefined();
    const untouched = (await patientRows(ctx)).find((row) => row.id === manual!.id)!;
    expect(untouched).toMatchObject({
      source: "manual",
      externalId: null,
      firstName: "Other",
      birthDate: "1900-02-02",
    });
    const conflict = (await issueRows(runId)).find((issue) => issue.code === "mrn_conflict");
    expect(conflict!.patientId).toBe(manual!.id);
    expect((await runRow(runId)).issueCodes).toContain("mrn_conflict");
    const completed = (await auditRows(ctx.tenantId)).find(
      (event) => event.action === "integration.sync_completed",
    );
    expect(completed!.metadata).toMatchObject({ conflicts: 1 });
  });
});

describe("payer mappings", () => {
  async function makePayer(name: string) {
    const [payer] = await systemDb().insert(payers).values({ tenantId: ctx.tenantId, name }).returning();
    return payer!.id;
  }
  /** What the payer-mapping page saves: the payer, and a fresh updated_at. */
  async function saveMapping(connectionId: string, payorKey: string, payerId: string | null) {
    await withTenant(ctx, (tx) =>
      tx.execute(sql`
        update integration_payer_mappings
        set payer_id = ${payerId}::uuid, updated_by = ${ctx.userId}::uuid, updated_at = now()
        where connection_id = ${connectionId}::uuid and payor_key = ${payorKey}
      `),
    );
  }

  it("re-derives coverage when a mapping is newer than the patient's last sync, even at an unchanged versionId", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await runSync(ctx, id, h);
    const org1 = (await patientRows(ctx)).filter((row) => row.coveragePayorKey === "Organization/syn-org-1");
    expect(org1.length).toBeGreaterThan(10);
    const payerId = await makePayer("Synthetic Plan A (practice)");

    // Nothing changed at the EHR: a plain re-run does nothing (no mapping is newer than any patient).
    h.clock.current = new Date(h.clock.current.getTime() + 60_000);
    const idle = await runSync(ctx, id, h);
    expect(idle.result).toMatchObject({ status: "succeeded", updated: 0, unchanged: 0 });

    await saveMapping(id, "Organization/syn-org-1", payerId);
    const run = await runSync(ctx, id, h);
    // The Patient search returns nothing new (the watermark), yet every patient behind that payor is
    // re-derived: mapped, with the payer, the member ID and everything else unchanged.
    expect(run.result).toMatchObject({ status: "succeeded", updated: org1.length });
    const after = (await patientRows(ctx)).filter((row) => row.coveragePayorKey === "Organization/syn-org-1");
    expect(after).toHaveLength(org1.length);
    for (const row of after) {
      const was = org1.find((candidate) => candidate.id === row.id)!;
      expect(row).toMatchObject({
        coverageStatus: "mapped",
        primaryPayerId: payerId,
        sourceVersionId: was.sourceVersionId,
        memberIdLast4: was.memberIdLast4,
        firstName: was.firstName,
      });
      expect(decryptField(row.memberIdEnc!)).toBe(decryptField(was.memberIdEnc!));
      expect(row.syncedAt!.getTime()).toBeGreaterThan(was.syncedAt!.getTime());
    }
    // Other payors are untouched.
    expect((await patientRows(ctx)).filter((row) => row.coverageStatus === "mapped")).toHaveLength(
      org1.length,
    );
    const updates = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "patient.synced_updated" && event.metadata!.run_id === run.runId,
    );
    expect(updates).toHaveLength(org1.length);
    expect(updates[0]!.metadata).toMatchObject({
      changed_fields: "primary_payer_id,coverage_status",
      triggered_by: ctx.userId,
    });

    // Applied once: the next run finds nothing newer than the patients' synced_at.
    h.clock.current = new Date(h.clock.current.getTime() + 60_000);
    const again = await runSync(ctx, id, h);
    expect(again.result).toMatchObject({ status: "succeeded", updated: 0, unchanged: 0 });

    // Clearing the mapping applies the same way, back to unmapped.
    await saveMapping(id, "Organization/syn-org-1", null);
    const cleared = await runSync(ctx, id, h);
    expect(cleared.result).toMatchObject({ status: "succeeded", updated: org1.length });
    for (const row of (await patientRows(ctx)).filter(
      (candidate) => candidate.coveragePayorKey === "Organization/syn-org-1",
    )) {
      expect(row).toMatchObject({ coverageStatus: "unmapped", primaryPayerId: null });
      expect(row.memberIdEnc).not.toBeNull();
    }
  });

  it("a mapping that changes nothing for a patient only refreshes synced_at, with no patient audit event", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await runSync(ctx, id, h);
    // Re-saving an unmapped key (still null) is newer than the patients, but changes no coverage.
    await saveMapping(id, "Organization/syn-org-2", null);
    const before = await patientRows(ctx);
    const auditsBefore = (await auditRows(ctx.tenantId)).length;
    const run = await runSync(ctx, id, h);
    expect(run.result).toMatchObject({ status: "succeeded", updated: 0 });
    expect(run.result.unchanged).toBeGreaterThan(0);
    const after = await patientRows(ctx);
    for (const row of after.filter((candidate) => candidate.coveragePayorKey === "Organization/syn-org-2")) {
      const was = before.find((candidate) => candidate.id === row.id)!;
      expect(row.syncedAt!.getTime()).toBeGreaterThan(was.syncedAt!.getTime());
      expect(row.updatedAt).toEqual(was.updatedAt);
    }
    const events = (await auditRows(ctx.tenantId)).slice(auditsBefore).map((event) => event.action);
    expect(events).toEqual(["integration.sync_started", "integration.sync_completed"]);
  });

  it("a Coverage whose payor key breaks the storage rules writes neither a patient key nor a mapping row", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const stored = h.dataset.patient(sandboxPatientId(40))!;
    h.dataset.patch(
      sandboxPatientId(40),
      (_resource, coverages) => {
        coverages[0]!.payor = [
          { reference: `Organization/${"x".repeat(80)}`, display: "Synthetic Overlong Plan" },
        ];
      },
      stored.lastUpdated,
    );
    await runSync(ctx, id, h);
    const row = (await byExternalId(40))!;
    expect(row).toMatchObject({ coverageStatus: "needs_review", coveragePayorKey: null, memberIdEnc: null });
    const keys = (await mappingRows(id)).map((mapping) => mapping.payorKey);
    expect(keys.some((key) => key.includes("xxxx"))).toBe(false);
    expect(JSON.stringify(await mappingRows(id))).not.toContain("Overlong");
  });

  it("uses the service principal for every mapping row it creates", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await runSync(ctx, id, h);
    for (const row of await mappingRows(id)) expect(row.updatedBy).toBe(INTEGRATION_SERVICE_PRINCIPAL_ID);
    // It never overwrites a mapping an administrator has saved.
    const payerId = await makePayer("Synthetic Plan B (practice)");
    await saveMapping(id, "Organization/syn-org-3", payerId);
    h.dataset.patch(
      sandboxPatientId(33),
      (resource) => {
        resource.gender = "unknown";
      },
      new Date(h.clock.current.getTime()),
    );
    await runSync(ctx, id, h);
    const kept = (await mappingRows(id)).find((row) => row.payorKey === "Organization/syn-org-3")!;
    expect(kept).toMatchObject({ payerId, updatedBy: ctx.userId });
  });
});

describe("pause, error, and revoke stop work in flight", () => {
  it("a Pause during a run stops it at its next page: the first page stays, the rest is never written, the watermark doesn't move", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    h.transport.intercept = async (init, next) => {
      if (init.method === "GET" && new URL(init.url).searchParams.get("_offset") === "100")
        await pauseFromInside(id);
      return next();
    };
    const { runId, result } = await runSync(ctx, id, h);
    expect(result.status).toBe("abandoned");
    const stored = await patientRows(ctx);
    // Page one held patients 1-100, of which two are skipped by a required rule.
    expect(stored).toHaveLength(98);
    expect(result.created).toBe(98);
    expect(await connectionRow(id)).toMatchObject({
      status: "paused",
      patientWatermark: null,
      hasSynced: true,
    });
    expect(await runRow(runId)).toMatchObject({ status: "abandoned" });
    const completed = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "integration.sync_completed",
    );
    expect(completed).toEqual([]);
  });

  it("a Pause between fetching a page and committing it stores nothing", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    let coverageSearches = 0;
    h.transport.intercept = async (init, next) => {
      // The second Coverage search is the first real page's (the first is the `_count=1` probe's).
      if (path(init).endsWith("/Coverage/_search") && ++coverageSearches === 2) await pauseFromInside(id);
      return next();
    };
    const { runId, result } = await runSync(ctx, id, h);
    expect(result).toMatchObject({ status: "abandoned", created: 0 });
    expect(await patientRows(ctx)).toEqual([]);
    expect((await connectionRow(id)).hasSynced).toBe(false);
    expect((await runRow(runId)).status).toBe("abandoned");
  });

  it("an error set by someone else mid-run stops it the same way", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    h.transport.intercept = async (init, next) => {
      if (init.method === "GET" && new URL(init.url).searchParams.get("_offset") === "100") {
        await withTenant(ctx, (tx) =>
          tx.execute(
            sql`update integration_connections set status = 'error', status_reason = 'auth_refused' where id = ${id}::uuid`,
          ),
        );
      }
      return next();
    };
    const { result } = await runSync(ctx, id, h);
    expect(result.status).toBe("abandoned");
    expect(await patientRows(ctx)).toHaveLength(98);
    expect((await connectionRow(id)).status).toBe("error");
  });
});

describe("failures", () => {
  /** Each run gets a practice of its own: a practice may have only one live connection. */
  async function failedRun(setup: (h: Harness) => void) {
    const c = await createTestTenant("Sync engine failure");
    const h = harness();
    const id = await activeSandbox(c, h);
    h.transport.requests.length = 0;
    setup(h);
    const outcome = await runSync(c, id, h);
    return { c, h, id, ...outcome, run: await runRow(outcome.runId), connection: await connectionRow(id) };
  }

  it("an issuer that no longer matches fails the run before any token or patient request, and leaves the connection active", async () => {
    const { c, h, result, run, connection } = await failedRun((h) => {
      h.transport.intercept = async (init, next) => {
        const response = await next();
        if (!path(init).endsWith("/metadata")) return response;
        const body = JSON.parse(response.body) as Record<string, unknown>;
        body.implementation = { url: "https://sandbox.fhir.denialdesk.invalid/other" };
        return { ...response, body: JSON.stringify(body) };
      };
    });
    expect(result).toMatchObject({ status: "failed", failure: "issuer_mismatch", created: 0 });
    expect(run).toMatchObject({ status: "failed", issueCodes: ["issuer_mismatch"] });
    expect(connection).toMatchObject({ status: "active", hasSynced: false, patientWatermark: null });
    expect(h.transport.requests.filter((request) => request.method === "POST")).toEqual([]);
    expect(h.transport.to("Patient")).toEqual([]);
    expect(await patientRows(c)).toEqual([]);
    const failed = (await auditRows(c.tenantId)).filter(
      (event) => event.action === "integration.sync_failed",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.metadata).toMatchObject({ code: "issuer_mismatch", run_id: run.id });
  });

  it("a changed token endpoint sets `error`, stamped by the database after the run finished, with the reason", async () => {
    const { c, h, result, run, connection } = await failedRun((h) => {
      h.transport.intercept = async (init, next) => {
        const response = await next();
        if (!path(init).endsWith("/smart-configuration")) return response;
        const body = JSON.parse(response.body) as Record<string, unknown>;
        body.token_endpoint = "https://sandbox.fhir.denialdesk.invalid/token-moved";
        return { ...response, body: JSON.stringify(body) };
      };
    });
    expect(result).toMatchObject({
      status: "failed",
      failure: "token_endpoint_changed",
      connectionErrored: true,
    });
    expect(run).toMatchObject({ status: "failed", issueCodes: ["token_endpoint_changed"] });
    expect(connection).toMatchObject({
      status: "error",
      statusReason: "token_endpoint_changed",
      updatedBy: INTEGRATION_SERVICE_PRINCIPAL_ID,
    });
    // The run was finished first (the abandon trigger found nothing to overwrite), and the error
    // transition is stamped with the database's real clock, after the run's own finish time.
    expect(connection.updatedAt.getTime()).toBeGreaterThanOrEqual(run.finishedAt!.getTime());
    expect(h.transport.to("Patient")).toEqual([]);
    const events = (await auditRows(c.tenantId)).filter(
      (event) => event.action === "integration.connection_errored",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: INTEGRATION_SERVICE_PRINCIPAL_ID,
      reason: "token_endpoint_changed",
      entityId: run.connectionId,
    });
    expect(events[0]!.metadata).toMatchObject({ previous_status: "active", run_id: run.id });
  });

  it.each([
    [
      "401 from the token endpoint",
      (h: Harness) =>
        (h.transport.intercept = async (init, next) =>
          init.method === "POST" && path(init).endsWith("/token") ? status(401) : next()),
    ],
    [
      "invalid_client (400) from the token endpoint",
      (h: Harness) =>
        (h.transport.intercept = async (init, next) =>
          init.method === "POST" && path(init).endsWith("/token") ? status(400) : next()),
    ],
    [
      "403 from the Patient search",
      (h: Harness) =>
        (h.transport.intercept = async (init, next) =>
          path(init).endsWith("/Patient") ? status(403) : next()),
    ],
    [
      "a second 401 from the Patient search",
      (h: Harness) =>
        (h.transport.intercept = async (init, next) =>
          path(init).endsWith("/Patient") ? status(401) : next()),
    ],
  ])("%s sets the connection to `error`", async (_name, setup) => {
    const { c, result, run, connection } = await failedRun(setup);
    expect(result).toMatchObject({ status: "failed", failure: "auth_refused", connectionErrored: true });
    expect(run).toMatchObject({ status: "failed", issueCodes: ["auth_refused"] });
    expect(connection).toMatchObject({ status: "error", statusReason: "auth_refused" });
    expect(await patientRows(c)).toEqual([]);
  });

  it("re-authenticates once on a 401 and carries on", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    h.transport.requests.length = 0;
    let refusedOnce = false;
    h.transport.intercept = async (init, next) => {
      if (!refusedOnce && path(init).endsWith("/Patient")) {
        refusedOnce = true;
        return status(401);
      }
      return next();
    };
    const { result } = await runSync(ctx, id, h);
    expect(result).toMatchObject({ status: "succeeded", created: EXPECTED_STORED });
    expect(
      h.transport.requests.filter((request) => request.method === "POST" && path(request).endsWith("/token")),
    ).toHaveLength(2);
    expect((await connectionRow(id)).status).toBe("active");
  });

  it("retries a transient server error with exponential backoff and succeeds", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    let failures = 0;
    h.transport.intercept = async (init, next) =>
      path(init).endsWith("/Coverage/_search") && failures++ < 2 ? status(503) : next();
    const { result } = await runSync(ctx, id, h);
    expect(result).toMatchObject({ status: "succeeded", created: EXPECTED_STORED });
    expect(h.sleeps).toEqual([1000, 2000]);
  });

  it("honors Retry-After up to 60 seconds and retries a timeout", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    let calls = 0;
    h.transport.intercept = async (init, next) => {
      if (path(init).endsWith("/Patient")) {
        calls += 1;
        if (calls === 1) return status(429, 3600);
        if (calls === 2) throw new TransportError("timeout");
      }
      return next();
    };
    const { result } = await runSync(ctx, id, h);
    expect(result.status).toBe("succeeded");
    expect(h.sleeps).toEqual([60_000, 2000]);
  });

  it("gives up after three retries: the run fails `unreachable` with the HTTP status, and the connection stays active", async () => {
    const { c, h, result, run, connection } = await failedRun((h) => {
      h.transport.intercept = async (init, next) =>
        path(init).endsWith("/Coverage/_search") ? status(503) : next();
    });
    expect(result).toMatchObject({ status: "failed", failure: "unreachable" });
    expect(run).toMatchObject({ status: "failed", httpStatus: 503, issueCodes: ["unreachable"] });
    expect(connection).toMatchObject({ status: "active", patientWatermark: null, lastSuccessAt: null });
    expect(h.sleeps).toEqual([1000, 2000, 4000]);
    expect(await patientRows(c)).toEqual([]);
  });

  it("a paging loop, a cross-origin next link, and an oversized Bundle each end the run with their own code", async () => {
    const loop = await failedRun((h) => {
      h.transport.intercept = async (init, next) => {
        const response = await next();
        if (!path(init).endsWith("/Patient") || new URL(init.url).searchParams.get("_count") !== "100")
          return response;
        const body = JSON.parse(response.body) as { link: { relation: string; url: string }[] };
        body.link = [{ relation: "next", url: init.url.href }];
        return { ...response, body: JSON.stringify(body) };
      };
    });
    expect(loop.result).toMatchObject({ status: "failed", failure: "paging_loop" });

    const cross = await failedRun((h) => {
      h.transport.intercept = async (init, next) => {
        const response = await next();
        if (!path(init).endsWith("/Patient") || new URL(init.url).searchParams.get("_count") !== "100")
          return response;
        const body = JSON.parse(response.body) as { link: { relation: string; url: string }[] };
        body.link = [{ relation: "next", url: "https://evil.example.test/r4/Patient?_offset=100" }];
        return { ...response, body: JSON.stringify(body) };
      };
    });
    expect(cross.result).toMatchObject({ status: "failed", failure: "address_refused" });
    expect(cross.h.transport.requests.some((request) => request.url.hostname === "evil.example.test")).toBe(
      false,
    );
    // The first page was committed before the bad link was met; the run still failed and the watermark stayed.
    expect(cross.connection.patientWatermark).toBeNull();

    const huge = await failedRun((h) => {
      h.transport.intercept = async (init, next) => {
        const response = await next();
        if (!path(init).endsWith("/Patient") || new URL(init.url).searchParams.get("_count") !== "100")
          return response;
        const body = JSON.parse(response.body) as { entry: unknown[] };
        body.entry = Array.from({ length: 1001 }, (_, index) => ({
          resource: { resourceType: "Patient", id: `p${index}` },
        }));
        return { ...response, body: JSON.stringify(body) };
      };
    });
    expect(huge.result).toMatchObject({ status: "failed", failure: "too_large" });
    expect(await patientRows(huge.c)).toEqual([]);
  });

  it("an OperationOutcome in a page keeps only R4 issue codes, mapped to our vocabulary, never the diagnostics", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    h.transport.intercept = async (init, next) => {
      const response = await next();
      if (!path(init).endsWith("/Patient") || new URL(init.url).searchParams.get("_count") !== "100")
        return response;
      const body = JSON.parse(response.body) as { entry: unknown[] };
      body.entry.push({
        resource: {
          resourceType: "OperationOutcome",
          issue: [
            { code: "not-found", diagnostics: "Patient Jane Q. Test 000-00-0000 not found" },
            { code: "Patient/123" },
          ],
        },
        search: { mode: "outcome" },
      });
      return { ...response, body: JSON.stringify(body) };
    };
    const { runId, result } = await runSync(ctx, id, h);
    expect(result.status).toBe("succeeded");
    const run = await runRow(runId);
    expect(run.issueCodes).toEqual(expect.arrayContaining(["not_found", "other"]));
    for (const code of run.issueCodes) expect(isSyncStoredCode(code)).toBe(true);
    expect(JSON.stringify(run)).not.toMatch(/Jane|000-00|Patient\/123/);
  });

  it("an unexpected error rolls the page back and fails the run `internal_error` without its message", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const deps = {
      ...h.deps,
      encrypt: () => {
        throw new Error("boom: Jane Q. Test SSN 000-00-0000");
      },
    };
    const { runId, result } = await runSync(ctx, id, h, deps);
    expect(result).toMatchObject({ status: "failed", failure: "internal_error" });
    expect(await patientRows(ctx)).toEqual([]);
    const run = await runRow(runId);
    expect(run.issueCodes).toEqual(["internal_error"]);
    expect(JSON.stringify([run, await auditRows(ctx.tenantId)])).not.toContain("Jane");
  });
});

describe("the synthetic guard", () => {
  it("fails the run and stores nothing when a page carries an MRN without the SYN marker", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const stored = h.dataset.patient(sandboxPatientId(50))!;
    h.dataset.patch(
      sandboxPatientId(50),
      (resource) => {
        (resource.identifier as { value: string }[])[0]!.value = "PLAIN-0000050";
      },
      stored.lastUpdated,
    );
    h.transport.requests.length = 0;
    const { result, runId } = await runSync(ctx, id, h);
    expect(result).toMatchObject({ status: "failed", failure: "not_synthetic", created: 0 });
    expect(await patientRows(ctx)).toEqual([]);
    expect((await runRow(runId)).issueCodes).toEqual(["not_synthetic"]);
    // The probe (`_count=1`) passed; the first real page was read and refused whole; no second page.
    expect(
      h.transport.to("Patient").map((request) => new URL(request.url).searchParams.get("_count")),
    ).toEqual(["1", "100"]);
    // The connection is not put in error for it, and nothing was locked.
    expect(await connectionRow(id)).toMatchObject({ status: "active", hasSynced: false });
  });

  it("checks the very first record before requesting a full page (the _count=1 probe)", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const stored = h.dataset.patient(sandboxPatientId(1))!;
    h.dataset.patch(
      sandboxPatientId(1),
      (resource) => {
        (resource.identifier as { value: string }[])[0]!.value = "PLAIN-0000001";
      },
      stored.lastUpdated,
    );
    h.transport.requests.length = 0;
    const { result } = await runSync(ctx, id, h);
    expect(result).toMatchObject({ status: "failed", failure: "not_synthetic" });
    expect(
      h.transport.to("Patient").map((request) => new URL(request.url).searchParams.get("_count")),
    ).toEqual(["1"]);
  });

  it("checks member IDs on Coverage too", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const stored = h.dataset.patient(sandboxPatientId(60))!;
    h.dataset.patch(
      sandboxPatientId(60),
      (_resource, coverages) => {
        coverages[0]!.subscriberId = "REAL-MEMBER-60";
      },
      stored.lastUpdated,
    );
    const { result } = await runSync(ctx, id, h);
    expect(result).toMatchObject({ status: "failed", failure: "not_synthetic" });
    expect(await patientRows(ctx)).toEqual([]);
  });
});

describe("environment rules", () => {
  it("a sandbox connection is refused where real data is allowed: no transport is even asked for", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const asked: unknown[] = [];
    const deps = {
      ...h.deps,
      syntheticOnly: () => false,
      transportFor: (connection: { id: string; isSandbox: boolean }) => {
        asked.push(connection);
        return h.transport;
      },
    };
    const { result, runId } = await runSync(ctx, id, h, deps);
    expect(result).toMatchObject({ status: "failed", failure: "environment_refused" });
    expect(asked).toEqual([]);
    expect(await patientRows(ctx)).toEqual([]);
    expect((await runRow(runId)).issueCodes).toEqual(["environment_refused"]);
  });

  it("a run whose connection was paused before it started is abandoned, not run", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    // Pausing abandons the queued run (drizzle/0043), so it can't even be claimed.
    await withTenant(ctx, async (tx) => pauseConnection(tx, adminActor(ctx), id, await stampOf(ctx, id)));
    expect((await runRow(runId)).status).toBe("abandoned");
    await expect(executeSyncRun({ tenantId: ctx.tenantId, runId }, h.deps)).rejects.toThrow(/not queued/);
    expect(h.transport.requests.filter((request) => path(request).endsWith("/Patient"))).toEqual([]);
  });

  it("only a queued run can be claimed: a second execution of the same run is refused", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const { runId } = await runSync(ctx, id, h);
    await expect(executeSyncRun({ tenantId: ctx.tenantId, runId }, h.deps)).rejects.toThrow(/not queued/);
  });

  it("refuses another practice's run id", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const other = await createTestTenant("Sync engine other");
    await expect(executeSyncRun({ tenantId: other.tenantId, runId }, h.deps)).rejects.toThrow(/no such run/);
    expect((await runRow(runId)).status).toBe("queued");
  });
});

describe("one sync writes only its own practice's rows", () => {
  it("two practices sync the same synthetic source into their own registers", async () => {
    const other = await createTestTenant("Sync engine second practice");
    const h1 = harness();
    const h2 = harness();
    const id1 = await activeSandbox(ctx, h1);
    const id2 = await activeSandbox(other, h2);
    await runSync(ctx, id1, h1);
    await runSync(other, id2, h2);
    const mine = await patientRows(ctx);
    const theirs = await patientRows(other);
    expect(mine).toHaveLength(EXPECTED_STORED);
    expect(theirs).toHaveLength(EXPECTED_STORED);
    // The same external ids and MRNs live in both, each keyed by its own tenant and connection.
    expect(new Set(mine.map((row) => row.id))).not.toEqual(new Set(theirs.map((row) => row.id)));
    expect(mine.every((row) => row.sourceConnectionId === id1)).toBe(true);
    expect(theirs.every((row) => row.sourceConnectionId === id2)).toBe(true);
    // Through the practice's own session (row-level security), each sees only its own.
    const seenByFirst = await withTenant(ctx, (tx) => tx.select({ id: patients.id }).from(patients));
    expect(seenByFirst).toHaveLength(EXPECTED_STORED);
    expect(seenByFirst.every((row) => mine.some((mineRow) => mineRow.id === row.id))).toBe(true);
    const runs = await withTenant(other, (tx) =>
      tx.execute<{ n: string }>(sql`select count(*) as n from integration_sync_runs`),
    );
    expect(runs.rows[0]!.n).toBe("1");
  });

  it("the connection's has_synced and watermark are the run's, not another connection's", async () => {
    const other = await createTestTenant("Sync engine bystander");
    const h = harness();
    const bystanderHarness = harness();
    const bystander = await activeSandbox(other, bystanderHarness);
    const id = await activeSandbox(ctx, h);
    await runSync(ctx, id, h);
    expect(await connectionRow(bystander)).toMatchObject({
      hasSynced: false,
      patientWatermark: null,
      lastSuccessAt: null,
    });
    const rows = await systemDb()
      .select({ status: integrationConnections.status })
      .from(integrationConnections)
      .where(
        and(eq(integrationConnections.tenantId, other.tenantId), eq(integrationConnections.id, bystander)),
      );
    expect(rows).toEqual([{ status: "active" }]);
  });
});
