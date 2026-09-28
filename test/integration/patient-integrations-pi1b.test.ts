import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections } from "@/db/schema";
import { withTenant } from "@/db/tenant";
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
      createConnection(tx, { ...a, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    expect(isSandbox).toBe(true);
    const row = await connectionRow(id);
    expect(row.status).toBe("draft");
    expect(row.baseUrl).toBe(SANDBOX_BASE_URL);
    expect(row.usResidencyAttestedAt).toBeNull();
  });

  it("creates a draft real connection when attested and recently MFA-verified", async () => {
    const { id, isSandbox } = await withTenant(a, (tx) =>
      createConnection(tx, { ...a, recentMfa: true }, realInput(), { syntheticOnly: false }, undefined),
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
        createConnection(tx, { ...a, recentMfa: true }, realInput(), { syntheticOnly: true }, undefined),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  it("refuses the sandbox outside a synthetic-data environment", async () => {
    await expect(
      withTenant(a, (tx) =>
        createConnection(tx, { ...a, recentMfa: false }, sandboxInput(), { syntheticOnly: false }, undefined),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  it("requires a fresh MFA verification to attest a real connection (step-up)", async () => {
    let caught: unknown;
    try {
      await withTenant(a, (tx) =>
        createConnection(tx, { ...a, recentMfa: false }, realInput(), { syntheticOnly: false }, undefined),
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
          { ...a, recentMfa: true },
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
        { ...a, recentMfa: false },
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
      createConnection(tx, { ...a, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(a, (tx) =>
      updateConnection(
        tx,
        { ...a, recentMfa: false },
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
      createConnection(tx, { ...a, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await expect(
      withTenant(a, (tx) =>
        updateConnection(tx, { ...a, recentMfa: true }, id, realInput(), { syntheticOnly: true }, undefined),
      ),
    ).rejects.toThrow(ConnectionError);
  });
});

// Only one connection per tenant may be outside draft/revoked at a time (drizzle/0039's partial
// unique index). Every test below that activates, pauses, or revokes a connection uses its own
// fresh tenant so it can't collide with another test's still-active connection.

describe("endpoint fields are locked once the connection leaves draft (DB rule)", () => {
  it("refuses updateConnection on a paused connection", async () => {
    const ctx = await createTestTenant("PI1b paused-edit");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, { ...ctx, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, { ...ctx, recentMfa: false }, id, { syntheticOnly: true }),
    );
    await withTenant(ctx, (tx) => pauseConnection(tx, { ...ctx, recentMfa: false }, id));
    await expect(
      withTenant(ctx, (tx) =>
        updateConnection(
          tx,
          { ...ctx, recentMfa: false },
          id,
          sandboxInput({ displayName: "Try to edit while paused" }),
          { syntheticOnly: true },
          undefined,
        ),
      ),
    ).rejects.toThrow(ConnectionError);
  });

  it("the trigger itself refuses an endpoint-field change outside draft, even via raw SQL", async () => {
    const ctx = await createTestTenant("PI1b paused-raw-sql");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, { ...ctx, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, { ...ctx, recentMfa: false }, id, { syntheticOnly: true }),
    );
    await withTenant(ctx, (tx) => pauseConnection(tx, { ...ctx, recentMfa: false }, id));
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
      createConnection(tx, { ...ctx, recentMfa: true }, realInput(), { syntheticOnly: false }, undefined),
    );
    await withTenant(ctx, (tx) =>
      tx.execute(sql`
        update integration_connections
        set status = 'pending_approval', submitted_by = ${ctx.userId}::uuid, submitted_at = now()
        where id = ${id}::uuid
      `),
    );
    expect((await connectionRow(id)).status).toBe("pending_approval");
    await withTenant(ctx, (tx) => withdrawConnection(tx, { ...ctx, recentMfa: false }, id));
    expect((await connectionRow(id)).status).toBe("draft");
    await withTenant(ctx, (tx) =>
      updateConnection(
        tx,
        { ...ctx, recentMfa: true },
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
      createConnection(tx, { ...ctx, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, { ...ctx, recentMfa: false }, id, { syntheticOnly: true }),
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
      createConnection(tx, { ...ctx, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await expect(
      withTenant(ctx, (tx) =>
        activateSandboxConnection(tx, { ...ctx, recentMfa: false }, id, { syntheticOnly: false }),
      ),
    ).rejects.toThrow(ConnectionError);
  });
});

describe("revoke", () => {
  it("revokes an active connection with a reason code, requiring a fresh MFA verification", async () => {
    const ctx = await createTestTenant("PI1b revoke");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, { ...ctx, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, { ...ctx, recentMfa: false }, id, { syntheticOnly: true }),
    );

    let caught: unknown;
    try {
      await withTenant(ctx, (tx) => revokeConnection(tx, { ...ctx, recentMfa: false }, id, "other"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConnectionError);
    expect((caught as ConnectionError).stepUpRequired).toBe(true);
    expect((await connectionRow(id)).status).toBe("active");

    await withTenant(ctx, (tx) => revokeConnection(tx, { ...ctx, recentMfa: true }, id, "no_longer_used"));
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
      createConnection(tx, { ...ctx, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) => revokeConnection(tx, { ...ctx, recentMfa: true }, id, "other"));
    await expect(
      withTenant(ctx, (tx) => revokeConnection(tx, { ...ctx, recentMfa: true }, id, "other")),
    ).rejects.toThrow(ConnectionError);
  });
});

describe("resume", () => {
  it("requires a fresh MFA verification and moves paused -> active", async () => {
    const ctx = await createTestTenant("PI1b resume");
    const { id } = await withTenant(ctx, (tx) =>
      createConnection(tx, { ...ctx, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, { ...ctx, recentMfa: false }, id, { syntheticOnly: true }),
    );
    await withTenant(ctx, (tx) => pauseConnection(tx, { ...ctx, recentMfa: false }, id));

    await expect(
      withTenant(ctx, (tx) => resumeConnection(tx, { ...ctx, recentMfa: false }, id)),
    ).rejects.toThrow(ConnectionError);
    expect((await connectionRow(id)).status).toBe("paused");

    await withTenant(ctx, (tx) => resumeConnection(tx, { ...ctx, recentMfa: true }, id));
    expect((await connectionRow(id)).status).toBe("active");
  });
});

describe("tenant isolation", () => {
  it("listConnections and getConnection never cross tenants", async () => {
    const { id: idA } = await withTenant(a, (tx) =>
      createConnection(
        tx,
        { ...a, recentMfa: false },
        sandboxInput({ displayName: "Tenant A connection" }),
        { syntheticOnly: true },
        undefined,
      ),
    );
    const { id: idB } = await withTenant(b, (tx) =>
      createConnection(
        tx,
        { ...b, recentMfa: false },
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
      createConnection(tx, { ...ctx, recentMfa: false }, sandboxInput(), { syntheticOnly: true }, undefined),
    );
    await withTenant(ctx, (tx) =>
      activateSandboxConnection(tx, { ...ctx, recentMfa: false }, id, { syntheticOnly: true }),
    );

    await expect(
      withTenant(ctx, (tx) => createPatient(tx, actor, patientInput({ firstName: "Blocked" }), undefined)),
    ).rejects.toThrow(PatientRecordError);

    const summary = await withTenant(ctx, (tx) => getPatientsConnectionSummary(tx));
    expect(summary?.status).toBe("active");

    await withTenant(ctx, (tx) => revokeConnection(tx, { ...ctx, recentMfa: true }, id, "no_longer_used"));
    await withTenant(ctx, (tx) =>
      createPatient(tx, actor, patientInput({ firstName: "Open again" }), undefined),
    );
  });
});
