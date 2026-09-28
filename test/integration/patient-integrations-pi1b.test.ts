import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections } from "@/db/schema";
import { withTenant, withTenantAsPlatform } from "@/db/tenant";
import {
  activateSandboxConnection,
  ConnectionError,
  createConnection,
  getConnection,
  getPatientsConnectionSummary,
  listConnections,
  pauseConnection,
  resumeConnection,
  revokeConnection,
  updateConnection,
  withdrawConnection,
  type ConnectionInput,
} from "@/domain/integrations/connections";
import { createPatient, PatientRecordError } from "@/domain/patients/queries";
import { patientSchema } from "@/domain/patients/record";
import { SANDBOX_BASE_URL, SANDBOX_CLIENT_ID } from "@/integrations/fhir/url-rules";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/patient-integrations.md "PI1b": Settings › Integrations lifecycle (create, edit,
// withdraw, pause, resume, revoke, sandbox activation), tenant isolation, audit content, and the
// register-blocked domain refusal this UI reflects. R-7.2.4, R-5.1.2, R-7.5.1.

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;

beforeAll(async () => {
  a = await createTestTenant("PI1b A");
  b = await createTestTenant("PI1b B");
});

afterAll(() => closeDatabase());

function sandboxInput(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    displayName: "Sandbox EHR",
    baseUrl: SANDBOX_BASE_URL,
    clientId: SANDBOX_CLIENT_ID,
    mrnIdentifierSystem: "http://hospital.example.org/mrn",
    usResidencyAttested: false,
    ...overrides,
  };
}

let seq = 0;
function realInput(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  seq += 1;
  return {
    displayName: "Acme EHR",
    baseUrl: `https://ehr${seq}.example.com/r4`,
    clientId: `client-${seq}`,
    mrnIdentifierSystem: "http://hospital.example.org/mrn",
    usResidencyAttested: true,
    ...overrides,
  };
}

function actorOf(ctx: Ctx, recentMfa: boolean) {
  return { tenantId: ctx.tenantId, userId: ctx.userId, recentMfa, locale: "en" as const };
}

const SANDBOX_ENV = { syntheticOnly: true };
const REAL_ENV = { syntheticOnly: false };

async function connectionRow(id: string) {
  const [row] = await systemDb()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return row!;
}

async function auditRowsFor(id: string) {
  const rows = await systemDb().select().from(auditEvents).where(eq(auditEvents.entityId, id));
  return rows;
}

describe("createConnection", () => {
  it("creates a draft sandbox connection with no attestation or step-up needed", async () => {
    const { id, isSandbox } = await withTenant(a, (tx) =>
      createConnection(tx, actorOf(a, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    expect(isSandbox).toBe(true);
    const row = await connectionRow(id);
    expect(row.status).toBe("draft");
    expect(row.baseUrl).toBe(SANDBOX_BASE_URL);
    expect(row.usResidencyAttestedAt).toBeNull();
  });

  it("creates a draft real connection when attested and recently MFA-verified", async () => {
    const { id, isSandbox } = await withTenant(a, (tx) =>
      createConnection(tx, actorOf(a, true), realInput(), { syntheticOnly: false }, undefined),
    );
    expect(isSandbox).toBe(false);
    const row = await connectionRow(id);
    expect(row.status).toBe("draft");
    expect(row.usResidencyAttestedAt).not.toBeNull();
    expect(row.usResidencyAttestedBy).toBe(a.userId);
  });

  it("refuses a real endpoint in a synthetic-data environment (environment gating matrix)", async () => {
    await expect(
      withTenant(a, (tx) =>
        createConnection(tx, actorOf(a, true), realInput(), { syntheticOnly: true }, undefined),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  it("refuses the sandbox outside a synthetic-data environment", async () => {
    await expect(
      withTenant(a, (tx) =>
        createConnection(tx, actorOf(a, false), sandboxInput(), { syntheticOnly: false }, undefined),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  it("requires a fresh MFA verification to attest a real connection (step-up)", async () => {
    let caught: unknown;
    try {
      await withTenant(a, (tx) =>
        createConnection(tx, actorOf(a, false), realInput(), { syntheticOnly: false }, undefined),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConnectionError);
    expect((caught as ConnectionError).stepUpRequired).toBe(true);
  });

  it("refuses an unrefused-looking but blocked MRN identifier system (SSN)", async () => {
    await expect(
      withTenant(a, (tx) =>
        createConnection(
          tx,
          actorOf(a, true),
          realInput({ mrnIdentifierSystem: "http://hl7.org/fhir/sid/us-ssn" }),
          { syntheticOnly: false },
          undefined,
        ),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  it("audits creation with no query string and only IDs/config, never PHI", async () => {
    const { id } = await withTenant(a, (tx) =>
      createConnection(
        tx,
        actorOf(a, false),
        sandboxInput({ displayName: "Audited Sandbox" }),
        { syntheticOnly: true },
        undefined,
      ),
    );
    const [row] = await auditRowsFor(id);
    expect(row!.action).toBe("integration.connection_created");
    expect(row!.entityType).toBe("integration_connection");
    const metadata = row!.metadata as Record<string, unknown>;
    expect(String(metadata.newBaseUrl)).not.toContain("?");
    expect(String(metadata.newBaseUrl)).not.toContain("#");
    expect(JSON.stringify(metadata)).not.toMatch(/mrn|ssn/i);
  });
});

describe("updateConnection (edit, draft only)", () => {
  it("edits a draft connection's display name and MRN system", async () => {
    const { id } = await withTenant(a, (tx) =>
      createConnection(tx, actorOf(a, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(a, (tx) =>
      updateConnection(
        tx,
        actorOf(a, false),
        id,
        sandboxInput({ displayName: "Renamed", mrnIdentifierSystem: "http://hospital.example.org/mrn2" }),
        { syntheticOnly: true },
        undefined,
      ),
    );
    const row = await connectionRow(id);
    expect(row.displayName).toBe("Renamed");
    expect(row.mrnIdentifierSystem).toBe("http://hospital.example.org/mrn2");
  });

  it("refuses to switch a connection between the sandbox and a real endpoint", async () => {
    const { id } = await withTenant(a, (tx) =>
      createConnection(tx, actorOf(a, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await expect(
      withTenant(a, (tx) =>
        updateConnection(tx, actorOf(a, true), id, realInput(), { syntheticOnly: true }, undefined),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  // Security/compliance review PR #81, item 5: an attestation is about a specific endpoint, so it
  // must never survive a change to that endpoint, or the box being unticked, unattended.
  describe("residency attestation is cleared, never left stale", () => {
    it("clears the attestation when the endpoint changes, even with the box still checked", async () => {
      const { id } = await withTenant(a, (tx) =>
        createConnection(tx, actorOf(a, true), realInput(), REAL_ENV, undefined),
      );
      const before = await connectionRow(id);
      expect(before.usResidencyAttestedAt).not.toBeNull();

      // A step-up-fresh edit that changes the endpoint re-attests (for the new endpoint) rather
      // than leaving the old attestation timestamp in place.
      await withTenant(a, (tx) =>
        updateConnection(
          tx,
          actorOf(a, true),
          id,
          realInput({ usResidencyAttested: true }),
          REAL_ENV,
          undefined,
        ),
      );
      const after = await connectionRow(id);
      expect(after.usResidencyAttestedAt).not.toBeNull();
      expect(after.usResidencyAttestedAt!.getTime()).toBeGreaterThanOrEqual(
        before.usResidencyAttestedAt!.getTime(),
      );
      expect(after.baseUrl).not.toBe(before.baseUrl);
    });

    it("refuses to re-attest a changed endpoint without a fresh step-up", async () => {
      const { id } = await withTenant(a, (tx) =>
        createConnection(tx, actorOf(a, true), realInput(), REAL_ENV, undefined),
      );
      let caught: unknown;
      try {
        await withTenant(a, (tx) =>
          updateConnection(
            tx,
            actorOf(a, false),
            id,
            realInput({ usResidencyAttested: true }),
            REAL_ENV,
            undefined,
          ),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConnectionError);
      expect((caught as ConnectionError).stepUpRequired).toBe(true);
      // Refused before any write: the original attestation is untouched, not cleared.
      expect((await connectionRow(id)).usResidencyAttestedAt).not.toBeNull();
    });

    it("clears the attestation when the box is unticked, endpoint unchanged, no step-up needed", async () => {
      const input = realInput();
      const { id } = await withTenant(a, (tx) =>
        createConnection(tx, actorOf(a, true), input, REAL_ENV, undefined),
      );
      expect((await connectionRow(id)).usResidencyAttestedAt).not.toBeNull();

      await withTenant(a, (tx) =>
        updateConnection(
          tx,
          actorOf(a, false),
          id,
          { ...input, usResidencyAttested: false },
          REAL_ENV,
          undefined,
        ),
      );
      const row = await connectionRow(id);
      expect(row.usResidencyAttestedAt).toBeNull();
      expect(row.usResidencyAttestedBy).toBeNull();
    });

    it("audits both an attestation and a clear", async () => {
      const input = realInput();
      const { id } = await withTenant(a, (tx) =>
        createConnection(tx, actorOf(a, true), input, REAL_ENV, undefined),
      );
      await withTenant(a, (tx) =>
        updateConnection(
          tx,
          actorOf(a, false),
          id,
          { ...input, usResidencyAttested: false },
          REAL_ENV,
          undefined,
        ),
      );
      const rows = await auditRowsFor(id);
      const updated = rows.find((r) => r!.action === "integration.connection_updated");
      const metadata = updated!.metadata as Record<string, unknown>;
      expect(metadata.attested).toBe(false);
      expect(metadata.attestationCleared).toBe(true);
    });
  });
});

// Only one connection per tenant may be outside draft/revoked at a time (drizzle/0039's partial
// unique index). Every test below that activates, pauses, or revokes a connection uses its own
// fresh tenant so it can't collide with another test's still-active connection.

describe("endpoint fields are locked once the connection leaves draft (DB rule)", () => {
  it("allows renaming a paused connection (spec 'Editability': display name always)", async () => {
    const ctx = await createTestTenant("PI1b paused-rename");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, actorOf(ctx, true), id, { syntheticOnly: true }),
    );
    await withTenant(ctx, (tx) => pauseConnection(tx, actorOf(ctx, false), id, SANDBOX_ENV));
    await withTenant(ctx, (tx) =>
      updateConnection(
        tx,
        actorOf(ctx, false),
        id,
        sandboxInput({ displayName: "Renamed while paused" }),
        { syntheticOnly: true },
        undefined,
      ),
    );
    expect((await connectionRow(id)).displayName).toBe("Renamed while paused");
  });

  it("refuses changing the endpoint itself on a paused connection", async () => {
    const ctx = await createTestTenant("PI1b paused-endpoint-locked");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, true), realInput(), REAL_ENV, undefined),
    );
    await withTenant(ctx, (tx) =>
      tx.execute(sql`
        update integration_connections
        set status = 'pending_approval', submitted_by = ${ctx.userId}::uuid, submitted_at = now(),
            token_endpoint_key = ${"https://ehr.example.test/token"}
        where id = ${id}::uuid
      `),
    );
    // Submit's own claim of the endpoint registry (drizzle/0039's integration_registry_claim):
    // migration 0040's lifecycle trigger refuses to activate a non-sandbox connection without a
    // matching registry row, so this mirrors the real Submit step before the operator approves.
    await withTenant(ctx, (tx) => tx.execute(sql`select integration_registry_claim(${id}::uuid)`));
    // The real operator path (PI1c): table-owner privileges via withTenantAsPlatform, not the app
    // role, matching test/integration/patient-integrations.test.ts's own approveAsOperator helper.
    await withTenantAsPlatform(ctx, (tx) =>
      tx.execute(sql`
        update integration_connections
        set status = 'active', approved_by = ${ctx.userId}::uuid, approved_at = now(),
            approval_method = 'phone_verified', population_scope = 'verified_filter'
        where id = ${id}::uuid
      `),
    );
    await expect(
      withTenant(ctx, (tx) =>
        updateConnection(
          tx,
          actorOf(ctx, true),
          id,
          realInput({ displayName: "Try to change the endpoint too" }),
          REAL_ENV,
          undefined,
        ),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  it("the trigger itself refuses an endpoint-field change outside draft, even via raw SQL", async () => {
    const ctx = await createTestTenant("PI1b paused-raw-sql");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, actorOf(ctx, true), id, { syntheticOnly: true }),
    );
    await withTenant(ctx, (tx) => pauseConnection(tx, actorOf(ctx, false), id, SANDBOX_ENV));
    // display_name may always change (spec "Editability"); the endpoint set may not, outside draft.
    await withTenant(ctx, (tx) =>
      tx.execute(
        sql`update integration_connections set display_name = 'still allowed' where id = ${id}::uuid`,
      ),
    );
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`update integration_connections set base_url = 'https://different.example.test/r4' where id = ${id}::uuid`,
        ),
      ),
      /draft/i,
    );
  });

  it("a withdrawn connection (back to draft) can be edited again", async () => {
    // Withdraw is unreachable through this PR's own UI (Submit needs PI2a's test-connection), so
    // this exercises the transition directly to prove the machinery still works when it is used.
    const ctx = await createTestTenant("PI1b withdraw-edit");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, true), realInput(), { syntheticOnly: false }, undefined),
    );
    await withTenant(ctx, (tx) =>
      tx.execute(sql`
        update integration_connections
        set status = 'pending_approval', submitted_by = ${ctx.userId}::uuid, submitted_at = now()
        where id = ${id}::uuid
      `),
    );
    expect((await connectionRow(id)).status).toBe("pending_approval");
    await withTenant(ctx, (tx) => withdrawConnection(tx, actorOf(ctx, false), id, REAL_ENV));
    expect((await connectionRow(id)).status).toBe("draft");
    await withTenant(ctx, (tx) =>
      updateConnection(
        tx,
        actorOf(ctx, true),
        id,
        realInput({ displayName: "Edited after withdraw" }),
        { syntheticOnly: false },
        undefined,
      ),
    );
    expect((await connectionRow(id)).displayName).toBe("Edited after withdraw");
  });
});

describe("sandbox activation", () => {
  it("activates a draft sandbox connection directly, with no operator approval", async () => {
    const ctx = await createTestTenant("PI1b activate");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, actorOf(ctx, true), id, { syntheticOnly: true }),
    );
    const row = await connectionRow(id);
    expect(row.status).toBe("active");
    expect(row.approvedBy).toBeNull();
    expect(row.approvedAt).toBeNull();
    const audited = await auditRowsFor(id);
    expect(audited.some((e) => e.action === "integration.connection_activated")).toBe(true);
  });

  it("refuses sandbox activation outside a synthetic-data environment", async () => {
    const ctx = await createTestTenant("PI1b activate-refused");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await expect(
      withTenant(ctx, (tx) =>
        activateSandboxConnection(tx, actorOf(ctx, false), id, { syntheticOnly: false }),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  it("requires a fresh step-up to activate the sandbox", async () => {
    const ctx = await createTestTenant("PI1b activate-step-up");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    let caught: unknown;
    try {
      await withTenant(ctx, (tx) =>
        activateSandboxConnection(tx, actorOf(ctx, false), id, { syntheticOnly: true }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConnectionError);
    expect((caught as ConnectionError).stepUpRequired).toBe(true);
    expect((await connectionRow(id)).status).toBe("draft");
  });

  // Security/correctness review PR #81, item 4: a live connection (of either kind) already exists
  // for this tenant, so activating a second, still-draft sandbox connection would just collide
  // with drizzle/0039's own partial unique index (`integration_connections_one_active`) — refused
  // here first with a clear, specific message instead of a raw unique-violation.
  it("refuses sandbox activation while another connection is already live", async () => {
    const ctx = await createTestTenant("PI1b activate-blocked");
    const { id: liveId } = await withTenant(ctx, (tx) =>
      createConnection(
        tx,
        actorOf(ctx, false),
        sandboxInput({ displayName: "Already live" }),
        SANDBOX_ENV,
        undefined,
      ),
    );
    await withTenant(ctx, (tx) => activateSandboxConnection(tx, actorOf(ctx, true), liveId, SANDBOX_ENV));

    const { id: secondId } = await withTenant(ctx, (tx) =>
      createConnection(
        tx,
        actorOf(ctx, false),
        sandboxInput({ displayName: "Second draft" }),
        SANDBOX_ENV,
        undefined,
      ),
    );
    await expect(
      withTenant(ctx, (tx) => activateSandboxConnection(tx, actorOf(ctx, true), secondId, SANDBOX_ENV)),
    ).rejects.toThrow(ConnectionError);
    expect((await connectionRow(secondId)).status).toBe("draft");
  });
});

describe("revoke", () => {
  it("revokes an active connection with a reason code, requiring a fresh MFA verification", async () => {
    const ctx = await createTestTenant("PI1b revoke");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, actorOf(ctx, true), id, { syntheticOnly: true }),
    );

    let caught: unknown;
    try {
      await withTenant(ctx, (tx) => revokeConnection(tx, actorOf(ctx, false), id, "other", SANDBOX_ENV));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConnectionError);
    expect((caught as ConnectionError).stepUpRequired).toBe(true);
    expect((await connectionRow(id)).status).toBe("active");

    await withTenant(ctx, (tx) =>
      revokeConnection(tx, actorOf(ctx, true), id, "no_longer_used", SANDBOX_ENV),
    );
    const row = await connectionRow(id);
    expect(row.status).toBe("revoked");
    expect(row.revokedBy).toBe(ctx.userId);
    expect(row.revokedAt).not.toBeNull();
    const [event] = await auditRowsFor(id).then((rows) =>
      rows.filter((e) => e.action === "integration.connection_revoked"),
    );
    expect((event!.metadata as Record<string, unknown>).reasonCode).toBe("no_longer_used");
  });

  it("revoked is terminal", async () => {
    const ctx = await createTestTenant("PI1b revoke-terminal");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) => revokeConnection(tx, actorOf(ctx, true), id, "other", SANDBOX_ENV));
    await expect(
      withTenant(ctx, (tx) => revokeConnection(tx, actorOf(ctx, true), id, "other", SANDBOX_ENV)),
    ).rejects.toThrow(ConnectionError);
  });
});

describe("resume", () => {
  it("requires a fresh MFA verification and moves paused -> active", async () => {
    const ctx = await createTestTenant("PI1b resume");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, actorOf(ctx, true), id, { syntheticOnly: true }),
    );
    await withTenant(ctx, (tx) => pauseConnection(tx, actorOf(ctx, false), id, SANDBOX_ENV));

    await expect(
      withTenant(ctx, (tx) => resumeConnection(tx, actorOf(ctx, false), id, SANDBOX_ENV)),
    ).rejects.toThrow(ConnectionError);
    expect((await connectionRow(id)).status).toBe("paused");

    await withTenant(ctx, (tx) => resumeConnection(tx, actorOf(ctx, true), id, SANDBOX_ENV));
    expect((await connectionRow(id)).status).toBe("active");
  });
});

describe("tenant isolation", () => {
  it("listConnections and getConnection never cross tenants", async () => {
    const { id: idA } = await withTenant(a, (tx) =>
      createConnection(
        tx,
        actorOf(a, false),
        sandboxInput({ displayName: "Tenant A connection" }),
        { syntheticOnly: true },
        undefined,
      ),
    );
    const { id: idB } = await withTenant(b, (tx) =>
      createConnection(
        tx,
        actorOf(b, false),
        sandboxInput({ displayName: "Tenant B connection" }),
        { syntheticOnly: true },
        undefined,
      ),
    );

    const listA = await withTenant(a, (tx) => listConnections(tx));
    expect(listA.map((r) => r.id)).toContain(idA);
    expect(listA.map((r) => r.id)).not.toContain(idB);

    const crossRead = await withTenant(a, (tx) => getConnection(tx, idB));
    expect(crossRead).toBeNull();
  });

  // Security/correctness review PR #81, item 20: every write path resolves the target row through
  // `lockConnection`'s RLS-scoped select, so a tenant naming another tenant's connection ID sees
  // the same "not found" a bogus ID would give — never a permission-specific error that would
  // confirm the ID exists, and never a cross-tenant write.
  it("refuses update/pause/resume/revoke/withdraw across tenants as not-found", async () => {
    const ctx = await createTestTenant("PI1b cross-tenant target");
    const other = await createTestTenant("PI1b cross-tenant actor");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    const otherActor = actorOf(other, true);

    await expect(
      withTenant(other, (tx) =>
        updateConnection(
          tx,
          otherActor,
          id,
          sandboxInput({ displayName: "Hijacked" }),
          { syntheticOnly: true },
          undefined,
        ),
      ),
    ).rejects.toThrow(ConnectionError);

    await expect(
      withTenant(other, (tx) => activateSandboxConnection(tx, otherActor, id, { syntheticOnly: true })),
    ).rejects.toThrow(ConnectionError);

    // Activate for real (as the owning tenant) so pause/resume/revoke/withdraw all have a live
    // connection to (fail to) act on cross-tenant.
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, actorOf(ctx, true), id, { syntheticOnly: true }),
    );

    await expect(withTenant(other, (tx) => pauseConnection(tx, otherActor, id, SANDBOX_ENV))).rejects.toThrow(
      ConnectionError,
    );
    await expect(
      withTenant(other, (tx) => resumeConnection(tx, otherActor, id, SANDBOX_ENV)),
    ).rejects.toThrow(ConnectionError);
    await expect(
      withTenant(other, (tx) => revokeConnection(tx, otherActor, id, "other", SANDBOX_ENV)),
    ).rejects.toThrow(ConnectionError);
    await expect(
      withTenant(other, (tx) => withdrawConnection(tx, otherActor, id, SANDBOX_ENV)),
    ).rejects.toThrow(ConnectionError);

    // None of it touched tenant `ctx`'s own connection.
    expect((await connectionRow(id)).displayName).not.toBe("Hijacked");
    expect((await connectionRow(id)).status).toBe("active");
  });
});

describe("the Patients register while a connection is active", () => {
  const schema = patientSchema({ today: "2026-09-28", syntheticOnly: true });
  function patientInput(overrides: Record<string, unknown> = {}) {
    return schema.parse({
      mrn: "",
      firstName: "Quinn",
      lastName: "Zephyrine",
      birthDate: "1990-06-15",
      sex: "U",
      addressLine1: "",
      city: "",
      state: "",
      postalCode: "",
      phone: "",
      primaryPayerId: "",
      memberId: "",
      sensitivityTags: [],
      ...overrides,
    });
  }

  it("refuses createPatient once the connection is active, and allows it again once revoked", async () => {
    const ctx = await createTestTenant("PI1b register-blocked");
    const actor = { tenantId: ctx.tenantId, userId: ctx.userId, canTag: true, syntheticOnly: true };

    // Open while draft.
    await withTenant(ctx, (tx) => createPatient(tx, actor, patientInput(), undefined));

    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, actorOf(ctx, false), sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, actorOf(ctx, true), id, { syntheticOnly: true }),
    );

    await expect(
      withTenant(ctx, (tx) => createPatient(tx, actor, patientInput({ firstName: "Blocked" }), undefined)),
    ).rejects.toThrow(PatientRecordError);

    const summary = await withTenant(ctx, (tx) => getPatientsConnectionSummary(tx));
    expect(summary?.status).toBe("active");

    await withTenant(ctx, (tx) =>
      revokeConnection(tx, actorOf(ctx, true), id, "no_longer_used", SANDBOX_ENV),
    );
    await withTenant(ctx, (tx) =>
      createPatient(tx, actor, patientInput({ firstName: "Open again" }), undefined),
    );
  });
});
